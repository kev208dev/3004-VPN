#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "오류: sudo로 실행해 주세요. 예: sudo ./scripts/install-node.sh" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/3004-vpn"
IFACE="wg0"
REGION="KR"
NODE_ID="kr-home-1"
NODE_NAME="3004-KR-HOME"
ENDPOINT=""
DNS_SERVERS="1.1.1.1, 8.8.8.8"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --region)   REGION="$2"; shift 2 ;;
    --node-id)  NODE_ID="$2"; shift 2 ;;
    --name)     NODE_NAME="$2"; shift 2 ;;
    --iface)    IFACE="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

WG_CONF="/etc/wireguard/${IFACE}.conf"
if [[ ! -f "${WG_CONF}" ]]; then
  echo "오류: ${WG_CONF} 파일이 없습니다. 먼저 WireGuard 인터페이스를 구성해 주세요." >&2
  exit 1
fi

if [[ ! -f "${WG_CONF}.pre-3004.bak" ]]; then
  cp -a "${WG_CONF}" "${WG_CONF}.pre-3004.bak"
  chmod 600 "${WG_CONF}.pre-3004.bak"
fi

# Auto-detect server IP, subnet, listen port from wg0.conf
ADDR_CIDR="$(awk -F'=' '/^[[:space:]]*Address[[:space:]]*=/{gsub(/[[:space:]]/,"",$2); split($2,a,","); print a[1]; exit}' "${WG_CONF}")"
LISTEN_PORT="$(awk -F'=' '/^[[:space:]]*ListenPort[[:space:]]*=/{gsub(/[[:space:]]/,"",$2); print $2; exit}' "${WG_CONF}")"
LISTEN_PORT="${LISTEN_PORT:-51820}"
SERVER_IP="${ADDR_CIDR%/*}"
SUBNET="$(python3 -c "import ipaddress,sys; print(ipaddress.ip_interface(sys.argv[1]).network)" "${ADDR_CIDR}")"

# Auto-detect endpoint (DuckDNS if present, otherwise public IPv4)
if [[ -z "${ENDPOINT}" ]]; then
  if [[ -f /etc/duckdns/duckdns.env ]]; then
    # shellcheck disable=SC1091
    source /etc/duckdns/duckdns.env
    ENDPOINT="${DUCKDNS_DOMAIN}.duckdns.org:${LISTEN_PORT}"
  else
    PUB_IP="$(curl -4 -fsS --max-time 5 https://api.ipify.org || true)"
    if [[ -z "${PUB_IP}" ]]; then
      echo "오류: 공인 IP를 자동 감지할 수 없습니다. --endpoint <도메인또는IP:포트> 옵션을 지정해 주세요." >&2
      exit 1
    fi
    ENDPOINT="${PUB_IP}:${LISTEN_PORT}"
  fi
fi

# Install optional qrencode for mobile QR generation
if ! command -v qrencode >/dev/null 2>&1; then
  apt-get update -qq || true
  apt-get install -y -qq qrencode || true
fi

mkdir -p "${INSTALL_DIR}"
chmod 750 "${INSTALL_DIR}"
rm -rf "${INSTALL_DIR}/vpn3004"
cp -r "${REPO_DIR}/src/vpn3004" "${INSTALL_DIR}/vpn3004"

if [[ ! -f "${INSTALL_DIR}/node.json" ]]; then
  python3 - "${INSTALL_DIR}/node.json" "${NODE_ID}" "${NODE_NAME}" "${REGION}" "${IFACE}" "${ENDPOINT}" "${SUBNET}" "${SERVER_IP}" "${DNS_SERVERS}" <<'PY'
import json, pathlib, sys
p, nid, nname, reg, iface, ep, sub, sip, dns = sys.argv[1:]
pathlib.Path(p).write_text(json.dumps({
    "node_id": nid,
    "node_name": nname,
    "region": reg,
    "interface": iface,
    "endpoint": ep,
    "subnet": sub,
    "server_ip": sip,
    "dns": dns,
}, indent=2) + "\n", encoding="utf-8")
PY
  chmod 640 "${INSTALL_DIR}/node.json"
fi

cat >/usr/local/bin/3004-vpn <<'WRAP'
#!/usr/bin/env bash
export PYTHONPATH="/opt/3004-vpn"
exec python3 -m vpn3004.cli "$@"
WRAP
chmod 755 /usr/local/bin/3004-vpn

ADMIN_USER="${SUDO_USER:-}"
if [[ -n "${ADMIN_USER}" && "${ADMIN_USER}" != "root" ]]; then
  echo "${ADMIN_USER} ALL=(root) NOPASSWD: /usr/local/bin/3004-vpn" >/etc/sudoers.d/3004-vpn
  chmod 440 /etc/sudoers.d/3004-vpn
  visudo -cf /etc/sudoers.d/3004-vpn >/dev/null
fi

echo "=== 삼천포(3004) VPN 노드 설치 완료 ==="
/usr/local/bin/3004-vpn list
