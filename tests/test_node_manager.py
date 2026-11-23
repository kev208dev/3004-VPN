"""Unit tests for VPNNodeManager."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from vpn3004.node_manager import VPNNodeManager


class TestVPNNodeManager(unittest.TestCase):
    def test_sync_and_add_peer_preserves_interface(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            wg_conf = root / "wg0.conf"
            wg_conf.write_text(
                "[Interface]\n"
                "Address = 10.77.0.1/24\n"
                "ListenPort = 51820\n"
                "PrivateKey = FAKE_SERVER_KEY\n"
                "PostUp = iptables -t nat -A POSTROUTING -s 10.77.0.0/24 -o eth0 -j MASQUERADE\n\n"
                "[Peer]\n"
                "PublicKey = EXISTING_PUB_1\n"
                "AllowedIPs = 10.77.0.2/32\n\n"
                "# External Windows Laptop\n"
                "[Peer]\n"
                "PublicKey = EXISTING_PUB_2\n"
                "AllowedIPs = 10.77.0.3/32\n",
                encoding="utf-8",
            )
            cfg = root / "node.json"
            cfg.write_text(
                json.dumps(
                    {
                        "node_id": "kr-home-1",
                        "node_name": "3004-KR-HOME",
                        "region": "KR",
                        "interface": "wg0",
                        "endpoint": "example.duckdns.org:51820",
                        "subnet": "10.77.0.0/24",
                        "server_ip": "10.77.0.1",
                        "dns": "1.1.1.1, 8.8.8.8",
                    }
                ),
                encoding="utf-8",
            )

            mgr = VPNNodeManager(config_path=cfg, db_path=root / "test.db", wg_conf_path=wg_conf)
            self.assertEqual(mgr.sync_existing(), 2)

            def fake_run(cmd: list[str], input_text: str | None = None) -> str:
                if cmd == ["wg", "genkey"]:
                    return "NEW_CLIENT_PRIV_KEY"
                if cmd == ["wg", "pubkey"]:
                    return "NEW_CLIENT_PUB_KEY"
                if cmd[:3] == ["wg", "show", "wg0"] and cmd[3] == "public-key":
                    return "SERVER_PUB_KEY"
                if cmd[:3] == ["wg", "show", "wg0"] and cmd[3] == "dump":
                    return "SERVER_PRIVATE\tSERVER_PUB\t51820\toff\n"
                return ""

            with patch.object(mgr, "_run", side_effect=fake_run):
                created = mgr.add_peer("laptop2", mode="full")
                self.assertEqual(created["ip"], "10.77.0.4")
                self.assertIn("AllowedIPs = 0.0.0.0/0", created["config"])
                self.assertIn("DNS = 1.1.1.1, 8.8.8.8", created["config"])

                peers = mgr.list_peers()
                self.assertEqual(len(peers), 3)

                rendered = wg_conf.read_text(encoding="utf-8")
                self.assertIn("PrivateKey = FAKE_SERVER_KEY", rendered)
                self.assertIn("MASQUERADE", rendered)
                self.assertIn("AllowedIPs = 10.77.0.4/32", rendered)


if __name__ == "__main__":
    unittest.main()
