# Tono — 유튜브 노래방 키 조절

> 이전 이름: 유튜브 노래방 키 조절기 (YouTube Karaoke Key Pitch Shifter)

**유튜브 노래방(TJ, 금영 등)과 음악 영상의 키(음정)를 속도 변화 없이 반음 단위로 실시간 조절하는 크롬 확장 프로그램입니다.**

<p align="center">
  <img src="icons/icon128.png" width="128" height="128" alt="Tono 아이콘" />
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/cpfndkillhbblcfobjhoiindpdaaccdh">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-다운로드-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store Download" />
  </a>
  <img src="https://img.shields.io/badge/Version-1.2.1-FF2A6D?style=for-the-badge" alt="Version 1.2.1" />
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
  - **남→여 −4**: 남자가 여자 노래 부를 때
  - **여→남 +4**: 여자가 남자 노래 부를 때
  - **원키**: 즉시 원곡 키로 복구 (처리 없이 원음 그대로)
- 💾 **곡별 키 자동 기억**: 곡마다 마지막으로 쓴 키를 기억했다가 다시 열면 자동 적용 (설정에서 끌 수 있음)
- ⏱️ **템포(재생 속도) 미세 조절**: 0.7x ~ 1.3x 범위로 반주 속도 조절 (유튜브 자체 속도 메뉴와 자동 동기화)
- 🎙️ **보컬 줄이기**: 일반 원곡 뮤직비디오/음원에서 가운데 목소리를 줄여 반주처럼 활용
- 🔊 **볼륨 부스트**: 작은 반주 소리를 최대 200%까지 (리미터로 클리핑 방지)
- 🎛️ **플레이어 위 화면 컨트롤**: 유튜브 컨트롤 바의 ♯ 버튼이나 `Alt + M`으로 표시. 전체화면 지원, 키 변경 시 짧은 알림 표시
- 🍎 **애플 스타일 디자인**: 시계 앱처럼 크고 얇은 키 숫자와 눈금 바늘, iOS 스타일 컨트롤, 시스템 라이트/다크 모드 자동 지원. 영상 위 컨트롤은 macOS 제어 센터 스타일, 키 변경 알림은 다이내믹 아일랜드 스타일
- ⚡ **마스터 전원 ON / OFF 스위치**: OFF 상태에서는 오디오 처리를 완전히 우회해 원음 그대로 재생
- ⌨️ **단축키 완전 사용자 지정(Custom Key Binding)**: 팝업의 [⚙️ 단축키 설정] 탭에서 원하는 모든 키로 손쉽게 변경 가능

---

## ⌨️ 기본 단축키 안내 (사용자 지정 가능)

| 기능 | 기본 단축키 | 설명 |
| :--- | :--- | :--- |
| **반음 내리기 (♭ -1 Key)** | `[` | 반음 단위로 음정을 낮춥니다 |
| **반음 올리기 (♯ +1 Key)** | `]` | 반음 단위로 음정을 높입니다 |
| **원키로 리셋 (0 Key)** | `Alt + 0` | 원곡 키로 즉시 복귀합니다 |
| **화면 컨트롤 표시/숨김** | `Alt + M` | 플레이어 위 컨트롤을 표시하거나 숨깁니다 |
| **보컬 줄이기 토글** | `Alt + V` | 보컬 줄이기를 켜거나 끕니다 |
| **확장 프로그램 ON/OFF 토글** | `Alt + P` | 전체 기능을 켜거나 끕니다 |

*(유튜브 댓글창이나 검색창에 글을 작성 중일 때는 단축키가 작동하지 않도록 안전하게 보호됩니다.)*

크롬 전역 단축키(`chrome://extensions/shortcuts`에서 변경 가능)도 함께 제공됩니다: `Alt + .` 키 올리기, `Alt + ,` 키 내리기, `Alt + 0` 원키, `Alt + M` 화면 컨트롤 표시.

---

## 💡 노래방 꿀팁

- **남자가 여자 노래를 부를 때**: `-4키` 또는 `-5키`를 내리면 가장 부르기 편한 음역대가 됩니다.
- **여자가 남자 노래를 부를 때**: `+4키` 또는 `+5키`를 올리면 자연스러운 고음역대로 소화할 수 있습니다.
- **MR이 없는 일반 곡**: `보컬 줄이기`를 켜면 가운데 목소리가 줄어 노래방처럼 즐길 수 있습니다. (가운데 정위된 보컬만 줄어듭니다)

---

## 📁 프로젝트 파일 구조

```
youtube-karaoke-pitch-shifter/
├── manifest.json            # Chrome Manifest V3 설정 파일
├── common/
│   └── config.js            # 팝업·콘텐츠 스크립트 공용 기본 설정, 단축키 매칭
├── icons/                   # 앱 아이콘 (오렌지 스퀘어클 + ♯)
│   ├── icon.svg             # 48·128px 원본
│   ├── icon-small.svg       # 16·32px용 굵은 획 버전
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── popup/                   # 툴바 팝업 (조절 / 설정 탭)
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/                 # 유튜브 페이지 주입 스크립트 및 오버레이
│   ├── pitch-shifter.js     # Web Audio 그래프 (원음 바이패스, 보컬 컷, 볼륨, 리미터)
│   ├── pitch-worklet.js     # 피크 고정(peak-locked) 위상 보코더 AudioWorklet 피치 엔진
│   ├── karaoke-ui.js        # 플레이어 위 화면 컨트롤 및 알림(OSD)
│   ├── overlay.css          # 화면 컨트롤 스타일
│   └── content.js           # Content Script 메인 진입점
├── background/              # 백그라운드 서비스 워커 (단축키 처리)
│   └── background.js
├── tests/                   # Node 테스트 (node --test tests/*.test.mjs)
├── docs/ai-wiki/            # 프로젝트 AI 위키 (Obsidian vault)
├── package.sh               # 배포용 ZIP 빌드 스크립트
├── quick_install.command    # macOS 원클릭 간편 설치 도우미
└── README.md                # 설명서 및 가이드
```

---

## 🧪 테스트

```bash
node --test tests/*.test.mjs
```

- `tests/pitch-worklet.test.mjs`: 피치 엔진을 오프라인으로 실행해 음정 오차(5 cent 이내), 음량 유지(±1.5 dB), 화음, 유휴 전환을 검증합니다.
- `tests/config.test.mjs`: 설정 병합, 단축키 매칭(Cmd+[ 오인식 방지 등), 영상 ID 파싱을 검증합니다.
