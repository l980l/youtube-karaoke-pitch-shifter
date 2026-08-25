/**
 * Popup Script - YouTube Karaoke Key Shifter
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const notYtCard = document.getElementById('not-yt-card');
  const mainContent = document.getElementById('main-content');
  const btnOpenYt = document.getElementById('btn-open-yt');

  const pitchNumber = document.getElementById('pitch-number');
  const pitchTag = document.getElementById('pitch-tag');
  const pitchRangeSlider = document.getElementById('pitch-range-slider');

  const btnStepDown = document.getElementById('btn-step-down');
  const btnStepUp = document.getElementById('btn-step-up');
  const btnPitchDown = document.getElementById('btn-pitch-down');
  const btnPitchUp = document.getElementById('btn-pitch-up');
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

  let activeTabId = null;

  // 1. 현재 활성 탭 확인
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || (!tab.url.includes('youtube.com') && !tab.url.includes('youtu.be'))) {
    showNonYoutubeUI();
    return;
  }

  activeTabId = tab.id;
  setConnectedStatus(true);
  syncState();

  // 2. 메시지 전송 헬퍼
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

  // 3. 상태 동기화 요청
  function syncState() {
    sendTabMessage({ action: 'GET_STATE' });
  }

  // 4. UI 갱신
  function updateUI(state) {
    if (!state) return;

    const semi = state.semitones;
    pitchRangeSlider.value = semi;

    pitchNumber.classList.remove('up', 'down');
    if (semi > 0) {
      pitchNumber.innerText = `+${semi}`;
      pitchNumber.classList.add('up');
      pitchTag.innerText = `♯ ${semi}키 올림 (SHARP)`;
    } else if (semi < 0) {
      pitchNumber.innerText = `${semi}`;
      pitchNumber.classList.add('down');
      pitchTag.innerText = `♭ ${Math.abs(semi)}키 내림 (FLAT)`;
    } else {
      pitchNumber.innerText = '0';
      pitchTag.innerText = '원곡 키 (ORIGINAL)';
    }

    if (state.tempo !== undefined) {
      sliderTempo.value = state.tempo;
      valTempo.innerText = `${state.tempo.toFixed(2)}x`;
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
    mainContent.style.display = 'none';

    btnOpenYt.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.youtube.com/results?search_query=TJ+노래방' });
    });
  }

  // 5. 버튼 이벤트 리스너 바인딩
  btnStepDown.addEventListener('click', () => {
    sendTabMessage({ action: 'CHANGE_PITCH', delta: -1 });
  });

  btnStepUp.addEventListener('click', () => {
    sendTabMessage({ action: 'CHANGE_PITCH', delta: 1 });
  });

  btnPitchDown.addEventListener('click', () => {
    sendTabMessage({ action: 'CHANGE_PITCH', delta: -1 });
  });

  btnPitchUp.addEventListener('click', () => {
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
    valTempo.innerText = `${tempo.toFixed(2)}x`;
    sendTabMessage({ action: 'SET_TEMPO', tempo: tempo });
  });

  btnResetTempo.addEventListener('click', () => {
    sliderTempo.value = 1.0;
    valTempo.innerText = '1.0x';
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

  // 백그라운드나 탭에서 온 상태 변경 메시지 감지
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'KARAOKE_STATE_CHANGED' && msg.state) {
      updateUI(msg.state);
    }
  });
});
