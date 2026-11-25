"""FastAPI Central Control Plane & Node Agent for 삼천포(3004) VPN."""
from __future__ import annotations

import hmac
import ipaddress
import os
import time
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

from .auth import (
    create_jwt,
    decode_jwt,
    generate_invite_code,
    get_or_create_secret,
    hash_password,
    verify_password,
)
from .db import ControlPlaneDB, utc_now_iso
from .schemas import (
    AgentRemovePeerRequest,
    AgentSyncPeerRequest,
    AuthResponse,
    BootstrapRequest,
    ChangePasswordRequest,
    ConnectRequest,
    ConnectResponse,
    CreateInviteRequest,
    CreateNodeRequest,
    LoginRequest,
    NodeOut,
    RegisterRequest,
    UpdateUserRoleRequest,
    UserOut,
)
from .wireguard_driver import LocalWireGuardDriver, RemoteNodeAgentClient


def _default_data_dir() -> Path:
    env_dir = os.environ.get("VPN3004_DATA_DIR")
    if env_dir:
        return Path(env_dir)
    sys_dir = Path("/opt/3004-vpn/data")
    if os.geteuid() == 0 or os.access("/opt", os.W_OK):
        return sys_dir
    return Path(__file__).resolve().parent.parent / "data"


def create_app(data_dir: Path | None = None, wg_conf_path: Path | None = None) -> FastAPI:
    resolved_dir = Path(data_dir) if data_dir is not None else _default_data_dir()
    db = ControlPlaneDB(resolved_dir)
    jwt_secret = get_or_create_secret(resolved_dir)
    wg_driver = LocalWireGuardDriver(
        interface=os.environ.get("VPN3004_IFACE", "wg0"),
        wg_conf_path=wg_conf_path,
    )

    app = FastAPI(
        title="삼천포(3004) VPN Control Plane API",
        version="1.0.0",
        description="Multi-node WireGuard VPN Backend for Windows, macOS, Android, and iOS clients",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.db = db
    app.state.jwt_secret = jwt_secret
    app.state.wg_driver = wg_driver

    def _row_to_user(row: Any) -> UserOut:
        return UserOut(
            id=row["id"],
            username=row["username"],
            role=row["role"],
            enabled=bool(row["enabled"]),
            created_at=row["created_at"],
        )

    def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다.")
        token = authorization.split(" ", 1)[1].strip()
        try:
            payload = decode_jwt(token, jwt_secret)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

        with db.conn() as c:
            row = c.execute("SELECT * FROM users WHERE id = ?", (payload.get("sub"),)).fetchone()
            if not row or not row["enabled"]:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="비활성화되었거나 존재하지 않는 계정입니다.")
            return dict(row)

    def require_admin(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if user["role"] != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다.")
        return user

    def verify_agent_secret(x_node_secret: str | None = Header(default=None)) -> None:
        expected = os.environ.get("VPN3004_AGENT_SECRET", "")
        if not expected or not x_node_secret or not hmac.compare_digest(x_node_secret, expected):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 노드 시크릿입니다.")

    @app.get("/")
    def index() -> dict[str, str]:
        return {"service": "삼천포(3004) VPN API", "version": "1.0.0", "docs": "/docs"}

    @app.get("/api/v1/health")
    def health() -> dict[str, Any]:
        with db.conn() as c:
            user_count = c.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()["cnt"]
        return {
            "status": "ok",
            "service": "3004-VPN",
            "bootstrap_required": user_count == 0,
            "ts": int(time.time() * 1000),
        }

    @app.get("/api/v1/ping")
    def ping() -> dict[str, Any]:
        return {"pong": True, "ts": int(time.time() * 1000)}

    @app.get("/api/v1/my-ip")
    def my_ip(request: Request) -> dict[str, str]:
        forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
        ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
        return {"ip": ip}

    @app.post("/api/v1/auth/bootstrap", response_model=AuthResponse)
    def bootstrap_admin(req: BootstrapRequest) -> AuthResponse:
        with db.conn() as c:
            cnt = c.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()["cnt"]
            if cnt > 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="이미 초기 관리자가 설정되어 있습니다.")
            now = utc_now_iso()
            cur = c.execute(
                "INSERT INTO users (username, password_hash, role, enabled, created_at) VALUES (?, ?, 'admin', 1, ?)",
                (req.username, hash_password(req.password), now),
            )
            row = c.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
        token = create_jwt({"sub": row["id"], "role": row["role"]}, jwt_secret)
        return AuthResponse(access_token=token, user=_row_to_user(row))

    @app.post("/api/v1/auth/register", response_model=AuthResponse)
    def register(req: RegisterRequest) -> AuthResponse:
        code = req.invite_code.strip().upper()
        with db.conn() as c:
            inv = c.execute("SELECT * FROM invites WHERE code = ?", (code,)).fetchone()
            if not inv or inv["used_count"] >= inv["max_uses"]:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="유효하지 않거나 이미 사용 만료된 초대코드입니다.")
            if c.execute("SELECT 1 FROM users WHERE username = ?", (req.username,)).fetchone():
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 아이디입니다.")

            now = utc_now_iso()
            cur = c.execute(
                "INSERT INTO users (username, password_hash, role, enabled, created_at) VALUES (?, ?, 'member', 1, ?)",
                (req.username, hash_password(req.password), now),
            )
            c.execute("UPDATE invites SET used_count = used_count + 1 WHERE id = ?", (inv["id"],))
            row = c.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()

        token = create_jwt({"sub": row["id"], "role": row["role"]}, jwt_secret)
        return AuthResponse(access_token=token, user=_row_to_user(row))

    @app.post("/api/v1/auth/login", response_model=AuthResponse)
    def login(req: LoginRequest) -> AuthResponse:
        with db.conn() as c:
            row = c.execute("SELECT * FROM users WHERE username = ?", (req.username,)).fetchone()
        if not row or not verify_password(req.password, row["password_hash"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
        if not row["enabled"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자에 의해 정지된 계정입니다.")

        token = create_jwt({"sub": row["id"], "role": row["role"]}, jwt_secret)
        return AuthResponse(access_token=token, user=_row_to_user(row))

    @app.post("/api/v1/auth/change-password")
    def change_password(req: ChangePasswordRequest, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, bool]:
        if not verify_password(req.current_password, user["password_hash"]):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="현재 비밀번호가 일치하지 않습니다.")
        with db.conn() as c:
            c.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(req.new_password), user["id"]))
        return {"ok": True}

    @app.get("/api/v1/me")
    def get_me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        with db.conn() as c:
            devices = [
                dict(r)
                for r in c.execute(
                    "SELECT id, node_id, device_uid, device_name, platform, assigned_ip, mode, enabled, updated_at "
                    "FROM devices WHERE user_id = ? ORDER BY id DESC",
                    (user["id"],),
                )
            ]
        return {"user": _row_to_user(user), "devices": devices}

    @app.get("/api/v1/my-devices")
    def list_my_devices(user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
        live_stats = wg_driver.get_live_stats()
        with db.conn() as c:
            rows = c.execute(
                """
                SELECT d.*, n.name AS node_name, n.region AS node_region, n.is_local
                FROM devices d
                JOIN nodes n ON n.id = d.node_id
                WHERE d.user_id = ?
                ORDER BY d.updated_at DESC, d.id DESC
                """,
                (user["id"],),
            ).fetchall()

        result: list[dict[str, Any]] = []
        for d in rows:
            st = live_stats.get(d["public_key"], {}) if d["is_local"] else {}
            result.append(
                {
                    "id": d["id"],
                    "node_id": d["node_id"],
                    "node_name": d["node_name"],
                    "node_region": d["node_region"],
                    "device_uid": d["device_uid"],
                    "device_name": d["device_name"],
                    "platform": d["platform"],
                    "assigned_ip": d["assigned_ip"],
                    "mode": d["mode"],
                    "enabled": bool(d["enabled"]),
                    "online": st.get("online", False) if d["enabled"] else False,
                    "handshake_ago_sec": st.get("handshake_ago_sec"),
                    "rx_bytes": st.get("rx_bytes", 0),
                    "tx_bytes": st.get("tx_bytes", 0),
                    "created_at": d["created_at"],
                    "updated_at": d["updated_at"],
                }
            )
        return result

    @app.delete("/api/v1/my-devices/{device_id}")
    def delete_my_device(device_id: int, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        with db.conn() as c:
            row = c.execute(
                """
                SELECT d.*, n.is_local, n.agent_url, n.agent_secret
                FROM devices d
                JOIN nodes n ON n.id = d.node_id
                WHERE d.id = ? AND d.user_id = ?
                """,
                (device_id, user["id"]),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="해당 계정의 기기를 찾을 수 없습니다.")

            if row["is_local"]:
                wg_driver.remove_peer(row["public_key"])
            else:
                RemoteNodeAgentClient(row["agent_url"], row["agent_secret"]).remove_peer(row["public_key"])
            c.execute("DELETE FROM devices WHERE id = ? AND user_id = ?", (device_id, user["id"]))
        return {"id": device_id, "deleted": True}

    @app.get("/api/v1/nodes", response_model=list[NodeOut])
    def list_nodes(_: dict[str, Any] = Depends(get_current_user)) -> list[NodeOut]:
        with db.conn() as c:
            rows = c.execute("SELECT * FROM nodes WHERE enabled = 1 ORDER BY is_local DESC, created_at ASC").fetchall()
        result: list[NodeOut] = []
        for r in rows:
            ep = r["endpoint"]
            host, port_str = ep.rsplit(":", 1) if ":" in ep else (ep, "51820")
            result.append(
                NodeOut(
                    id=r["id"],
                    name=r["name"],
                    region=r["region"],
                    country_flag=r["country_flag"],
                    host=host,
                    port=int(port_str),
                    endpoint=ep,
                    subnet=r["subnet"],
                    is_local=bool(r["is_local"]),
                    enabled=bool(r["enabled"]),
                )
            )
        return result

    def _reconcile_local_node() -> dict[str, int]:
        with db.conn() as c:
            rows = c.execute(
                """
                SELECT d.public_key, d.assigned_ip, d.device_name, u.username
                FROM devices d
                JOIN users u ON u.id = d.user_id
                JOIN nodes n ON n.id = d.node_id
                WHERE n.is_local = 1 AND d.enabled = 1 AND u.enabled = 1
                ORDER BY d.id ASC
                """
            ).fetchall()
        managed = [
            {
                "public_key": r["public_key"],
                "assigned_ip": r["assigned_ip"],
                "label": f"{r['username']}:{r['device_name']}",
            }
            for r in rows
        ]
        return wg_driver.reconcile_authoritative_peers(managed)

    # Purge any legacy raw unmanaged peers on startup so 3004-VPN exclusively manages wg0
    _reconcile_local_node()

    def _allocate_ip_for_node(c: Any, node_row: Any) -> str:
        net = ipaddress.ip_network(node_row["subnet"], strict=False)
        used = {node_row["server_ip"]}
        used.update(
            r["assigned_ip"]
            for r in c.execute("SELECT assigned_ip FROM devices WHERE node_id = ?", (node_row["id"],))
        )

        for host in net.hosts():
            ip_str = str(host)
            if ip_str not in used:
                return ip_str
        raise HTTPException(status_code=status.HTTP_507_INSUFFICIENT_STORAGE, detail="해당 노드에 남는 VPN IP가 없습니다.")

    @app.post("/api/v1/connect", response_model=ConnectResponse)
    def connect_device(req: ConnectRequest, user: dict[str, Any] = Depends(get_current_user)) -> ConnectResponse:
        with db.conn() as c:
            node = c.execute("SELECT * FROM nodes WHERE id = ? AND enabled = 1", (req.node_id,)).fetchone()
            if not node:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="선택한 VPN 노드를 찾을 수 없습니다.")

            existing = c.execute(
                "SELECT * FROM devices WHERE user_id = ? AND node_id = ? AND device_uid = ?",
                (user["id"], node["id"], req.device_uid),
            ).fetchone()

            if existing and not existing["enabled"]:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자에 의해 사용이 일시 정지된 기기입니다.")

            assigned_ip = existing["assigned_ip"] if existing else _allocate_ip_for_node(c, node)
            old_pub = existing["public_key"] if existing else None

            if req.client_public_key:
                priv_key = None
                pub_key = req.client_public_key.strip()
            else:
                priv_key, pub_key = wg_driver.generate_keypair()

            label = f"{user['username']}:{req.device_name}"
            if node["is_local"]:
                wg_driver.upsert_peer(pub_key, assigned_ip, label=label, old_public_key=old_pub)
                server_pub = wg_driver.get_server_public_key()
            else:
                agent = RemoteNodeAgentClient(node["agent_url"], node["agent_secret"])
                server_pub = agent.sync_peer(pub_key, assigned_ip, label=label, old_public_key=old_pub)

            now = utc_now_iso()
            if existing:
                c.execute(
                    """
                    UPDATE devices
                    SET device_name = ?, platform = ?, public_key = ?, mode = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (req.device_name, req.platform, pub_key, req.mode, now, existing["id"]),
                )
                device_id = existing["id"]
            else:
                cur = c.execute(
                    """
                    INSERT INTO devices (
                        user_id, node_id, device_uid, device_name, platform,
                        assigned_ip, public_key, mode, enabled, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    """,
                    (
                        user["id"],
                        node["id"],
                        req.device_uid,
                        req.device_name,
                        req.platform,
                        assigned_ip,
                        pub_key,
                        req.mode,
                        now,
                        now,
                    ),
                )
                device_id = int(cur.lastrowid)

        allowed_ips = "0.0.0.0/0" if req.mode == "full" else node["subnet"]
        dns_line = f"DNS = {node['dns']}\n" if req.mode == "full" else ""
        priv_placeholder = priv_key or "<CLIENT_LOCAL_PRIVATE_KEY>"
        config_text = (
            f"# 삼천포(3004) VPN | {node['name']} ({node['region']}) | {req.device_name}\n"
            f"[Interface]\n"
            f"PrivateKey = {priv_placeholder}\n"
            f"Address = {assigned_ip}/32\n"
            f"{dns_line}\n"
            f"[Peer]\n"
            f"PublicKey = {server_pub}\n"
            f"Endpoint = {node['endpoint']}\n"
            f"AllowedIPs = {allowed_ips}\n"
            f"PersistentKeepalive = 25\n"
        )
        return ConnectResponse(
            device_id=device_id,
            node_id=node["id"],
            node_name=node["name"],
            region=node["region"],
            assigned_ip=assigned_ip,
            dns=node["dns"],
            endpoint=node["endpoint"],
            server_public_key=server_pub,
            allowed_ips=allowed_ips,
            client_private_key=priv_key,
            client_public_key=pub_key,
            config=config_text,
        )

    # ---------------- Admin Endpoints ---------------- #

    @app.get("/api/v1/admin/overview")
    def admin_overview(_: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        live_stats = wg_driver.get_live_stats()
        with db.conn() as c:
            users = [_row_to_user(r).model_dump() for r in c.execute("SELECT * FROM users ORDER BY id ASC")]
            invites = [dict(r) for r in c.execute("SELECT * FROM invites ORDER BY id DESC")]
            nodes = [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "region": r["region"],
                    "country_flag": r["country_flag"],
                    "endpoint": r["endpoint"],
                    "subnet": r["subnet"],
                    "is_local": bool(r["is_local"]),
                    "enabled": bool(r["enabled"]),
                }
                for r in c.execute("SELECT * FROM nodes ORDER BY is_local DESC, created_at ASC")
            ]
            dev_rows = c.execute(
                """
                SELECT d.*, u.username, n.name AS node_name, n.is_local
                FROM devices d
                JOIN users u ON u.id = d.user_id
                JOIN nodes n ON n.id = d.node_id
                ORDER BY d.id DESC
                """
            ).fetchall()

        devices = []
        for d in dev_rows:
            st = live_stats.get(d["public_key"], {}) if d["is_local"] else {}
            devices.append(
                {
                    "id": d["id"],
                    "username": d["username"],
                    "node_id": d["node_id"],
                    "node_name": d["node_name"],
                    "device_name": d["device_name"],
                    "platform": d["platform"],
                    "assigned_ip": d["assigned_ip"],
                    "mode": d["mode"],
                    "enabled": bool(d["enabled"]),
                    "online": st.get("online", False) if d["enabled"] else False,
                    "handshake_ago_sec": st.get("handshake_ago_sec"),
                    "rx_bytes": st.get("rx_bytes", 0),
                    "tx_bytes": st.get("tx_bytes", 0),
                    "updated_at": d["updated_at"],
                }
            )
        return {"users": users, "invites": invites, "nodes": nodes, "devices": devices}

    @app.post("/api/v1/admin/users/{user_id}/role")
    def admin_update_user_role(
        user_id: int,
        req: UpdateUserRoleRequest,
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        if user_id == admin["id"] and req.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="본인 계정의 관리자 권한은 해제할 수 없습니다.",
            )
        with db.conn() as c:
            row = c.execute("SELECT id, username, role FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다.")
            c.execute("UPDATE users SET role = ? WHERE id = ?", (req.role, user_id))
        return {"id": user_id, "username": row["username"], "role": req.role}

    @app.post("/api/v1/admin/invites")
    def admin_create_invite(
        req: CreateInviteRequest,
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        code = generate_invite_code()
        now = utc_now_iso()
        with db.conn() as c:
            c.execute(
                "INSERT INTO invites (code, memo, max_uses, used_count, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)",
                (code, req.memo.strip(), req.max_uses, admin["id"], now),
            )
        return {"code": code, "memo": req.memo.strip(), "max_uses": req.max_uses, "used_count": 0, "created_at": now}

    @app.post("/api/v1/admin/devices/{device_id}/toggle")
    def admin_toggle_device(device_id: int, _: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        with db.conn() as c:
            row = c.execute(
                """
                SELECT d.*, u.username, n.is_local, n.agent_url, n.agent_secret
                FROM devices d
                JOIN users u ON u.id = d.user_id
                JOIN nodes n ON n.id = d.node_id
                WHERE d.id = ?
                """,
                (device_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="기기를 찾을 수 없습니다.")

            new_enabled = 0 if row["enabled"] else 1
            label = f"{row['username']}:{row['device_name']}"
            if row["is_local"]:
                if new_enabled:
                    wg_driver.upsert_peer(row["public_key"], row["assigned_ip"], label=label)
                else:
                    wg_driver.remove_peer(row["public_key"])
            else:
                agent = RemoteNodeAgentClient(row["agent_url"], row["agent_secret"])
                if new_enabled:
                    agent.sync_peer(row["public_key"], row["assigned_ip"], label=label)
                else:
                    agent.remove_peer(row["public_key"])

            c.execute("UPDATE devices SET enabled = ?, updated_at = ? WHERE id = ?", (new_enabled, utc_now_iso(), device_id))
        return {"id": device_id, "enabled": bool(new_enabled)}

    @app.delete("/api/v1/admin/devices/{device_id}")
    def admin_delete_device(device_id: int, _: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        with db.conn() as c:
            row = c.execute(
                """
                SELECT d.*, n.is_local, n.agent_url, n.agent_secret
                FROM devices d
                JOIN nodes n ON n.id = d.node_id
                WHERE d.id = ?
                """,
                (device_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="기기를 찾을 수 없습니다.")

            if row["is_local"]:
                wg_driver.remove_peer(row["public_key"])
            else:
                RemoteNodeAgentClient(row["agent_url"], row["agent_secret"]).remove_peer(row["public_key"])
            c.execute("DELETE FROM devices WHERE id = ?", (device_id,))
        return {"id": device_id, "deleted": True}

    @app.post("/api/v1/admin/reconcile")
    def admin_reconcile_peers(_: dict[str, Any] = Depends(require_admin)) -> dict[str, int]:
        return _reconcile_local_node()

    @app.post("/api/v1/admin/nodes")
    def admin_add_node(req: CreateNodeRequest, _: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        now = utc_now_iso()
        with db.conn() as c:
            if c.execute("SELECT 1 FROM nodes WHERE id = ?", (req.id,)).fetchone():
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 존재하는 노드 ID입니다.")
            c.execute(
                """
                INSERT INTO nodes (
                    id, name, region, country_flag, endpoint, subnet, server_ip, dns,
                    is_local, agent_url, agent_secret, enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
                """,
                (
                    req.id,
                    req.name,
                    req.region.upper(),
                    req.country_flag,
                    req.endpoint,
                    req.subnet,
                    req.server_ip,
                    req.dns,
                    req.agent_url,
                    req.agent_secret,
                    now,
                ),
            )
        return {"id": req.id, "name": req.name, "region": req.region.upper()}

    # ---------------- Secondary Node Agent Endpoints (for Oracle Cloud) ---------------- #

    @app.get("/agent/v1/info", dependencies=[Depends(verify_agent_secret)])
    def agent_info() -> dict[str, Any]:
        return {"server_public_key": wg_driver.get_server_public_key(), "stats": wg_driver.get_live_stats()}

    @app.post("/agent/v1/peers/sync", dependencies=[Depends(verify_agent_secret)])
    def agent_sync_peer(req: AgentSyncPeerRequest) -> dict[str, str]:
        wg_driver.upsert_peer(req.public_key, req.assigned_ip, label=req.device_label)
        return {"status": "ok", "server_public_key": wg_driver.get_server_public_key()}

    @app.post("/agent/v1/peers/remove", dependencies=[Depends(verify_agent_secret)])
    def agent_remove_peer(req: AgentRemovePeerRequest) -> dict[str, str]:
        wg_driver.remove_peer(req.public_key)
        return {"status": "ok"}

    return app


app = create_app()
