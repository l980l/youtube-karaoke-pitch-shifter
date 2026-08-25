/**
 * YouTube Karaoke In-Player UI & Controller
 */

class KaraokeUI {
  constructor(shifter) {
    this.shifter = shifter;
    this.container = null;
    this.overlayEl = null;
    this.osdEl = null;
    this.miniBtnEl = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.osdTimer = null;
    this.isMinimized = false;
    this.isVisible = true;

    // UI elements references
    this.pitchValueEl = null;
    this.tempoSliderEl = null;
    this.tempoValEl = null;
    this.volumeSliderEl = null;
    this.volumeValEl = null;
    this.vocalCutCheckEl = null;
  }

  /**
   * UI 초기화 및 DOM 주입
   */
  init() {
    this.findPlayerContainer();
    if (!this.container) {
      setTimeout(() => this.init(), 1000);
      return;
    }

    this.createOverlay();
    this.createOSD();
    this.injectMiniButton();
    this.bindEvents();
    this.bindShortcuts();
    this.updateUI();

    console.log('[Karaoke UI] UI Initialized Successfully');
  }

  /**
   * 유튜브 플레이어 컨테이너 찾기
   */
  findPlayerContainer() {
    this.container = document.querySelector('.html5-video-player') || document.body;
    return this.container;
  }

