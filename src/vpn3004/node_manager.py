"""Core WireGuard node & peer lifecycle manager for 3004-VPN.

Designed to run identically on a home Raspberry Pi node (KR) and cloud nodes
such as Oracle Cloud Free Tier instances (JP/US/SG), and to be imported
directly by a FastAPI web control plane.
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import json
import os
import re
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

DEFAULT_BASE_DIR = Path(os.environ.get("VPN3004_HOME", "/opt/3004-vpn"))
DEFAULT_CONFIG_PATH = DEFAULT_BASE_DIR / "node.json"
DEFAULT_DB_PATH = DEFAULT_BASE_DIR / "3004vpn.db"


class VPNNodeManager:
    """Manages WireGuard peers and profiles on a single VPN node."""

    def __init__(
        self,
        config_path: Path = DEFAULT_CONFIG_PATH,
        db_path: Path = DEFAULT_DB_PATH,
        wg_conf_path: Path | None = None,
    ) -> None:
        self.config_path = Path(config_path)
        self.db_path = Path(db_path)
        self.node: dict[str, Any] = json.loads(self.config_path.read_text(encoding="utf-8"))
        self.wg_conf = (
            Path(wg_conf_path)
            if wg_conf_path is not None
            else Path(f"/etc/wireguard/{self.node['interface']}.conf")
        )
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS peers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    ip TEXT NOT NULL UNIQUE,
                    public_key TEXT NOT NULL UNIQUE,
                    mode TEXT NOT NULL DEFAULT 'full',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                )
                """
            )

    def _run(self, cmd: list[str], input_text: str | None = None) -> str:
        res = subprocess.run(
            cmd,
            input=input_text,
            text=True,
            capture_output=True,
            check=True,
        )
        return res.stdout.strip()

    def get_server_public_key(self) -> str:
        return self._run(["wg", "show", self.node["interface"], "public-key"])

    def sync_existing(self) -> int:
        """Import unmanaged peers already present in wg0.conf without dropping traffic."""
        if not self.wg_conf.exists():
            return 0

        raw = self.wg_conf.read_text(encoding="utf-8")
        pattern = re.compile(
            r"(?m)(?:^#\s*(?:peer:\s*)?(?P<comment>[^\n]+)\n)?^\[Peer\]\s*\n(?P<body>(?:^(?!\[Peer\]).*\n?)*)"
        )
        now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        added = 0

        with self._conn() as conn:
            for match in pattern.finditer(raw):
                comment = (match.group("comment") or "").strip()
                body = match.group("body")
                pub_m = re.search(r"(?m)^\s*PublicKey\s*=\s*(\S+)", body)
                ip_m = re.search(r"(?m)^\s*AllowedIPs\s*=\s*([0-9.]+)", body)
                if not (pub_m and ip_m):
                    continue

                pub, ip = pub_m.group(1), ip_m.group(1)
                exists = conn.execute(
                    "SELECT 1 FROM peers WHERE public_key = ? OR ip = ?",
                    (pub, ip),
                ).fetchone()
                if exists:
                    continue

                last_octet = ip.split(".")[-1]
                slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", comment).strip("-").lower()
                candidate = slug[:32] if len(slug) >= 2 else f"device-{last_octet}"
                if conn.execute("SELECT 1 FROM peers WHERE name = ?", (candidate,)).fetchone():
                    candidate = f"device-{last_octet}"

                conn.execute(
                    """
                    INSERT INTO peers (name, ip, public_key, mode, enabled, created_at)
                    VALUES (?, ?, ?, 'full', 1, ?)
                    """,
                    (candidate, ip, pub, now),
                )
                added += 1
        return added

    def _next_available_ip(self) -> str:
        network = ipaddress.ip_network(self.node["subnet"], strict=False)
        used = {self.node["server_ip"]}
        with self._conn() as conn:
            used.update(row["ip"] for row in conn.execute("SELECT ip FROM peers"))

        for host in network.hosts():
            ip_str = str(host)
            if ip_str not in used:
                return ip_str
        raise RuntimeError(f"서브넷({self.node['subnet']})에 사용 가능한 빈 IP가 없습니다.")

    def _save_wg_conf(self) -> None:
        """Atomically update [Peer] blocks while keeping [Interface] untouched."""
        raw = self.wg_conf.read_text(encoding="utf-8")
        interface_header = re.split(r"(?m)^(?:#[^\n]*\n)*\[Peer\]\s*$", raw)[0].rstrip()
        lines = [interface_header, ""]

        with self._conn() as conn:
            rows = conn.execute(
                "SELECT name, ip, public_key FROM peers WHERE enabled = 1 ORDER BY id"
            ).fetchall()

        for row in rows:
            lines.extend(
                [
                    f"# peer: {row['name']}",
                    "[Peer]",
                    f"PublicKey = {row['public_key']}",
                    f"AllowedIPs = {row['ip']}/32",
                    "",
                ]
            )

        tmp = self.wg_conf.with_suffix(".conf.tmp")
        tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(self.wg_conf)

    def add_peer(self, name: str, mode: str = "full") -> dict[str, Any]:
        """Register a new client peer live and return a ready-to-import .conf profile."""
        if not re.fullmatch(r"[a-zA-Z0-9_-]{2,32}", name):
            raise ValueError("기기 이름은 영문, 숫자, 하이픈(-), 밑줄(_) 2~32자로 입력해 주세요.")
        if mode not in ("full", "split"):
            raise ValueError("mode는 'full' 또는 'split'만 지원합니다.")

        self.sync_existing()
        with self._conn() as conn:
            if conn.execute("SELECT 1 FROM peers WHERE name = ?", (name,)).fetchone():
                raise ValueError(f"이미 등록된 기기 이름입니다: {name}")

        ip = self._next_available_ip()
        priv_key = self._run(["wg", "genkey"])
        pub_key = self._run(["wg", "pubkey"], input_text=priv_key)
        server_pub = self.get_server_public_key()
        now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO peers (name, ip, public_key, mode, enabled, created_at)
                VALUES (?, ?, ?, ?, 1, ?)
                """,
                (name, ip, pub_key, mode, now),
            )

        self._run(["wg", "set", self.node["interface"], "peer", pub_key, "allowed-ips", f"{ip}/32"])
        self._save_wg_conf()

        allowed_ips = "0.0.0.0/0" if mode == "full" else self.node["subnet"]
        dns_line = f"DNS = {self.node['dns']}\n" if mode == "full" else ""
        config_text = (
            f"# 3004-VPN Profile | Node: {self.node['node_name']} ({self.node['region']}) | Device: {name}\n"
            f"[Interface]\n"
            f"PrivateKey = {priv_key}\n"
            f"Address = {ip}/32\n"
            f"{dns_line}\n"
            f"[Peer]\n"
            f"PublicKey = {server_pub}\n"
            f"Endpoint = {self.node['endpoint']}\n"
            f"AllowedIPs = {allowed_ips}\n"
            f"PersistentKeepalive = 25\n"
        )
        return {
            "name": name,
            "ip": ip,
            "mode": mode,
            "node_id": self.node["node_id"],
            "node_name": self.node["node_name"],
            "region": self.node["region"],
            "config": config_text,
        }

    def set_peer_enabled(self, name: str, enabled: bool) -> dict[str, Any]:
        self.sync_existing()
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM peers WHERE name = ?", (name,)).fetchone()
            if not row:
                raise KeyError(f"등록되지 않은 기기입니다: {name}")
            conn.execute("UPDATE peers SET enabled = ? WHERE name = ?", (1 if enabled else 0, name))

        cmd = ["wg", "set", self.node["interface"], "peer", row["public_key"]]
        cmd += ["allowed-ips", f"{row['ip']}/32"] if enabled else ["remove"]
        self._run(cmd)
        self._save_wg_conf()
        return {"name": name, "ip": row["ip"], "enabled": enabled}

    def rename_peer(self, old_name: str, new_name: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{2,32}", new_name):
            raise ValueError("새 기기 이름은 영문, 숫자, 하이픈(-), 밑줄(_) 2~32자여야 합니다.")
        self.sync_existing()
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM peers WHERE name = ?", (old_name,)).fetchone()
            if not row:
                raise KeyError(f"등록되지 않은 기기입니다: {old_name}")
            conn.execute("UPDATE peers SET name = ? WHERE name = ?", (new_name, old_name))
        self._save_wg_conf()
        return {"old_name": old_name, "new_name": new_name, "ip": row["ip"]}

    def remove_peer(self, name: str) -> dict[str, Any]:
        self.sync_existing()
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM peers WHERE name = ?", (name,)).fetchone()
            if not row:
                raise KeyError(f"등록되지 않은 기기입니다: {name}")
            conn.execute("DELETE FROM peers WHERE name = ?", (name,))

        self._run(["wg", "set", self.node["interface"], "peer", row["public_key"], "remove"])
        self._save_wg_conf()
        return {"name": name, "ip": row["ip"], "removed": True}

    def list_peers(self) -> list[dict[str, Any]]:
        self.sync_existing()
        live: dict[str, dict[str, Any]] = {}
        now_ts = int(dt.datetime.now(dt.timezone.utc).timestamp())

        dump_lines = self._run(["wg", "show", self.node["interface"], "dump"]).splitlines()
        for line in dump_lines[1:]:
            parts = line.split("\t")
            if len(parts) >= 7:
                pub, _, endpoint, _, hs_str, rx_str, tx_str = parts[:7]
                hs = int(hs_str)
                age = (now_ts - hs) if hs > 0 else None
                live[pub] = {
                    "endpoint": None if endpoint == "(none)" else endpoint,
                    "handshake_ago_sec": age,
                    "online": bool(age is not None and age <= 180),
                    "rx_bytes": int(rx_str),
                    "tx_bytes": int(tx_str),
                }

        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM peers ORDER BY id").fetchall()

        results: list[dict[str, Any]] = []
        for row in rows:
            st = live.get(row["public_key"], {})
            results.append(
                {
                    "name": row["name"],
                    "ip": row["ip"],
                    "mode": row["mode"],
                    "enabled": bool(row["enabled"]),
                    "online": st.get("online", False) if row["enabled"] else False,
                    "handshake_ago_sec": st.get("handshake_ago_sec"),
                    "rx_bytes": st.get("rx_bytes", 0),
                    "tx_bytes": st.get("tx_bytes", 0),
                    "created_at": row["created_at"],
                }
            )
        return results
