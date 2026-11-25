"""SQLite persistence layer for 3004-VPN Central Control Plane."""
from __future__ import annotations

from contextlib import contextmanager
import datetime as dt
import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Iterator


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class ControlPlaneDB:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "control_plane.db"
        self._init_schema()
        self._seed_local_node()

    @contextmanager
    def conn(self) -> Iterator[sqlite3.Connection]:
        c = sqlite3.connect(self.db_path)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    def _init_schema(self) -> None:
        with self.conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'member',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS invites (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL UNIQUE,
                    memo TEXT NOT NULL DEFAULT '',
                    max_uses INTEGER NOT NULL DEFAULT 1,
                    used_count INTEGER NOT NULL DEFAULT 0,
                    created_by INTEGER,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    region TEXT NOT NULL,
                    country_flag TEXT NOT NULL DEFAULT '🇰🇷',
                    endpoint TEXT NOT NULL,
                    subnet TEXT NOT NULL,
                    server_ip TEXT NOT NULL,
                    dns TEXT NOT NULL DEFAULT '1.1.1.1, 8.8.8.8',
                    is_local INTEGER NOT NULL DEFAULT 0,
                    agent_url TEXT NOT NULL DEFAULT '',
                    agent_secret TEXT NOT NULL DEFAULT '',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS devices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                    device_uid TEXT NOT NULL,
                    device_name TEXT NOT NULL,
                    platform TEXT NOT NULL DEFAULT 'other',
                    assigned_ip TEXT NOT NULL,
                    public_key TEXT NOT NULL,
                    mode TEXT NOT NULL DEFAULT 'full',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(user_id, node_id, device_uid),
                    UNIQUE(node_id, assigned_ip)
                );
                """
            )

    def _seed_local_node(self) -> None:
        node_cfg_path = Path(os.environ.get("VPN3004_NODE_JSON", "/opt/3004-vpn/node.json"))
        default_endpoint = os.environ.get("VPN3004_LOCAL_ENDPOINT", "127.0.0.1:51820")
        default_subnet = "10.77.0.0/24"
        default_server_ip = "10.77.0.1"
        default_dns = "1.1.1.1, 8.8.8.8"
        node_id = "kr-home-1"

        if node_cfg_path.exists():
            try:
                raw: dict[str, Any] = json.loads(node_cfg_path.read_text(encoding="utf-8"))
                node_id = raw.get("node_id", node_id)
                default_endpoint = raw.get("endpoint", default_endpoint)
                default_subnet = raw.get("subnet", default_subnet)
                default_server_ip = raw.get("server_ip", default_server_ip)
                default_dns = raw.get("dns", default_dns)
            except Exception:
                pass

        with self.conn() as c:
            exists = c.execute("SELECT 1 FROM nodes WHERE is_local = 1").fetchone()
            if not exists:
                c.execute(
                    """
                    INSERT INTO nodes (
                        id, name, region, country_flag, endpoint, subnet,
                        server_ip, dns, is_local, enabled, created_at
                    ) VALUES (?, ?, 'KR', '🇰🇷', ?, ?, ?, ?, 1, 1, ?)
                    """,
                    (
                        node_id,
                        "대한민국 · 3004 본사",
                        default_endpoint,
                        default_subnet,
                        default_server_ip,
                        default_dns,
                        utc_now_iso(),
                    ),
                )
            else:
                c.execute(
                    "UPDATE nodes SET name = '대한민국 · 3004 본사' WHERE is_local = 1 AND name = '대한민국 · 삼천포 홈'"
                )
