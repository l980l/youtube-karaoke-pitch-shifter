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
    this.isVisible = false; // 기본값: 숨김 상태 (자동 팝업 방지)
    this.config = mergeKaraokeConfig(null);

    // UI elements references
    this.pitchValueEl = null;
    this.tempoSliderEl = null;
    this.tempoValEl = null;
    this.volumeSliderEl = null;
    this.volumeValEl = null;
    this.vocalCutCheckEl = null;
    this.powerBtnEl = null;
  }

  /**
   * UI 초기화 및 DOM 주입
   */
  async init() {
    await this.loadConfig();
    // 플레이어 DOM을 기다리는 동안에도 저장된 ON/OFF 상태가 오디오에 적용되어야 한다.
    if (this.shifter.enabled !== this.config.enabled) this.shifter.setEnabled(this.config.enabled);
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

    // 초기 활성화 상태 동기화
    this.setEnabled(this.config.enabled, false);

    console.log('[Karaoke UI] UI Initialized Successfully');
  }

  /**
   * 사용자 설정 및 단축키 로드
   */
  async loadConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['karaokeConfig'], (res) => {
          this.config = mergeKaraokeConfig(res && res.karaokeConfig);
          resolve(this.config);
        });
      } catch (e) {
        resolve(this.config);
      }
    });
  }

  /**
   * 설정 변경 반영
   */
  updateConfig(newConfig) {
    if (!newConfig) return;
    this.config = mergeKaraokeConfig(Object.assign({}, this.config, newConfig));
    if (newConfig.enabled !== undefined) {
      this.setEnabled(newConfig.enabled, false);
    }
  }

  /**
   * 유튜브 플레이어 컨테이너 찾기
   */
  findPlayerContainer() {
    this.container = document.querySelector('.html5-video-player') || document.body;
    return this.container;
  }

  /**
   * 플레이어 위 화면 컨트롤 DOM 생성
   */
  createOverlay() {
    if (document.getElementById('yk-karaoke-overlay')) {
      this.overlayEl = document.getElementById('yk-karaoke-overlay');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'yk-karaoke-overlay';
    overlay.className = 'yk-hidden'; // 기본적으로 숨김 처리
    overlay.innerHTML = `
      <div class="yk-header" id="yk-drag-header">
        <span class="yk-title">Tono</span>
        <span class="yk-status" id="yk-footer-power-btn">켜짐</span>
        <div class="yk-header-controls">
          <button class="yk-icon-btn yk-power-toggle" id="yk-btn-power" title="켜기/끄기" aria-label="켜기/끄기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0"/></svg></button>
          <button class="yk-icon-btn" id="yk-btn-minimize" title="접기/펼치기" aria-label="접기/펼치기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button>
          <button class="yk-icon-btn" id="yk-btn-close" title="숨기기" aria-label="숨기기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>
        </div>
      </div>

      <div class="yk-panel-body">
        <div class="yk-key-row">
          <button class="yk-step" id="yk-btn-down" title="반음 내리기" aria-label="반음 내리기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button>
          <div class="yk-key-readout">
            <span class="yk-pitch-value pitch-zero" id="yk-pitch-num">0</span>
            <span class="yk-pitch-unit" id="yk-pitch-unit">원키</span>
          </div>
          <button class="yk-step" id="yk-btn-up" title="반음 올리기" aria-label="반음 올리기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg></button>
        </div>

        <div class="yk-chips">
          <button class="yk-chip" id="yk-preset-male-to-female" title="남자가 여자 노래를 부를 때">남→여 −4</button>
          <button class="yk-chip yk-chip-reset" id="yk-btn-reset">원키</button>
          <button class="yk-chip" id="yk-preset-female-to-male" title="여자가 남자 노래를 부를 때">여→남 +4</button>
        </div>

        <div class="yk-row">
          <span class="yk-row-label">속도</span>
          <input type="range" class="yk-range" id="yk-slider-tempo" min="0.7" max="1.3" step="0.05" value="1.0" aria-label="속도">
          <span class="yk-row-value" id="yk-val-tempo">1.00×</span>
        </div>
        <div class="yk-row">
          <span class="yk-row-label">볼륨</span>
          <input type="range" class="yk-range" id="yk-slider-volume" min="0.5" max="2.0" step="0.05" value="1.0" aria-label="볼륨">
          <span class="yk-row-value" id="yk-val-volume">100%</span>
        </div>

        <label class="yk-row yk-toggle-row">
          <span class="yk-row-label">보컬 줄이기</span>
          <span class="yk-switch">
            <input type="checkbox" id="yk-chk-vocal-cut">
            <span class="yk-track"></span>
          </span>
        </label>
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
    this.powerBtnEl = overlay.querySelector('#yk-btn-power');
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
    osd.innerText = '원키';
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
    btn.title = 'Tono 키 조절';
    btn.innerHTML = `
      <svg height="100%" viewBox="0 0 36 36" width="100%" aria-hidden="true">
        <g fill="#fff">
          <rect x="15" y="9" width="2.2" height="18" rx="1.1"/>
          <rect x="19.8" y="8.2" width="2.2" height="18" rx="1.1"/>
          <path d="M11.5 15.2 L24.5 12 L24.5 15.4 L11.5 18.6 Z"/>
          <path d="M11.5 21 L24.5 17.8 L24.5 21.2 L11.5 24.4 Z"/>
        </g>
      </svg>
      <span class="yk-ytp-badge" id="yk-mini-badge" hidden></span>
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

    // 2. Minimize & Close & Power Toggle
    this.overlayEl.querySelector('#yk-btn-minimize').addEventListener('click', () => {
      this.isMinimized = !this.isMinimized;
      this.overlayEl.classList.toggle('yk-minimized', this.isMinimized);
    });

    this.overlayEl.querySelector('#yk-btn-close').addEventListener('click', () => {
      this.toggleVisibility(false);
    });

    this.powerBtnEl.addEventListener('click', () => {
      const newEnabled = !this.shifter.enabled;
      this.setEnabled(newEnabled, true);
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
      this.tempoValEl.innerText = `${val.toFixed(2)}×`;
      this.notifyStateChange();
    });

    this.volumeSliderEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.shifter.setVolume(val);
      this.volumeValEl.innerText = `${Math.round(val * 100)}%`;
      this.notifyStateChange();
    });

    // 6. Vocal Cut
    this.vocalCutCheckEl.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.shifter.setVocalCut(enabled);
      this.showOSD(enabled ? '보컬 줄이기 켜짐' : '보컬 줄이기 꺼짐');
      this.notifyStateChange();
    });
  }

  /**
   * 단축키 매칭 헬퍼
   */
  isShortcutMatch(e, binding) {
    return isKaraokeShortcutMatch(e, binding);
  }

  /**
   * 사용자 지정 단축키 바인딩
   */
  bindShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Input/Textarea 입력 중이면 단축키 무시
      const target = e.composedPath ? e.composedPath()[0] : e.target;
      if (target && (target.isContentEditable ||
          (target.matches && target.matches('input, textarea, select')))) return;

      const s = this.config.shortcuts;
      if (!s) return;

      // 1. 전원 토글 (기능 꺼져 있어도 작동해야 함)
      if (this.isShortcutMatch(e, s.togglePower)) {
        e.preventDefault();
        const newEnabled = !this.shifter.enabled;
        this.setEnabled(newEnabled, true);
        return;
      }

      // 기능이 꺼져 있으면 다른 단축키는 작동하지 않음
      if (!this.shifter.enabled) return;

      // 2. 피치 내리기
      if (this.isShortcutMatch(e, s.pitchDown)) {
        e.preventDefault();
        this.changePitch(-1);
      }
      // 3. 피치 올리기
      else if (this.isShortcutMatch(e, s.pitchUp)) {
        e.preventDefault();
        this.changePitch(1);
      }
      // 4. 원키 리셋
      else if (this.isShortcutMatch(e, s.pitchReset)) {
        e.preventDefault();
        this.setPitch(0);
      }
      // 5. UI 토글
      else if (this.isShortcutMatch(e, s.toggleUI)) {
        e.preventDefault();
        this.toggleVisibility();
      }
      // 6. 보컬 컷 토글
      else if (this.isShortcutMatch(e, s.toggleVocalCut)) {
        e.preventDefault();
        const newState = !this.shifter.vocalCutEnabled;
        this.shifter.setVocalCut(newState);
        this.updateUI();
        this.notifyStateChange();
        this.showOSD(newState ? '보컬 줄이기 켜짐' : '보컬 줄이기 꺼짐');
      }
    }, true);
  }

  /**
   * 마스터 활성화 / 비활성화 처리
   */
  setEnabled(enabled, notify = true) {
    this.shifter.setEnabled(enabled);
    this.config.enabled = enabled;

    if (this.overlayEl) {
      this.overlayEl.classList.toggle('yk-power-off', !enabled);
      if (this.powerBtnEl) this.powerBtnEl.classList.toggle('yk-on', enabled);
      const status = this.overlayEl.querySelector('#yk-footer-power-btn');
      if (status) status.innerText = enabled ? '켜짐' : '꺼짐';
    }

    if (notify) {
      this.showOSD(enabled ? 'Tono 켜짐' : 'Tono 꺼짐 · 원음 재생');
      try {
        chrome.storage.local.set({
          karaokeConfig: Object.assign({}, this.config, { enabled })
        });
      } catch (e) {}
      this.notifyStateChange();
    }

    this.updateUI();
  }

  /**
   * 상대값으로 피치 변경
   */
  changePitch(delta) {
    if (!this.shifter.enabled) return;
    const current = this.shifter.semitones;
    this.setPitch(current + delta);
  }

  /**
   * 절대값으로 피치 설정
   */
  setPitch(val) {
    if (!this.shifter.enabled) return;
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
        this.pitchUnitEl.innerText = `${semitones}키 올림`;
      } else if (semitones < 0) {
        this.pitchValueEl.innerText = `−${Math.abs(semitones)}`;
        this.pitchValueEl.classList.add('pitch-down');
        this.pitchUnitEl.innerText = `${Math.abs(semitones)}키 내림`;
      } else {
        this.pitchValueEl.innerText = '0';
        this.pitchValueEl.classList.add('pitch-zero');
        this.pitchUnitEl.innerText = '원키';
      }
    }

    // Mini Badge update
    const miniBadge = document.getElementById('yk-mini-badge');
    if (miniBadge) {
      // 원키·ON이면 배지를 숨겨 유튜브 기본 버튼처럼 보이게 한다.
      const showBadge = !state.enabled || semitones !== 0;
      miniBadge.hidden = !showBadge;
      miniBadge.classList.toggle('yk-off', !state.enabled);
      miniBadge.innerText = !state.enabled ? 'OFF' : (semitones > 0 ? `+${semitones}` : `−${Math.abs(semitones)}`);
    }

    if (this.tempoSliderEl) this.tempoSliderEl.value = state.tempo;
    if (this.tempoValEl) this.tempoValEl.innerText = `${state.tempo.toFixed(2)}×`;
    if (this.volumeSliderEl) this.volumeSliderEl.value = state.volume;
    if (this.volumeValEl) this.volumeValEl.innerText = `${Math.round(state.volume * 100)}%`;
    if (this.vocalCutCheckEl) this.vocalCutCheckEl.checked = state.vocalCutEnabled;
  }

  /**
   * 피치 변경 시 OSD 토스트 표시
   */
  showOSDPitch(semitones) {
    if (semitones > 0) this.showOSD(`+${semitones}  ·  ${semitones}키 올림`);
    else if (semitones < 0) this.showOSD(`−${Math.abs(semitones)}  ·  ${Math.abs(semitones)}키 내림`, true);
    else this.showOSD('원키');
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
