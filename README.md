# 삼천포(3004) VPN

WireGuard 기반 개인/멀티 노드 VPN 관리 엔진 및 CLI 프로젝트입니다.
집 내부 서버(Raspberry Pi — 한국 가정집 IP)와 클라우드 노드(Oracle Cloud Free Tier 등 — 해외 리전 IP)를 동일한 코어 엔진으로 관리하고, 향후 자체 웹 대시보드(FastAPI + Web UI)와 연동할 수 있도록 설계되었습니다.

---

## 주요 특징

- **원클릭 기기 발급 (`add`):** 빈 VPN IP 자동 할당, 키 쌍 메모리 생성, 무중단 실시간 WireGuard 반영(`wg set`), 즉시 사용 가능한 `.conf` 프로필 및 모바일 QR 코드 생성
- **상용 VPN식 상태 제어:** 기기를 삭제하지 않고 연결만 잠시 멈추는 **일시 차단(`disable`) / 재개(`enable`)** 지원
- **보안 우선 설계:** 클라이언트 개인 키(`PrivateKey`)는 발급 시점에만 생성되어 전달되며 서버 DB에 저장되지 않음
- **멀티 노드 & 웹 API 준비 완료:** 서버별 설정은 `node.json`으로 분리되어 있으며, 모든 CLI 기능은 `--json` 플래그 및 `VPNNodeManager` Python 클래스를 통해 웹 백엔드(FastAPI)에서 그대로 호출 가능

---

## 프로젝트 구조

```text
3004-VPN/
├── config/
│   └── node.example.json       # 노드 설정 예시 (KR 홈 서버 / 해외 클라우드 서버)
├── scripts/
│   └── install-node.sh         # VPN 노드 원클릭 설치 스크립트
├── src/vpn3004/
│   ├── node_manager.py         # 핵심 WireGuard + SQLite 관리 클래스 (API 재사용)
│   └── cli.py                  # 3004-vpn CLI 엔트리포인트
└── tests/
    └── test_node_manager.py    # 단위 테스트
```

---

## 빠른 설치 (VPN 서버 노드)

WireGuard(`wg0`)가 구성된 Linux 서버(Raspberry Pi OS / Debian / Ubuntu)에서 실행합니다. 기존 연결된 피어를 끊지 않고 자동으로 DB에 동기화합니다.

```bash
git clone https://github.com/kev208dev/3004-VPN.git
cd 3004-VPN

# 1) 한국 홈 서버 (DuckDNS가 설정된 경우 자동 감지)
sudo ./scripts/install-node.sh

# 2) 해외 클라우드 노드 예시 (Oracle Cloud JP 리전 등)
sudo ./scripts/install-node.sh --node-id jp-oracle-1 --name 3004-JP-ORACLE --region JP --endpoint <공인IP>:51820
```

---

## 사용 방법 (`3004-vpn`)

### 1. 서버에서 직접 실행할 때

```bash
# 등록된 기기 및 실시간 접속/트래픽 조회
sudo 3004-vpn list

# 새 노트북용 전체 VPN(.conf) 발급
sudo 3004-vpn add laptop2 > laptop2.conf

# 스마트폰용 QR 코드 출력
sudo 3004-vpn add iphone --qr

# 기기 이름 변경
sudo 3004-vpn rename device-3 main-laptop

# 기기 일시 정지 / 다시 허용 / 영구 삭제
sudo 3004-vpn disable laptop2
sudo 3004-vpn enable laptop2
sudo 3004-vpn remove laptop2
```

### 2. 원격 관리자 Windows PC(PowerShell)에서 한 줄로 새 노트북 파일 발급하기

```powershell
ssh nexus "sudo 3004-vpn add laptop2" | Set-Content .\3004-KR-laptop2.conf -Encoding Ascii
```

새 노트북에서는 생성된 `3004-KR-laptop2.conf` 파일을 WireGuard 앱에서 **`터널 추가` → `활성화`**만 누르면 바로 연결됩니다.

---

## 로드맵

- [x] Phase 1: WireGuard 자동 연결, DDNS 연동, 전체 트래픽 VPN 구성
- [x] Phase 2: `vpn3004` 멀티 노드 코어 엔진 및 `3004-vpn` 자동 발급 CLI
- [ ] Phase 3: Oracle Cloud Free Tier 해외 VPN 노드 연동
- [ ] Phase 4: FastAPI + 웹 대시보드 UI 구축 (노드 선택, 원클릭 프로필 다운로드, 트래픽 시각화)
