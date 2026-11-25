# 3004 VPN

**Windows 데스크톱 프로그램(`.exe`) · macOS 데스크톱 앱(`.dmg`/`.app`) · Android/iOS 모바일 앱(`Flutter`)**을 모두 갖춘 풀스택 멀티 노드 WireGuard VPN 플랫폼입니다.

**3004 본사 서버(대한민국 · Raspberry Pi)**와 **글로벌 클라우드 서버(Oracle Cloud Free Tier — 미국/유럽/오세아니아)**를 하나의 중앙 API 컨트롤 플레인으로 묶어 상용 VPN 서비스처럼 원클릭 연결·서버 전환·내 기기 관리·초대코드 회원 관리를 수행합니다.

---

## 최신 버전 바로 다운로드

| 플랫폼 | 파일 | 다운로드 |
|---|---|---|
| **Windows (64-bit)** | `3004-VPN-Setup-Windows.exe` | [**Windows 설치파일 다운로드**](https://github.com/kev208dev/3004-VPN/releases/latest/download/3004-VPN-Setup-Windows.exe) |
| **macOS (Apple Silicon)** | `3004-VPN-macOS.dmg` | [**macOS 설치파일 다운로드**](https://github.com/kev208dev/3004-VPN/releases/latest/download/3004-VPN-macOS.dmg) |
| **Android** | `3004-VPN-Android.apk` | [**Android APK 다운로드**](https://github.com/kev208dev/3004-VPN/releases/latest/download/3004-VPN-Android.apk) |

- 전체 릴리스 페이지: [GitHub Releases (Latest)](https://github.com/kev208dev/3004-VPN/releases/latest)
- 실시간 자동 빌드 로그: [GitHub Actions](https://github.com/kev208dev/3004-VPN/actions)
- *macOS 최초 1회 사전 설치*: `brew install wireguard-tools`

---

## 모노레포 구조

```text
3004-VPN/
├── backend/                  # FastAPI 중앙 API 서버 + 멀티노드 에이전트 (SQLite + JWT)
│   ├── app/                  # 인증(부트스트랩/초대코드/로그인), 노드 관리, 원클릭 WireGuard 발급
│   └── tests/                # E2E API 자동화 테스트
├── desktop/                  # Windows (.exe) & macOS (.dmg/.app) 클라이언트 (Electron + React + TS)
│   ├── electron/             # 메뉴바/트레이 상주, 부팅 자동실행, OS별 WireGuard 터널 제어, 속도/핑 측정
│   └── src/                  # 한국어 다크 네온 UI & 관리자 센터
├── mobile/                   # Android (.apk) & iOS 크로스플랫폼 앱 (Flutter)
│   └── lib/                  # 네이티브 WireGuard 터널 구동, 공인 IP 배지, 서버 선택, 관리자 탭
├── src/vpn3004/              # 서버 로컬 CLI (`3004-vpn`) 코어 패키지
├── scripts/
│   ├── install-node.sh       # WireGuard 노드 초기 설치 스크립트
│   └── deploy-backend.sh     # 라즈베리파이/클라우드 API 서버 systemd + 무료 HTTPS 터널 배포 스크립트
└── .github/workflows/
    └── build-apps.yml        # 푸시 시 Windows(.exe), macOS(.dmg), Android(.apk) 자동 빌드 CI
```

---

## 주요 기능

1. **일렉트릭 원클릭 ON / OFF 전원 버튼 & 실시간 서버 전환:** 한국(3004 본사) 및 해외(Oracle Cloud) 노드 목록과 실시간 지연시간(`ms`) 표시
2. **내 기기 관리 페이지:** 현재 ID로 접속된 MacBook(macOS), Windows, Linux, Android, iOS 기기 목록 및 상태 확인·삭제
3. **실시간 공인 IP 보호 배지 & 속도 그래프:** 연결 전/후 내 공인 IP 변화 즉시 확인, 실시간 다운로드/업로드 속도 및 누적 데이터량 표시
4. **부팅 시 자동 실행 & 메뉴바/트레이 상주:** 창을 닫아도 트레이에서 백그라운드 유지, 시작 시 마지막 노드로 자동 재연결
5. **관리자 권한 제어 및 관리 콘솔:**
   - 지정된 **관리자(`Administrator`) 계정**에만 상단 `관리 콘솔` 노출
   - 초대코드(`3004-XXXX-XXXX`) 원클릭 생성, 전체 기기 온라인 확인·차단·삭제, 새 해외 노드(Oracle Cloud) 원격 등록

---

## 1. 라즈베리파이 백엔드 API 서버 배포 (1회)

라즈베리파이에서 아래 스크립트를 실행하면 `3004-vpn-api.service`가 재부팅 시에도 자동 실행되도록 등록됩니다.
`--with-tunnel` 옵션을 붙이면 공유기 이중 NAT 포트포워딩을 건드리지 않고도 외부(LTE/5G/외부 Wi-Fi)에서 접속 가능한 무료 HTTPS 주소(`https://....trycloudflare.com`)를 함께 열어줍니다.

```bash
cd ~/3004-VPN
git pull
sudo ./scripts/deploy-backend.sh --with-tunnel
```

- **VPN 연결 상태 내부 주소:** `http://10.77.0.1:8000`
- **집 Wi-Fi 내부 주소:** `http://192.168.45.236:8000`
- **외부 인터넷 초기 로그인 주소:** 출력된 `https://....trycloudflare.com` (또는 공유기 포트포워딩 도메인)

---

## 2. 클라이언트 설치 파일 다운로드 (GitHub Actions 자동 빌드)

코드를 GitHub `main` 브랜치에 푸시하면 **GitHub Actions(`Actions` 탭)**에서 자동으로 각 OS용 설치 파일을 만들어 줍니다.

- **Windows 노트북/PC:** `3004-VPN-Windows-Installer` 다운로드 → `.exe` 실행하여 설치
- **macOS (MacBook 등):** `3004-VPN-macOS-App` 다운로드 → `.dmg` / `.app` 실행
  *(Mac에서 앱 내부 직접 터널 구동을 쓰려면 `brew install wireguard-tools` 1회 설치)*
- **Android 스마트폰:** `3004-VPN-Android-APK` 다운로드 → `app-release.apk` 설치
- **iOS (아이폰):** Flutter 빌드 후 사용 가능하며, 유료 Apple 개발자 엔타이틀먼트가 없는 경우에도 앱 내 `[WireGuard 앱으로 열기]` 버튼으로 1초 만에 프로필 연동 가능

---

## 3. 로컬 개발 및 빌드 명령어

### Backend (FastAPI)
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. python -m unittest discover -s tests -v
uvicorn app.main:app --reload --port 8000
```

### Desktop (Electron + React + TypeScript)
```bash
cd desktop
npm install
npm run build
npm run dist:mac   # macOS .dmg / .zip 생성 (release/)
npm run dist:win   # Windows .exe 인스톨러 생성 (release/)
```

### Mobile (Flutter)
```bash
cd mobile
flutter pub get
flutter analyze
flutter test
flutter build apk --release
```
