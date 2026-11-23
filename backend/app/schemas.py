"""Pydantic request and response schemas for 3004-VPN API."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


class BootstrapRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(..., min_length=6, max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(..., min_length=6, max_length=128)
    invite_code: str = Field(..., min_length=4, max_length=32)


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=32)
    password: str = Field(..., min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    role: Literal["admin", "member"]
    enabled: bool
    created_at: str


class AuthResponse(BaseModel):
    access_token: str
    user: UserOut


class NodeOut(BaseModel):
    id: str
    name: str
    region: str
    country_flag: str
    host: str
    port: int
    endpoint: str
    subnet: str
    is_local: bool
    enabled: bool


class ConnectRequest(BaseModel):
    node_id: str = Field(..., min_length=1, max_length=64)
    device_uid: str = Field(..., min_length=4, max_length=128)
    device_name: str = Field(..., min_length=1, max_length=64)
    platform: Literal["windows", "macos", "android", "ios", "linux", "other"] = "other"
    mode: Literal["full", "split"] = "full"
    client_public_key: str | None = None


class ConnectResponse(BaseModel):
    device_id: int
    node_id: str
    node_name: str
    region: str
    assigned_ip: str
    dns: str
    endpoint: str
    server_public_key: str
    allowed_ips: str
    client_private_key: str | None = None
    client_public_key: str
    config: str


class CreateInviteRequest(BaseModel):
    memo: str = Field(default="", max_length=100)
    max_uses: int = Field(default=1, ge=1, le=100)


class CreateNodeRequest(BaseModel):
    id: str = Field(..., min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(..., min_length=2, max_length=64)
    region: str = Field(..., min_length=2, max_length=8)
    country_flag: str = Field(default="🌐", max_length=8)
    endpoint: str = Field(..., min_length=5, max_length=128)
    subnet: str = Field(default="10.78.0.0/24")
    server_ip: str = Field(default="10.78.0.1")
    dns: str = Field(default="1.1.1.1, 8.8.8.8")
    agent_url: str = Field(..., min_length=8, max_length=255)
    agent_secret: str = Field(..., min_length=8, max_length=255)


class AgentSyncPeerRequest(BaseModel):
    public_key: str
    assigned_ip: str
    device_label: str


class AgentRemovePeerRequest(BaseModel):
    public_key: str
