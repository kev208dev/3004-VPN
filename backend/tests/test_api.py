"""End-to-end tests for 3004-VPN FastAPI Control Plane."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

os.environ["VPN3004_MOCK_WG"] = "1"

from fastapi.testclient import TestClient
from app.main import create_app


class TestControlPlaneAPI(unittest.TestCase):
    def test_full_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            wg_conf = root / "wg0.conf"
            wg_conf.write_text(
                "[Interface]\nAddress = 10.77.0.1/24\nListenPort = 51820\nPrivateKey = K\n\n"
                "[Peer]\nPublicKey = EXISTING1\nAllowedIPs = 10.77.0.2/32\n\n"
                "[Peer]\nPublicKey = EXISTING2\nAllowedIPs = 10.77.0.3/32\n",
                encoding="utf-8",
            )
            app = create_app(data_dir=root / "data", wg_conf_path=wg_conf)
            client = TestClient(app)

            # 1. Health check shows bootstrap required
            h = client.get("/api/v1/health").json()
            self.assertTrue(h["bootstrap_required"])

            # 2. Bootstrap initial admin
            boot = client.post("/api/v1/auth/bootstrap", json={"username": "admin", "password": "password123"})
            self.assertEqual(boot.status_code, 200)
            admin_token = boot.json()["access_token"]
            admin_hdr = {"Authorization": f"Bearer {admin_token}"}

            # 3. Admin creates an invite code for family/friend
            inv = client.post("/api/v1/admin/invites", headers=admin_hdr, json={"memo": "brother", "max_uses": 1})
            self.assertEqual(inv.status_code, 200)
            code = inv.json()["code"]
            self.assertTrue(code.startswith("3004-"))

            # 4. Friend registers with invite code
            reg = client.post(
                "/api/v1/auth/register",
                json={"username": "brother", "password": "secret456", "invite_code": code},
            )
            self.assertEqual(reg.status_code, 200)
            user_token = reg.json()["access_token"]
            user_hdr = {"Authorization": f"Bearer {user_token}"}

            # 5. List nodes
            nodes = client.get("/api/v1/nodes", headers=user_hdr).json()
            self.assertEqual(len(nodes), 1)
            node_id = nodes[0]["id"]

            # 6. Connect device -> skips 10.77.0.2 & .3 and allocates 10.77.0.4!
            conn1 = client.post(
                "/api/v1/connect",
                headers=user_hdr,
                json={
                    "node_id": node_id,
                    "device_uid": "win-brother-01",
                    "device_name": "Brother Laptop",
                    "platform": "windows",
                    "mode": "full",
                },
            )
            self.assertEqual(conn1.status_code, 200)
            c1_data = conn1.json()
            self.assertEqual(c1_data["assigned_ip"], "10.77.0.2")
            self.assertIn("AllowedIPs = 0.0.0.0/0", c1_data["config"])

            # Reconnecting same device_uid keeps same IP 10.77.0.2
            conn2 = client.post(
                "/api/v1/connect",
                headers=user_hdr,
                json={
                    "node_id": node_id,
                    "device_uid": "win-brother-01",
                    "device_name": "Brother Laptop",
                    "platform": "windows",
                    "mode": "full",
                },
            )
            self.assertEqual(conn2.json()["assigned_ip"], "10.77.0.2")

            # Raw unmanaged peers in wg0.conf were purged; only 3004-managed peer remains!
            rendered_conf = wg_conf.read_text(encoding="utf-8")
            self.assertNotIn("AllowedIPs = 10.77.0.3/32", rendered_conf)
            self.assertIn("AllowedIPs = 10.77.0.2/32", rendered_conf)

            # 7. Admin disables device -> reconnect fails with 403
            dev_id = c1_data["device_id"]
            tog = client.post(f"/api/v1/admin/devices/{dev_id}/toggle", headers=admin_hdr)
            self.assertFalse(tog.json()["enabled"])

            blocked = client.post(
                "/api/v1/connect",
                headers=user_hdr,
                json={
                    "node_id": node_id,
                    "device_uid": "win-brother-01",
                    "device_name": "Brother Laptop",
                    "platform": "windows",
                },
            )
            self.assertEqual(blocked.status_code, 403)

            # 8. Member can view & delete ONLY their own devices via /api/v1/my-devices
            my_devs = client.get("/api/v1/my-devices", headers=user_hdr)
            self.assertEqual(my_devs.status_code, 200)
            self.assertEqual(len(my_devs.json()), 1)
            self.assertEqual(my_devs.json()[0]["platform"], "windows")

            # Member cannot access admin overview before promotion
            self.assertEqual(client.get("/api/v1/admin/overview", headers=user_hdr).status_code, 403)

            # Admin promotes member to admin -> now can access admin overview
            member_id = reg.json()["user"]["id"]
            prom = client.post(
                f"/api/v1/admin/users/{member_id}/role",
                headers=admin_hdr,
                json={"role": "admin"},
            )
            self.assertEqual(prom.status_code, 200)
            self.assertEqual(prom.json()["role"], "admin")
            self.assertEqual(client.get("/api/v1/admin/overview", headers=user_hdr).status_code, 200)

            # Member deletes own device cleanly
            del_my = client.delete(f"/api/v1/my-devices/{dev_id}", headers=user_hdr)
            self.assertEqual(del_my.status_code, 200)
            self.assertEqual(len(client.get("/api/v1/my-devices", headers=user_hdr).json()), 0)


if __name__ == "__main__":
    unittest.main()
