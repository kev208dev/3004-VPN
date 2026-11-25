"""WireGuard node driver supporting both local wg0 execution and remote Oracle Cloud agents."""
from __future__ import annotations

import base64
import datetime as dt
import os
import re
import secrets
import shutil
import subprocess
from pathlib import Path
from typing import Any

import httpx


class LocalWireGuardDriver:
    """Controls local WireGuard interface exclusively via 3004-VPN managed peers."""

    def __init__(self, interface: str = "wg0", wg_conf_path: Path | None = None) -> None:
        self.interface = interface
        self.wg_conf = (
            Path(wg_conf_path)
            if wg_conf_path is not None
            else Path(os.environ.get("VPN3004_WG_CONF", f"/etc/wireguard/{interface}.conf"))
        )
        self.mock_mode = os.environ.get("VPN3004_MOCK_WG") == "1" or shutil.which("wg") is None
        self._mock_server_pub = "MOCK_SERVER_PUBLIC_KEY_3004_VPN_BASE64====="

    def _run(self, cmd: list[str], input_text: str | None = None) -> str:
        res = subprocess.run(
            cmd,
            input=input_text,
            text=True,
            capture_output=True,
            check=True,
        )
        return res.stdout.strip()

    def generate_keypair(self) -> tuple[str, str]:
        if self.mock_mode:
            priv = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
            pub = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
            return priv, pub
        priv = self._run(["wg", "genkey"])
        pub = self._run(["wg", "pubkey"], input_text=priv)
        return priv, pub

    def get_server_public_key(self) -> str:
        if self.mock_mode:
            return self._mock_server_pub
        return self._run(["wg", "show", self.interface, "public-key"])

    def get_reserved_ips_in_conf(self) -> set[str]:
        """Return all IPv4 addresses already present in wg0.conf to prevent IP collisions."""
        if not self.wg_conf.exists():
            return set()
        text = self.wg_conf.read_text(encoding="utf-8")
        return set(re.findall(r"(?m)^\s*AllowedIPs\s*=\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)", text))

    def upsert_peer(self, public_key: str, assigned_ip: str, label: str, old_public_key: str | None = None) -> None:
        if not self.mock_mode:
            if old_public_key and old_public_key != public_key:
                subprocess.run(
                    ["wg", "set", self.interface, "peer", old_public_key, "remove"],
                    check=False,
                    capture_output=True,
                )
            self._run(["wg", "set", self.interface, "peer", public_key, "allowed-ips", f"{assigned_ip}/32"])

        if not self.wg_conf.exists():
            return

        text = self.wg_conf.read_text(encoding="utf-8")
        # Remove previous block matching either old_public_key, public_key, or same assigned_ip
        keys_to_strip = {k for k in (public_key, old_public_key) if k}
        blocks = re.split(r"(?m)(?=^(?:#[^\n]*\n)*\[Peer\]\s*$)", text)
        kept: list[str] = [blocks[0].rstrip()]

        for blk in blocks[1:]:
            pub_m = re.search(r"(?m)^\s*PublicKey\s*=\s*(\S+)", blk)
            ip_m = re.search(r"(?m)^\s*AllowedIPs\s*=\s*([0-9.]+)", blk)
            b_pub = pub_m.group(1) if pub_m else ""
            b_ip = ip_m.group(1) if ip_m else ""
            if b_pub in keys_to_strip or b_ip == assigned_ip:
                continue
            kept.append(blk.strip())

        kept.append(
            f"# 3004-managed: {label}\n"
            f"[Peer]\n"
            f"PublicKey = {public_key}\n"
            f"AllowedIPs = {assigned_ip}/32"
        )
        tmp = self.wg_conf.with_suffix(".conf.tmp")
        tmp.write_text("\n\n".join(kept) + "\n", encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(self.wg_conf)

    def remove_peer(self, public_key: str) -> None:
        if not self.mock_mode:
            subprocess.run(
                ["wg", "set", self.interface, "peer", public_key, "remove"],
                check=False,
                capture_output=True,
            )

        if not self.wg_conf.exists():
            return

        text = self.wg_conf.read_text(encoding="utf-8")
        blocks = re.split(r"(?m)(?=^(?:#[^\n]*\n)*\[Peer\]\s*$)", text)
        kept: list[str] = [blocks[0].rstrip()]
        for blk in blocks[1:]:
            pub_m = re.search(r"(?m)^\s*PublicKey\s*=\s*(\S+)", blk)
            if pub_m and pub_m.group(1) == public_key:
                continue
            kept.append(blk.strip())

        tmp = self.wg_conf.with_suffix(".conf.tmp")
        tmp.write_text("\n\n".join(kept) + "\n", encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(self.wg_conf)

    def ensure_pmtu_clamping(self) -> None:
        """Ensure TCP MSS clamping is active on Linux gateway to prevent PMTUD hangs."""
        if self.mock_mode or shutil.which("iptables") is None:
            return
        check_cmd = [
            "iptables",
            "-t",
            "mangle",
            "-C",
            "FORWARD",
            "-p",
            "tcp",
            "--tcp-flags",
            "SYN,RST",
            "SYN",
            "-j",
            "TCPMSS",
            "--clamp-mss-to-pmtu",
        ]
        add_cmd = [
            "iptables",
            "-t",
            "mangle",
            "-I",
            "FORWARD",
            "1",
            "-p",
            "tcp",
            "--tcp-flags",
            "SYN,RST",
            "SYN",
            "-j",
            "TCPMSS",
            "--clamp-mss-to-pmtu",
        ]
        res = subprocess.run(check_cmd, check=False, capture_output=True)
        if res.returncode != 0:
            subprocess.run(add_cmd, check=False, capture_output=True)

    def reconcile_authoritative_peers(
        self, managed_peers: list[dict[str, str]]
    ) -> dict[str, int]:
        """Purge all unmanaged/legacy raw peers from wg0.conf and live kernel interface."""
        self.ensure_pmtu_clamping()
        allowed_map = {p["public_key"]: p for p in managed_peers if p.get("public_key")}
        removed_conf = 0
        removed_live = 0

        if self.wg_conf.exists():
            backup = self.wg_conf.with_name(f"{self.wg_conf.name}.pre-3004-purge.bak")
            if not backup.exists():
                try:
                    shutil.copy2(self.wg_conf, backup)
                    os.chmod(backup, 0o600)
                except OSError:
                    pass

            text = self.wg_conf.read_text(encoding="utf-8")
            blocks = re.split(r"(?m)(?=^(?:#[^\n]*\n)*\[Peer\]\s*$)", text)
            interface_header = blocks[0].rstrip()
            for blk in blocks[1:]:
                pub_m = re.search(r"(?m)^\s*PublicKey\s*=\s*(\S+)", blk)
                b_pub = pub_m.group(1) if pub_m else ""
                if b_pub not in allowed_map:
                    removed_conf += 1

            new_sections: list[str] = [interface_header]
            for p in managed_peers:
                new_sections.append(
                    f"# 3004-managed: {p['label']}\n"
                    f"[Peer]\n"
                    f"PublicKey = {p['public_key']}\n"
                    f"AllowedIPs = {p['assigned_ip']}/32"
                )
            tmp = self.wg_conf.with_suffix(".conf.tmp")
            tmp.write_text("\n\n".join(new_sections) + "\n", encoding="utf-8")
            os.chmod(tmp, 0o600)
            tmp.replace(self.wg_conf)

        if not self.mock_mode:
            try:
                live_pubs = [
                    ln.strip()
                    for ln in self._run(["wg", "show", self.interface, "peers"]).splitlines()
                    if ln.strip()
                ]
                for lpub in live_pubs:
                    if lpub not in allowed_map:
                        subprocess.run(
                            ["wg", "set", self.interface, "peer", lpub, "remove"],
                            check=False,
                            capture_output=True,
                        )
                        removed_live += 1
                for p in managed_peers:
                    subprocess.run(
                        [
                            "wg",
                            "set",
                            self.interface,
                            "peer",
                            p["public_key"],
                            "allowed-ips",
                            f"{p['assigned_ip']}/32",
                        ],
                        check=False,
                        capture_output=True,
                    )
            except Exception:
                pass

        return {
            "managed_count": len(managed_peers),
            "removed_conf_peers": removed_conf,
            "removed_live_peers": removed_live,
        }

    def get_live_stats(self) -> dict[str, dict[str, Any]]:
        if self.mock_mode:
            return {}
        try:
            lines = self._run(["wg", "show", self.interface, "dump"]).splitlines()
        except Exception:
            return {}
        now_ts = int(dt.datetime.now(dt.timezone.utc).timestamp())
        stats: dict[str, dict[str, Any]] = {}
        for line in lines[1:]:
            parts = line.split("\t")
            if len(parts) >= 7:
                pub, _, endpoint, _, hs_str, rx_str, tx_str = parts[:7]
                hs = int(hs_str)
                age = (now_ts - hs) if hs > 0 else None
                stats[pub] = {
                    "endpoint": None if endpoint == "(none)" else endpoint,
                    "handshake_ago_sec": age,
                    "online": bool(age is not None and age <= 180),
                    "rx_bytes": int(rx_str),
                    "tx_bytes": int(tx_str),
                }
        return stats


class RemoteNodeAgentClient:
    """Communicates with secondary VPN nodes (e.g. Oracle Cloud Free Tier servers)."""

    def __init__(self, agent_url: str, agent_secret: str) -> None:
        self.base_url = agent_url.rstrip("/")
        self.headers = {"X-Node-Secret": agent_secret}

    def get_info(self) -> dict[str, Any]:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(f"{self.base_url}/agent/v1/info", headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    def sync_peer(self, public_key: str, assigned_ip: str, label: str, old_public_key: str | None = None) -> str:
        with httpx.Client(timeout=8.0) as client:
            if old_public_key and old_public_key != public_key:
                client.post(
                    f"{self.base_url}/agent/v1/peers/remove",
                    headers=self.headers,
                    json={"public_key": old_public_key},
                )
            resp = client.post(
                f"{self.base_url}/agent/v1/peers/sync",
                headers=self.headers,
                json={"public_key": public_key, "assigned_ip": assigned_ip, "device_label": label},
            )
            resp.raise_for_status()
            return resp.json()["server_public_key"]

    def remove_peer(self, public_key: str) -> None:
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(
                f"{self.base_url}/agent/v1/peers/remove",
                headers=self.headers,
                json={"public_key": public_key},
            )
            resp.raise_for_status()
