"""Zero-C-dependency PBKDF2 password hashing and HS256 JWT utilities."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any

PBKDF2_ITERATIONS = 310_000
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days for persistent desktop/mobile auto-connect


def get_or_create_secret(data_dir: Path) -> bytes:
    env_secret = os.environ.get("VPN3004_JWT_SECRET")
    if env_secret:
        return env_secret.encode("utf-8")

    data_dir.mkdir(parents=True, exist_ok=True)
    secret_file = data_dir / ".jwt_secret"
    if secret_file.exists():
        return secret_file.read_text(encoding="utf-8").strip().encode("utf-8")

    raw = secrets.token_urlsafe(48)
    secret_file.write_text(raw, encoding="utf-8")
    os.chmod(secret_file, 0o600)
    return raw.encode("utf-8")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algo, iter_str, salt_hex, hash_hex = stored_hash.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iter_str),
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def create_jwt(payload: dict[str, Any], secret: bytes, ttl: int = TOKEN_TTL_SECONDS) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    body = {**payload, "iat": now, "exp": now + ttl}
    h_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    p_b64 = _b64url_encode(json.dumps(body, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{h_b64}.{p_b64}".encode("ascii")
    sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
    return f"{h_b64}.{p_b64}.{_b64url_encode(sig)}"


def decode_jwt(token: str, secret: bytes) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("유효하지 않은 토큰 형식입니다.")
    h_b64, p_b64, s_b64 = parts
    signing_input = f"{h_b64}.{p_b64}".encode("ascii")
    expected_sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(_b64url_decode(s_b64), expected_sig):
        raise ValueError("토큰 서명이 유효하지 않습니다.")
    payload = json.loads(_b64url_decode(p_b64).decode("utf-8"))
    if int(payload.get("exp", 0)) < int(time.time()):
        raise ValueError("만료된 로그인 세션입니다. 다시 로그인해 주세요.")
    return payload


def generate_invite_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    p1 = "".join(secrets.choice(alphabet) for _ in range(4))
    p2 = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"3004-{p1}-{p2}"
