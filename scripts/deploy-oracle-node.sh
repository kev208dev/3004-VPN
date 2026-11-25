#!/usr/bin/env bash
set -euo pipefail

# 3004 VPN — Oracle Cloud Always Free Remote Node One-Click Installer
# Supports Ubuntu 22.04 / 24.04 (ARM Ampere A1 & AMD E2.1.Micro)
#
# Example usage:
#   Europe (Frankfurt):
#     sudo ./scripts/deploy-oracle-node.sh --node-id eu-de-1 --region DE --name "유럽 · 프랑크푸르트" --subnet 10.78.0.0/24
#   US West (San Jose / Phoenix):
#     sudo ./scripts/deploy-oracle-node.sh --node-id us-west-1 --region US --name "미국 · 서부" --subnet 10.79.0.0/24
#   Oceania / Middle East (Sydney / Dubai):
#     sudo ./scripts/deploy-oracle-node.sh --node-id oc-au-1 --region AU --name "오세아니아 · 시드니" --subnet 10.80.0.0/24

if [[ "${EUID}" -ne 0 ]]; then
  echo "오류: sudo로 실행해 주세요." >&2
  exit 1
fi

NODE_ID="eu-de-1"
REGION="DE"
NODE_NAME="유럽 · 프랑크푸르트"
SUBNET="10.78.0.0/24"
WG_PORT="51820"
AGENT_PORT="8000"
IFACE="wg0"
AGENT_SECRET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node-id)      NODE_ID="$2"; shift 2 ;;
    --region)       REGION="$2"; shift 2 ;;
    --name)         NODE_NAME="$2"; shift 2 ;;
    --subnet)       SUBNET="$2"; shift 2 ;;
    --wg-port)      WG_PORT="$2"; shift 2 ;;
    --agent-port)   AGENT_PORT="$2"; shift 2 ;;
    --secret)       AGENT_SECRET="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_IP="$(python3 -c "import ipaddress,sys; print(next(ipaddress.ip_network(sys.argv[1], strict=False).hosts()))" "${SUBNET}")"
PREFIX_LEN="${SUBNET#*/}"
WAN_IFACE="$(ip route show default | awk '/default/{print $5; exit}')"
if [[ -z "${WAN_IFACE}" ]]; then
  echo "오류: 기본 네트워크 인터페이스를 찾지 못했습니다." >&2
  exit 1
fi

echo "[1/6] 필수 패키지 설치 (wireguard, python3, iptables-persistent)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard wireguard-tools python3 python3-venv curl iptables-persistent

echo "[2/6] IPv4 패킷 포워딩 활성화..."
cat >/etc/sysctl.d/99-3004-vpn.conf <<'SYSCTL'
net.ipv4.ip_forward=1
net.ipv4.conf.all.src_valid_mark=1
SYSCTL
sysctl --system >/dev/null

echo "[3/6] WireGuard 키 생성 및 /etc/wireguard/${IFACE}.conf 구성..."
mkdir -p /etc/wireguard
chmod 700 /etc/wireguard
if [[ ! -f "/etc/wireguard/${IFACE}.conf" ]]; then
  PRIV_KEY="$(wg genkey)"
  cat >"/etc/wireguard/${IFACE}.conf" <<WGCONF
[Interface]
Address = ${SERVER_IP}/${PREFIX_LEN}
ListenPort = ${WG_PORT}
PrivateKey = ${PRIV_KEY}
MTU = 1280
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ${WAN_IFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ${WAN_IFACE} -j MASQUERADE
WGCONF
  chmod 600 "/etc/wireguard/${IFACE}.conf"
fi

echo "[4/6] Oracle Cloud Ubuntu iptables 방화벽 규칙 허용 (UDP ${WG_PORT}, TCP ${AGENT_PORT})..."
iptables -C INPUT -p udp --dport "${WG_PORT}" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport "${WG_PORT}" -j ACCEPT
iptables -C INPUT -p tcp --dport "${AGENT_PORT}" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "${AGENT_PORT}" -j ACCEPT
iptables -C FORWARD -i "${IFACE}" -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i "${IFACE}" -j ACCEPT
iptables -C FORWARD -o "${IFACE}" -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -o "${IFACE}" -j ACCEPT
netfilter-persistent save >/dev/null 2>&1 || iptables-save >/etc/iptables/rules.v4

systemctl enable --now "wg-quick@${IFACE}.service"

echo "[5/6] 3004 VPN 원격 에이전트 설치 (/opt/3004-vpn)..."
INSTALL_DIR="/opt/3004-vpn"
mkdir -p "${INSTALL_DIR}/data"
rm -rf "${INSTALL_DIR}/backend"
cp -r "${REPO_DIR}/backend" "${INSTALL_DIR}/backend"

if [[ ! -d "${INSTALL_DIR}/venv" ]]; then
  python3 -m venv "${INSTALL_DIR}/venv"
fi
"${INSTALL_DIR}/venv/bin/pip" install -q --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install -q -r "${INSTALL_DIR}/backend/requirements.txt"

SECRET_FILE="${INSTALL_DIR}/agent.secret"
if [[ -n "${AGENT_SECRET}" ]]; then
  printf '%s\n' "${AGENT_SECRET}" >"${SECRET_FILE}"
elif [[ ! -f "${SECRET_FILE}" ]]; then
  python3 -c "import secrets; print(secrets.token_urlsafe(32))" >"${SECRET_FILE}"
fi
chmod 600 "${SECRET_FILE}"
AGENT_SECRET="$(cat "${SECRET_FILE}")"

echo "[6/6] systemd 서비스 등록 및 기동 (3004-vpn-agent.service)..."
cat >/etc/systemd/system/3004-vpn-agent.service <<SERVICE
[Unit]
Description=3004 VPN Remote Node Agent (${NODE_ID})
After=network-online.target wg-quick@${IFACE}.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/backend
Environment=VPN3004_DATA_DIR=${INSTALL_DIR}/data
Environment=VPN3004_IFACE=${IFACE}
Environment=VPN3004_AGENT_SECRET=${AGENT_SECRET}
ExecStart=${INSTALL_DIR}/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${AGENT_PORT}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now 3004-vpn-agent.service

PUB_IP="$(curl -4 -fsS --max-time 6 https://api.ipify.org || hostname -I | awk '{print $1}')"

echo ""
echo "=================================================================="
echo "  3004 VPN 원격 오라클 노드 설치 완료!"
echo "=================================================================="
echo "  [3004 VPN 앱 -> 관리 콘솔 -> + 노드 등록에 그대로 입력하세요]"
echo ""
echo "  노드 ID            : ${NODE_ID}"
echo "  국가 코드          : ${REGION}"
echo "  표시 이름          : ${NODE_NAME}"
echo "  WireGuard Endpoint : ${PUB_IP}:${WG_PORT}"
echo "  서브넷             : ${SUBNET}"
echo "  서버 IP            : ${SERVER_IP}"
echo "  에이전트 API URL   : http://${PUB_IP}:${AGENT_PORT}"
echo "  에이전트 시크릿    : ${AGENT_SECRET}"
echo "=================================================================="
echo "  주의: Oracle Cloud 콘솔 -> VCN -> Security List 인바운드 규칙에"
echo "    1) UDP ${WG_PORT} (0.0.0.0/0)"
echo "    2) TCP ${AGENT_PORT} (0.0.0.0/0 또는 라즈베리파이 공인 IP/32)"
echo "  두 포트가 반드시 열려 있어야 합니다!"
echo "=================================================================="
