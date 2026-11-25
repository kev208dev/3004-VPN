#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "오류: sudo로 실행해 주세요. 예: sudo ./scripts/deploy-backend.sh" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/3004-vpn"
PORT="8000"
WITH_TUNNEL="0"
AGENT_SECRET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --with-tunnel) WITH_TUNNEL="1"; shift ;;
    --agent-secret) AGENT_SECRET="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

echo "[1/5] 필수 Python 가상환경 패키지 확인 중..."
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip curl

# Ensure base node config exists if wg0 is present
if [[ ! -f "${INSTALL_DIR}/node.json" && -f "/etc/wireguard/wg0.conf" ]]; then
  "${REPO_DIR}/scripts/install-node.sh"
fi

echo "[2/5] 삼천포(3004) VPN 백엔드 코드 배포 중..."
mkdir -p "${INSTALL_DIR}/backend" "${INSTALL_DIR}/data"
chmod 750 "${INSTALL_DIR}" "${INSTALL_DIR}/data"
rm -rf "${INSTALL_DIR}/backend/app"
cp -r "${REPO_DIR}/backend/app" "${INSTALL_DIR}/backend/app"
cp "${REPO_DIR}/backend/requirements.txt" "${INSTALL_DIR}/backend/requirements.txt"

if [[ ! -d "${INSTALL_DIR}/venv" ]]; then
  python3 -m venv "${INSTALL_DIR}/venv"
fi
"${INSTALL_DIR}/venv/bin/pip" install -q --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install -q -r "${INSTALL_DIR}/backend/requirements.txt"

ENV_FILE="${INSTALL_DIR}/backend/.env"
touch "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
if [[ -n "${AGENT_SECRET}" ]]; then
  grep -v '^VPN3004_AGENT_SECRET=' "${ENV_FILE}" > "${ENV_FILE}.tmp" || true
  echo "VPN3004_AGENT_SECRET=${AGENT_SECRET}" >> "${ENV_FILE}.tmp"
  mv "${ENV_FILE}.tmp" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
fi

echo "[3/5] UFW 방화벽 내부망/VPN API 포트(${PORT}/tcp) 및 TCP MSS 클램핑 확인 중..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow from 192.168.45.0/24 to any port "${PORT}" proto tcp >/dev/null || true
  ufw allow from 10.77.0.0/24 to any port "${PORT}" proto tcp >/dev/null || true
fi
if command -v iptables >/dev/null 2>&1; then
  iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
    iptables -t mangle -I FORWARD 1 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu || true
fi

echo "[4/5] systemd 서비스(3004-vpn-api.service) 등록 및 시작..."
cat >/etc/systemd/system/3004-vpn-api.service <<EOF
[Unit]
Description=삼천포(3004) VPN Central Control Plane API
After=network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/backend
EnvironmentFile=-${ENV_FILE}
Environment=VPN3004_DATA_DIR=${INSTALL_DIR}/data
Environment=VPN3004_NODE_JSON=${INSTALL_DIR}/node.json
ExecStart=${INSTALL_DIR}/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now 3004-vpn-api.service
systemctl restart 3004-vpn-api.service

if [[ "${WITH_TUNNEL}" == "1" ]]; then
  echo "[5/5] 외부 접속용 무료 HTTPS 터널(cloudflared) 구성 중..."
  if ! command -v cloudflared >/dev/null 2>&1; then
    ARCH="$(dpkg --print-architecture)"
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -o /tmp/cloudflared.deb
    dpkg -i /tmp/cloudflared.deb
    rm -f /tmp/cloudflared.deb
  fi
  cat >/etc/systemd/system/3004-vpn-tunnel.service <<EOF
[Unit]
Description=Cloudflare HTTPS Tunnel for 3004-VPN API
After=3004-vpn-api.service
Wants=3004-vpn-api.service

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:${PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now 3004-vpn-tunnel.service
  systemctl restart 3004-vpn-tunnel.service
  sleep 4
  TUNNEL_URL="$(journalctl -u 3004-vpn-tunnel.service -n 30 --no-pager | grep -oE 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' | tail -n 1 || true)"
else
  echo "[5/5] 터널 옵션 생략됨 (필요 시 --with-tunnel 추가 가능)"
  TUNNEL_URL=""
fi

echo ""
echo "=========================================================="
echo " 삼천포(3004) VPN 백엔드 API 서버 배포 완료!"
echo " - 로컬/집 LAN 주소: http://$(hostname -I | awk '{print $1}'):${PORT}"
echo " - VPN 내부 주소:    http://10.77.0.1:${PORT}"
if [[ -n "${TUNNEL_URL}" ]]; then
  echo " - 외부 HTTPS 주소:  ${TUNNEL_URL}"
fi
echo "=========================================================="
