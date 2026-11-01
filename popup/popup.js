/**
 * Popup Script - YouTube Karaoke Key Shifter
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const popupContainer = document.querySelector('.popup-container');
  const chkMasterPower = document.getElementById('chk-master-power');
  const powerStatusLabel = document.getElementById('power-status-label');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const notYtCard = document.getElementById('not-yt-card');
  const mainContent = document.getElementById('main-content');
  const btnOpenYt = document.getElementById('btn-open-yt');

  // Tabs
  const tabBtnRemote = document.getElementById('tab-btn-remote');
  const tabBtnSettings = document.getElementById('tab-btn-settings');
  const tabContentRemote = document.getElementById('tab-content-remote');
  const tabContentSettings = document.getElementById('tab-content-settings');

  // Pitch controls
  const pitchNumber = document.getElementById('pitch-number');
  const pitchTag = document.getElementById('pitch-tag');
  const pitchRangeSlider = document.getElementById('pitch-range-slider');

  const btnStepDown = document.getElementById('btn-step-down');
  const btnStepUp = document.getElementById('btn-step-up');
  const btnPitchReset = document.getElementById('btn-pitch-reset');

  const presetM2F = document.getElementById('preset-m2f');
  const presetF2M = document.getElementById('preset-f2m');
  const presetMinus2 = document.getElementById('preset-minus2');
  const presetPlus2 = document.getElementById('preset-plus2');

  const sliderTempo = document.getElementById('slider-tempo');
  const valTempo = document.getElementById('val-tempo');
  const btnResetTempo = document.getElementById('btn-reset-tempo');

  const sliderVolume = document.getElementById('slider-volume');
  const valVolume = document.getElementById('val-volume');
  const btnResetVolume = document.getElementById('btn-reset-volume');

  const chkVocalCut = document.getElementById('chk-vocal-cut');
  const btnResetShortcuts = document.getElementById('btn-reset-shortcuts');
  const chkRememberKey = document.getElementById('chk-remember-key');
  const chkPreserveFormants = document.getElementById('chk-preserve-formants');

  let activeTabId = null;
  let currentConfig = mergeKaraokeConfig(null);
  let listeningAction = null;

  // 1. 설정 로드
  await loadConfig();

  // 2. 현재 활성 탭 확인
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || (!tab.url.includes('youtube.com') && !tab.url.includes('youtu.be'))) {
    showNonYoutubeUI();
  } else {
    activeTabId = tab.id;
    setConnectedStatus(true);
    syncState();
  }

  // 3. 탭 네비게이션
  tabBtnRemote.addEventListener('click', () => {
    tabBtnRemote.classList.add('active');
    tabBtnSettings.classList.remove('active');
    tabContentRemote.style.display = 'flex';
    tabContentSettings.style.display = 'none';
  });

  tabBtnSettings.addEventListener('click', () => {
    tabBtnSettings.classList.add('active');
    tabBtnRemote.classList.remove('active');
    tabContentSettings.style.display = 'flex';
    tabContentRemote.style.display = 'none';
  });

  // 4. 마스터 ON/OFF 스위치
  chkMasterPower.addEventListener('change', async (e) => {
    currentConfig.enabled = e.target.checked;
    await saveConfig();
    updatePowerUI(currentConfig.enabled);
    sendTabMessage({ action: 'SET_POWER', enabled: currentConfig.enabled });
  });

  function updatePowerUI(enabled) {
    chkMasterPower.checked = enabled;
    popupContainer.classList.toggle('power-off', !enabled);
    powerStatusLabel.innerText = enabled ? '켜짐' : '꺼짐';
  }

  // 5. 설정 저장 및 로드
  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['karaokeConfig'], (res) => {
        currentConfig = mergeKaraokeConfig(res && res.karaokeConfig);
        updatePowerUI(currentConfig.enabled);
        chkRememberKey.checked = currentConfig.rememberKeyPerVideo;
        chkPreserveFormants.checked = currentConfig.preserveFormants;
        renderShortcutLabels();
        resolve(currentConfig);
      });
    });
  }

  async function saveConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ karaokeConfig: currentConfig }, () => {
        sendTabMessage({ action: 'UPDATE_CONFIG', config: currentConfig });
        resolve();
      });
    });
  }

  // 6. 단축키 렌더링 및 키 바인딩 리스너
  function renderShortcutLabels() {
    const s = currentConfig.shortcuts;
    for (const action in s) {
      const btn = document.getElementById(`bind-${action}`);
      if (btn) {
        btn.innerText = s[action].label || s[action].key;
      }
    }

    // 푸터 가이드 갱신
    const kbdDown = document.getElementById('kbd-down');
    const kbdUp = document.getElementById('kbd-up');
    const kbdReset = document.getElementById('kbd-reset');
    if (kbdDown && s.pitchDown) kbdDown.innerText = s.pitchDown.label;
    if (kbdUp && s.pitchUp) kbdUp.innerText = s.pitchUp.label;
    if (kbdReset && s.pitchReset) kbdReset.innerText = s.pitchReset.label;
  }

  // 단축키 캡처 버튼 클릭
  document.querySelectorAll('.btn-key-bind').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const action = btn.dataset.action;
      if (listeningAction === action) {
        cancelListening();
        return;
      }

      cancelListening();
      listeningAction = action;
      btn.classList.add('listening');
      btn.innerText = '키 누르기...';
    });
  });

  function cancelListening() {
    if (listeningAction) {
      const prevBtn = document.getElementById(`bind-${listeningAction}`);
      if (prevBtn) {
        prevBtn.classList.remove('listening');
        const binding = currentConfig.shortcuts[listeningAction];
        prevBtn.innerText = binding ? binding.label : '-';
      }
      listeningAction = null;
    }
  }

  // 키보드 입력 감지하여 단축키 바인딩
  window.addEventListener('keydown', async (e) => {
    if (!listeningAction) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      cancelListening();
      return;
    }

    // Modifier 키 단독 입력은 무시
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    // 레이블 생성
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Cmd');

    // 물리 키(e.code) 기준 이름: macOS에서 Alt+V가 '√'로 표시되는 문제 방지
    const CODE_NAMES = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      BracketLeft: '[', BracketRight: ']', Backslash: '\\', Comma: ',', Period: '.', Slash: '/',
      Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', Backquote: '`' };
    let keyName = CODE_NAMES[e.code] ||
      (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^(Digit|Numpad)\d$/.test(e.code) ? e.code.slice(-1) : e.key.toUpperCase());

    parts.push(keyName);
    const label = parts.join(' + ');

    currentConfig.shortcuts[listeningAction] = {
      key: e.key.toLowerCase(),
      code: e.code,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      label: label
    };

    const actionDone = listeningAction;
    listeningAction = null;

    const btn = document.getElementById(`bind-${actionDone}`);
    if (btn) {
      btn.classList.remove('listening');
      btn.innerText = label;
    }

    await saveConfig();
    renderShortcutLabels();
  });

  // 곡별 키 기억 토글
  chkRememberKey.addEventListener('change', async (e) => {
    currentConfig.rememberKeyPerVideo = e.target.checked;
    await saveConfig();
  });

  // 포먼트 유지 토글
  chkPreserveFormants.addEventListener('change', async (e) => {
    currentConfig.preserveFormants = e.target.checked;
    await saveConfig();
  });

  // 단축키 기본값 복원
  btnResetShortcuts.addEventListener('click', async () => {
    currentConfig.shortcuts = mergeKaraokeConfig(null).shortcuts;
    await saveConfig();
    renderShortcutLabels();
  });

  // 7. 메시지 전송 헬퍼
  function sendTabMessage(message, callback) {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, message, (response) => {
      if (chrome.runtime.lastError) {
        setConnectedStatus(false);
      } else if (response && response.success) {
        setConnectedStatus(true);
        if (response.state) {
          updateUI(response.state);
        }
        if (callback) callback(response);
      }
    });
  }

  // 8. 상태 동기화 요청
  function syncState() {
    sendTabMessage({ action: 'GET_STATE' });
  }

  // 9. UI 갱신
  function updateUI(state) {
    if (!state) return;

    if (state.enabled !== undefined) {
      currentConfig.enabled = state.enabled;
      updatePowerUI(state.enabled);
    }

    const semi = state.semitones;
    pitchRangeSlider.value = semi;

    pitchNumber.classList.remove('up', 'down');
    if (semi > 0) {
      pitchNumber.innerText = `+${semi}`;
      pitchNumber.classList.add('up');
      pitchTag.innerText = `${semi}키 올림`;
    } else if (semi < 0) {
      pitchNumber.innerText = `−${Math.abs(semi)}`;
      pitchNumber.classList.add('down');
      pitchTag.innerText = `${Math.abs(semi)}키 내림`;
    } else {
      pitchNumber.innerText = '0';
      pitchTag.innerText = '원키';
    }

    if (state.tempo !== undefined) {
      sliderTempo.value = state.tempo;
      valTempo.innerText = `${state.tempo.toFixed(2)}×`;
    }

    if (state.volume !== undefined) {
      sliderVolume.value = state.volume;
      valVolume.innerText = `${Math.round(state.volume * 100)}%`;
    }

    if (state.vocalCutEnabled !== undefined) {
      chkVocalCut.checked = state.vocalCutEnabled;
    }
  }

  function setConnectedStatus(connected) {
    statusBadge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
    statusText.innerText = connected ? '연결됨' : '재생 대기';
  }

  function showNonYoutubeUI() {
    statusBadge.className = 'status-badge disconnected';
    statusText.innerText = '미연결';
    notYtCard.style.display = 'flex';
    document.getElementById('footer-shortcut-guide').style.display = 'none';
    mainContent.style.display = 'none';

    btnOpenYt.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.youtube.com/results?search_query=TJ+노래방' });
    });
  }

  // 10. 버튼 이벤트 리스너
  btnStepDown.addEventListener('click', () => {
    sendTabMessage({ action: 'CHANGE_PITCH', delta: -1 });
  });

  btnStepUp.addEventListener('click', () => {
    sendTabMessage({ action: 'CHANGE_PITCH', delta: 1 });
  });

  btnPitchReset.addEventListener('click', () => {
    sendTabMessage({ action: 'SET_PITCH', semitones: 0 });
  });

  pitchRangeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    sendTabMessage({ action: 'SET_PITCH', semitones: val });
  });

  // Presets
  presetM2F.addEventListener('click', () => {
    sendTabMessage({ action: 'SET_PITCH', semitones: -4 });
  });

  presetF2M.addEventListener('click', () => {
    sendTabMessage({ action: 'SET_PITCH', semitones: 4 });
  });

  presetMinus2.addEventListener('click', () => {
    sendTabMessage({ action: 'SET_PITCH', semitones: -2 });
  });

  presetPlus2.addEventListener('click', () => {
    sendTabMessage({ action: 'SET_PITCH', semitones: 2 });
  });

  // Tempo
  sliderTempo.addEventListener('input', (e) => {
    const tempo = parseFloat(e.target.value);
    valTempo.innerText = `${tempo.toFixed(2)}×`;
    sendTabMessage({ action: 'SET_TEMPO', tempo: tempo });
  });

  btnResetTempo.addEventListener('click', () => {
    sliderTempo.value = 1.0;
    valTempo.innerText = '1.00×';
    sendTabMessage({ action: 'SET_TEMPO', tempo: 1.0 });
  });

  // Volume
  sliderVolume.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    valVolume.innerText = `${Math.round(vol * 100)}%`;
    sendTabMessage({ action: 'SET_VOLUME', volume: vol });
  });

  btnResetVolume.addEventListener('click', () => {
    sliderVolume.value = 1.0;
    valVolume.innerText = '100%';
    sendTabMessage({ action: 'SET_VOLUME', volume: 1.0 });
  });

  // Vocal Cut
  chkVocalCut.addEventListener('change', (e) => {
    sendTabMessage({ action: 'TOGGLE_VOCAL_CUT', enabled: e.target.checked });
  });

  // 상태 변경 감지
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'KARAOKE_STATE_CHANGED' && msg.state) {
      updateUI(msg.state);
    }
  });
});