  /**
   * 플로팅 오버레이 리모콘 DOM 생성
   */
  createOverlay() {
    if (document.getElementById('yk-karaoke-overlay')) {
      this.overlayEl = document.getElementById('yk-karaoke-overlay');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'yk-karaoke-overlay';
    overlay.innerHTML = `
      <div class="yk-drag-handle" id="yk-drag-header">
        <div class="yk-title-area">
          <span class="yk-mic-icon">🎤</span>
          <span>노래방 키 조절기</span>
        </div>
        <div class="yk-header-controls">
          <button class="yk-icon-btn" id="yk-btn-minimize" title="최소화/펼치기">−</button>
          <button class="yk-icon-btn" id="yk-btn-close" title="숨기기 (Alt+M)">✕</button>
        </div>
      </div>

      <div class="yk-panel-body">
        <!-- Pitch LED Display -->
        <div class="yk-pitch-display-box">
          <div class="yk-pitch-label">CURRENT PITCH</div>
          <div class="yk-pitch-value-wrap">
            <span class="yk-pitch-value pitch-zero" id="yk-pitch-num">0</span>
            <span class="yk-pitch-unit" id="yk-pitch-unit">KEY</span>
          </div>
        </div>

        <!-- Main Pitch Buttons -->
        <div class="yk-btn-group-main">
          <button class="yk-btn yk-btn-down" id="yk-btn-down" title="반음 내리기 ([)">
            <span>♭</span> -1 키
          </button>
          <button class="yk-btn yk-btn-reset" id="yk-btn-reset" title="원곡 키 (\)">
            원키 (0)
          </button>
          <button class="yk-btn yk-btn-up" id="yk-btn-up" title="반음 올리기 (])">
            <span>♯</span> +1 키
          </button>
        </div>

        <!-- Presets -->
        <div class="yk-preset-row">
          <button class="yk-btn yk-btn-preset" id="yk-preset-male-to-female" title="남자가 여자 노래 부를 때: -4키">
            👨→👩 여키 (-4)
          </button>
          <button class="yk-btn yk-btn-preset" id="yk-preset-female-to-male" title="여자가 남자 노래 부를 때: +4키">
            👩→👨 남키 (+4)
          </button>
        </div>

        <!-- Sliders (Tempo & Boost) -->
        <div class="yk-slider-group">
          <div class="yk-slider-row">
            <span class="yk-slider-label">템포</span>
            <input type="range" class="yk-range-slider" id="yk-slider-tempo" min="0.7" max="1.3" step="0.05" value="1.0">
            <span class="yk-slider-val" id="yk-val-tempo">1.0x</span>
          </div>
          <div class="yk-slider-row">
            <span class="yk-slider-label">MR증폭</span>
            <input type="range" class="yk-range-slider" id="yk-slider-volume" min="0.5" max="2.0" step="0.05" value="1.0">
            <span class="yk-slider-val" id="yk-val-volume">100%</span>
          </div>
        </div>

        <!-- Vocal Cut Feature -->
        <div class="yk-toggle-row">
          <div class="yk-toggle-label">
            <span>보컬 컷 (가라오케 모드)</span>
            <span class="yk-badge-pro">MR모드</span>
          </div>
          <label class="yk-switch">
            <input type="checkbox" id="yk-chk-vocal-cut">
            <span class="yk-slider-round"></span>
          </label>
        </div>
      </div>

      <div class="yk-panel-footer">
        <span>단축키: <span class="yk-kbd">[</span> <span class="yk-kbd">]</span> <span class="yk-kbd">\\</span></span>
        <span>토글: <span class="yk-kbd">Alt+M</span></span>
      </div>
    `;

    this.container.appendChild(overlay);
    this.overlayEl = overlay;

    // Cache elements
    this.pitchValueEl = overlay.querySelector('#yk-pitch-num');
    this.pitchUnitEl = overlay.querySelector('#yk-pitch-unit');
    this.tempoSliderEl = overlay.querySelector('#yk-slider-tempo');
    this.tempoValEl = overlay.querySelector('#yk-val-tempo');
    this.volumeSliderEl = overlay.querySelector('#yk-slider-volume');
    this.volumeValEl = overlay.querySelector('#yk-val-volume');
    this.vocalCutCheckEl = overlay.querySelector('#yk-chk-vocal-cut');
  }

  /**
   * 화면 중앙 OSD (On-Screen Display) 생성
   */
  createOSD() {
    if (document.getElementById('yk-osd-toast')) {
      this.osdEl = document.getElementById('yk-osd-toast');
      return;
    }

    const osd = document.createElement('div');
    osd.id = 'yk-osd-toast';
    osd.innerText = 'ORIGINAL KEY (0)';
    this.container.appendChild(osd);
    this.osdEl = osd;
  }

  /**
   * 유튜브 하단 플레이어 컨트롤 바에 미니 버튼 주입
   */
  injectMiniButton() {
    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls || document.getElementById('yk-mini-bar-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'yk-mini-bar-btn';
    btn.className = 'ytp-button yk-ytp-btn';
    btn.title = '노래방 키 조절기 (Alt+M)';
    btn.innerHTML = `
      <svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%">
        <path d="M12 14c0 3.31 2.69 6 6 6s6-2.69 6-6V8c0-3.31-2.69-6-6-6s-6 2.69-6 6v6z" fill="#05D9E8"/>
        <path d="M23 14c0 2.76-2.24 5-5 5s-5-2.24-5-5H11c0 3.53 2.61 6.43 6 6.92V28h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z" fill="#05D9E8"/>
      </svg>
      <span class="yk-ytp-badge" id="yk-mini-badge">0</span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleVisibility();
    });

    rightControls.insertBefore(btn, rightControls.firstChild);
    this.miniBtnEl = btn;
  }

  /**
   * UI 이벤트 리스너 바인딩
   */
  bindEvents() {
    // 1. Drag & Drop
    const header = this.overlayEl.querySelector('#yk-drag-header');
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.yk-icon-btn')) return;
      this.isDragging = true;
      header.setPointerCapture(e.pointerId);
      const rect = this.overlayEl.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
    });

    header.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const parentRect = this.container.getBoundingClientRect();
      let left = e.clientX - parentRect.left - this.dragOffset.x;
      let top = e.clientY - parentRect.top - this.dragOffset.y;

      // Restrict inside parent
      left = Math.max(10, Math.min(parentRect.width - this.overlayEl.offsetWidth - 10, left));
      top = Math.max(10, Math.min(parentRect.height - this.overlayEl.offsetHeight - 10, top));

      this.overlayEl.style.left = `${left}px`;
      this.overlayEl.style.top = `${top}px`;
      this.overlayEl.style.right = 'auto';
    });

    const stopDrag = (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        try { header.releasePointerCapture(e.pointerId); } catch (err) {}
      }
    };
    header.addEventListener('pointerup', stopDrag);
    header.addEventListener('pointercancel', stopDrag);

    // 2. Minimize & Close
    this.overlayEl.querySelector('#yk-btn-minimize').addEventListener('click', () => {
      this.isMinimized = !this.isMinimized;
      this.overlayEl.classList.toggle('yk-minimized', this.isMinimized);
    });

    this.overlayEl.querySelector('#yk-btn-close').addEventListener('click', () => {
      this.toggleVisibility(false);
    });

    // 3. Pitch Buttons
    this.overlayEl.querySelector('#yk-btn-down').addEventListener('click', () => {
      this.changePitch(-1);
    });

    this.overlayEl.querySelector('#yk-btn-up').addEventListener('click', () => {
      this.changePitch(1);
    });

    this.overlayEl.querySelector('#yk-btn-reset').addEventListener('click', () => {
      this.setPitch(0);
    });

    // 4. Presets
    this.overlayEl.querySelector('#yk-preset-male-to-female').addEventListener('click', () => {
      this.setPitch(-4);
    });

    this.overlayEl.querySelector('#yk-preset-female-to-male').addEventListener('click', () => {
      this.setPitch(4);
    });

    // 5. Sliders
    this.tempoSliderEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.shifter.setTempo(val);
      this.tempoValEl.innerText = `${val.toFixed(2)}x`;
    });

    this.volumeSliderEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.shifter.setVolume(val);
      this.volumeValEl.innerText = `${Math.round(val * 100)}%`;
    });

    // 6. Vocal Cut
    this.vocalCutCheckEl.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.shifter.setVocalCut(enabled);
      this.showOSD(enabled ? '🎙️ 보컬 컷 (MR 모드) ON' : '🎵 일반 오디오 모드 OFF');
    });
  }

  /**
   * 단축키 바인딩
   */
  bindShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Input/Textarea 입력 중이면 단축키 무시
      if (e.target.matches('input, textarea, [contenteditable="true"]')) return;

      if (e.key === '[' || (e.altKey && (e.key === ',' || e.code === 'Comma'))) {
        e.preventDefault();
        this.changePitch(-1);
      } else if (e.key === ']' || (e.altKey && (e.key === '.' || e.code === 'Period'))) {
        e.preventDefault();
        this.changePitch(1);
      } else if (e.key === '\\' || (e.altKey && (e.key === '/' || e.key === '0' || e.code === 'Slash' || e.code === 'Digit0'))) {
        e.preventDefault();
        this.setPitch(0);
      } else if (e.altKey && (e.key === 'm' || e.key === 'M' || e.code === 'KeyM')) {
        e.preventDefault();
        this.toggleVisibility();
      } else if (e.altKey && (e.key === 'v' || e.key === 'V' || e.code === 'KeyV')) {
        e.preventDefault();
        const newState = !this.shifter.vocalCutEnabled;
        this.vocalCutCheckEl.checked = newState;
        this.shifter.setVocalCut(newState);
        this.showOSD(newState ? '🎙️ 보컬 컷 (MR 모드) ON' : '🎵 일반 오디오 모드 OFF');
      }
    }, true);
  }

  /**
   * 상대값으로 피치 변경
   */
  changePitch(delta) {
    const current = this.shifter.semitones;
    this.setPitch(current + delta);
  }

  /**
   * 절대값으로 피치 설정
   */
  setPitch(val) {
    const result = this.shifter.setPitch(val);
    this.updateUI();
    this.showOSDPitch(result);
    this.notifyStateChange();
  }

  /**
   * UI 상태 갱신
   */
  updateUI() {
    const state = this.shifter.getState();
    const semitones = state.semitones;

    if (this.pitchValueEl) {
      this.pitchValueEl.classList.remove('pitch-up', 'pitch-down', 'pitch-zero');
      if (semitones > 0) {
        this.pitchValueEl.innerText = `+${semitones}`;
        this.pitchValueEl.classList.add('pitch-up');
        this.pitchUnitEl.innerText = '♯ KEY (올림)';
      } else if (semitones < 0) {
        this.pitchValueEl.innerText = `${semitones}`;
        this.pitchValueEl.classList.add('pitch-down');
        this.pitchUnitEl.innerText = '♭ KEY (내림)';
      } else {
        this.pitchValueEl.innerText = '0';
        this.pitchValueEl.classList.add('pitch-zero');
        this.pitchUnitEl.innerText = 'ORIGINAL (원키)';
      }
    }

    // Mini Badge update
    const miniBadge = document.getElementById('yk-mini-badge');
    if (miniBadge) {
      miniBadge.innerText = semitones === 0 ? '0' : (semitones > 0 ? `+${semitones}` : `${semitones}`);
      miniBadge.style.background = semitones > 0 ? '#05D9E8' : (semitones < 0 ? '#FF2A6D' : 'rgba(255,255,255,0.25)');
      miniBadge.style.color = semitones === 0 ? '#fff' : '#12131C';
    }

    if (this.tempoSliderEl) this.tempoSliderEl.value = state.tempo;
    if (this.tempoValEl) this.tempoValEl.innerText = `${state.tempo.toFixed(2)}x`;
    if (this.volumeSliderEl) this.volumeSliderEl.value = state.volume;
    if (this.volumeValEl) this.volumeValEl.innerText = `${Math.round(state.volume * 100)}%`;
    if (this.vocalCutCheckEl) this.vocalCutCheckEl.checked = state.vocalCutEnabled;
  }

  /**
   * 피치 변경 시 OSD 토스트 표시
   */
  showOSDPitch(semitones) {
    let text = '';
    let isDown = false;

    if (semitones > 0) {
      text = `♯ KEY +${semitones} (올림)`;
    } else if (semitones < 0) {
      text = `♭ KEY ${semitones} (내림)`;
      isDown = true;
    } else {
      text = `ORIGINAL KEY (원곡 0)`;
    }

    this.showOSD(text, isDown);
  }

  /**
   * OSD 토스트 메시지 출력
   */
  showOSD(text, isDown = false) {
    if (!this.osdEl) return;
    this.osdEl.innerText = text;
    this.osdEl.classList.toggle('yk-osd-down', isDown);
    this.osdEl.classList.add('yk-osd-show');

    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => {
      this.osdEl.classList.remove('yk-osd-show');
    }, 1200);
  }

  /**
   * 오버레이 표시/숨김 토글
   */
  toggleVisibility(forced) {
    this.isVisible = (typeof forced === 'boolean') ? forced : !this.isVisible;
    if (this.overlayEl) {
      this.overlayEl.classList.toggle('yk-hidden', !this.isVisible);
    }
  }

  /**
   * 팝업 등에 상태 변경 브로드캐스팅
   */
  notifyStateChange() {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({
          type: 'KARAOKE_STATE_CHANGED',
          state: this.shifter.getState()
        }).catch(() => {});
      }
    } catch (e) {}
  }
}

// 전역 UI 인스턴스
window.__KaraokeUI = window.__KaraokeUI || null;
