# 🎤 유튜브 노래방 키 조절기 (YouTube Karaoke Key Pitch Shifter)

> **유튜브 노래방(TJ, 금영 노래방 등) 및 음악 영상의 음정(키, Pitch)을 속도 변화 없이 반음 단위로 실시간 조절할 수 있는 크롬 확장 프로그램입니다.**

<p align="center">
  <img src="icons/icon128.png" width="128" height="128" alt="유튜브 노래방 키 조절기 아이콘" />
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/cpfndkillhbblcfobjhoiindpdaaccdh">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-다운로드-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store Download" />
  </a>
  <img src="https://img.shields.io/badge/Version-1.1.0-FF2A6D?style=for-the-badge" alt="Version 1.1.0" />
  <img src="https://img.shields.io/badge/License-MIT-05D9E8?style=for-the-badge" alt="License" />
</p>

---

## 🚀 설치 방법

### 방법 1. Chrome 웹 스토어에서 원클릭 설치 (가장 추천)
👉 **[Chrome 웹 스토어 공식 설치 링크 바로가기](https://chromewebstore.google.com/detail/cpfndkillhbblcfobjhoiindpdaaccdh)**

스토어 페이지에서 **[Chrome에 추가]** 버튼을 클릭하시면 즉시 자동 설치됩니다. *(검토 승인 후 공개)*

---

### 방법 2. 직접 수동 설치 (개발자 모드)

1. 이 저장소의 코드를 다운로드하거나 클론합니다:
   ```bash
   git clone https://github.com/l980l/youtube-karaoke-pitch-shifter.git
   ```
2. 크롬 브라우저를 열고 주소창에 `chrome://extensions` 를 입력합니다.
3. 우측 상단의 **[개발자 모드 (Developer mode)]** 스위치를 켭니다.
4. **[압축해제된 확장 프로그램을 로드합니다]** 버튼을 누르고 프로젝트 폴더를 선택하거나, 폴더를 크롬 창 위로 **드래그 앤 드롭**합니다.
   *(macOS 사용자는 폴더 내 `quick_install.command` 파일을 더블클릭하면 더 쉽게 설치할 수 있습니다.)*

---

## ✨ 주요 기능

- 🎵 **실시간 반음 단위 키(Pitch) 조절**: 속도(BPM/Tempo)는 그대로 유지한 채 -12 ~ +12 반음(1 옥타브) 범위로 자유롭게 키 조절
- 👨‍🎤 **원클릭 빠른 프리셋**:
  - **여키 변환 (👨→👩 -4키)**: 남자가 여자 노래 부를 때 최적화
  - **남키 변환 (👩→👨 +4키)**: 여자가 남자 노래 부를 때 최적화
  - **원키 리셋 (0 Key)**: 즉시 원곡 키로 복구 (Bypass 모드로 음질 손실 0%)
- ⏱️ **템포(재생 속도) 미세 조절**: 0.7x ~ 1.3x 범위로 반주 속도 조절
- 🎙️ **보컬 컷 (가라오케 MR 추출 모드)**: 일반 원곡 뮤직비디오/음원에서 센터 보컬을 감쇄하여 노래방 반주로 활용
- 🔊 **MR 볼륨 부스터**: 작은 유튜브 반주 소리를 최대 200%까지 증폭
- 🎛️ **유튜브 플레이어 일체형 오버레이 리모콘**:
  - 전체화면 지원 플로팅 리모콘 및 미니 토스트(OSD) 알림
  - 기본 상태에서는 화면을 가리지 않도록 깔끔하게 숨겨져 있으며, 단축키나 버튼으로 호출 가능
- ⚡ **마스터 전원 ON / OFF 스위치**: 확장 프로그램을 켜고 끌 수 있는 원클릭 토글
- ⌨️ **단축키 완전 사용자 지정(Custom Key Binding)**: 팝업의 [⚙️ 단축키 설정] 탭에서 원하는 모든 키로 손쉽게 변경 가능

---

## ⌨️ 기본 단축키 안내 (사용자 지정 가능)

| 기능 | 기본 단축키 | 설명 |
| :--- | :--- | :--- |
| **반음 내리기 (♭ -1 Key)** | `[` | 반음 단위로 음정을 낮춥니다 |
| **반음 올리기 (♯ +1 Key)** | `]` | 반음 단위로 음정을 높입니다 |
| **원키로 리셋 (0 Key)** | `Alt + 0` | 원곡 키로 즉시 복귀합니다 |
| **리모콘 화면 표시/숨김** | `Alt + M` | 화면 내 리모콘을 표시하거나 숨깁니다 |
| **보컬 컷 (MR 모드) 토글** | `Alt + V` | 가라오케 보컬 제거 모드를 켜거나 끕니다 |
| **확장 프로그램 ON/OFF 토글** | `Alt + P` | 전체 기능을 켜거나 끕니다 |

*(유튜브 댓글창이나 검색창에 글을 작성 중일 때는 단축키가 작동하지 않도록 안전하게 보호됩니다.)*

---

## 💡 노래방 꿀팁

- **남자가 여자 노래를 부를 때**: `-4키` 또는 `-5키`를 내리면 가장 부르기 편한 음역대가 됩니다.
- **여자가 남자 노래를 부를 때**: `+4키` 또는 `+5키`를 올리면 자연스러운 고음역대로 소화할 수 있습니다.
- **MR이 없는 일반 곡**: `보컬 컷 (MR모드)` 스위치를 켜면 보컬이 제거되어 반주만 남으므로 어떤 노래든 노래방처럼 즐길 수 있습니다.

---

## 📁 프로젝트 파일 구조

```
wolfeel/
├── manifest.json            # Chrome Manifest V3 설정 파일
├── icons/                   # 고해상도 앱 아이콘 리소스
│   ├── icon.svg
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── popup/                   # 툴바 팝업 리모콘 & 단축키 설정 UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/                 # 유튜브 페이지 주입 스크립트 및 오버레이
│   ├── pitch-shifter.js     # Web Audio API 기반 고정밀 피치 시프터 오디오 엔진
│   ├── karaoke-ui.js        # 인플레이어 플로팅 리모콘 및 OSD 컨트롤러
│   ├── overlay.css          # 리모콘 UI 스타일시트
│   └── content.js           # Content Script 메인 진입점
├── background/              # 백그라운드 서비스 워커 (단축키 처리)
│   └── background.js
├── package.sh               # 배포용 ZIP 빌드 스크립트
├── quick_install.command    # macOS 원클릭 간편 설치 도우미
└── README.md                # 설명서 및 가이드
```
