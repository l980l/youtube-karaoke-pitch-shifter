/**
 * YouTube Karaoke Controller - Content Script Entry Point
 */

(() => {
  const shifter = window.__KaraokePitchShifter;
  const VIDEO_KEYS_STORAGE = 'karaokeVideoKeys';
  const MAX_REMEMBERED_VIDEOS = 300;

  let ui = null;
  let currentVideo = null;
  let currentVideoId = null;
  let rememberKeyPerVideo = KARAOKE_DEFAULT_CONFIG.rememberKeyPerVideo;
  let restoringKey = false;

  function refreshUI({ osdPitch = false } = {}) {
    if (!ui) return;
    ui.updateUI();
    if (osdPitch) ui.showOSDPitch(shifter.semitones);
  }

  /**
   * 비디오 요소 탐색 및 오디오 엔진 연결
   */
  async function attachToVideo() {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video || currentVideo === video) return;

    currentVideo = video;
    const connected = await shifter.init(video);
    if (!connected) return;

    if (!ui) {
      ui = new KaraokeUI(shifter);
      window.__KaraokeUI = ui;
      await ui.init();
    } else {
      ui.findPlayerContainer();
      ui.injectMiniButton();
      ui.updateUI();
    }
    checkVideoChange();
  }

  // ---------------------------------------------------------------------
  // 곡별 키 기억: videoId → 마지막으로 쓴 키 (0이면 기록 삭제)
  // ---------------------------------------------------------------------
  function loadVideoKeys() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([VIDEO_KEYS_STORAGE], (res) => resolve((res && res[VIDEO_KEYS_STORAGE]) || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  const saveTimers = new Map(); // videoId → pending save (영상별로 따로 디바운스)
  function rememberKey() {
    if (!rememberKeyPerVideo || restoringKey) return;
    // URL 기준: 사용자가 지금 듣고 있는 영상에 기록한다.
    const videoId = getYouTubeVideoId(location.href);
    if (!videoId) return;
    const semitones = shifter.semitones;
    clearTimeout(saveTimers.get(videoId));
    saveTimers.set(videoId, setTimeout(async () => {
      saveTimers.delete(videoId);
      const keys = await loadVideoKeys();
      // 0도 기록한다: "원키로 부르기로 한 곡"과 "기록 없는 곡"을 구분해야 한다.
      keys[videoId] = { k: semitones, t: Date.now() };
      const ids = Object.keys(keys);
      if (ids.length > MAX_REMEMBERED_VIDEOS) {
        ids.sort((a, b) => keys[a].t - keys[b].t)
          .slice(0, ids.length - MAX_REMEMBERED_VIDEOS)
          .forEach((id) => delete keys[id]);
      }
      try { chrome.storage.local.set({ [VIDEO_KEYS_STORAGE]: keys }); } catch (e) {}
    }, 400));
  }

  async function checkVideoChange() {
    const videoId = getYouTubeVideoId(location.href);
    // 엔진이 준비된 뒤에 영상 전환으로 인정해야 저장된 키 복원을 놓치지 않는다.
    if (!videoId || videoId === currentVideoId || !shifter.isInitialized) return;
    currentVideoId = videoId;
    if (!rememberKeyPerVideo) return;

    const saved = (await loadVideoKeys())[videoId];
    if (!saved || videoId !== currentVideoId || !shifter.enabled || saved.k === shifter.semitones) return;
    restoringKey = true;
    shifter.setPitch(saved.k);
    restoringKey = false;
    if (ui) {
      ui.updateUI();
      ui.showOSD(`이 곡의 키 · ${saved.k === 0 ? '원키' : (saved.k > 0 ? `+${saved.k}` : `−${Math.abs(saved.k)}`)}`, saved.k < 0);
      ui.notifyStateChange();
    }
  }

  shifter.onPitchChange = rememberKey;
  shifter.onExternalChange = () => {
    if (ui) {
      ui.updateUI();
      ui.notifyStateChange();
    }
  };

  // ---------------------------------------------------------------------
  // 설정 동기화: 팝업/다른 탭에서 바뀐 설정을 즉시 반영
  // ---------------------------------------------------------------------
  function applyConfig(config) {
    const merged = mergeKaraokeConfig(config);
    rememberKeyPerVideo = merged.rememberKeyPerVideo;
    shifter.setPreserveFormants(merged.preserveFormants);
    if (ui) ui.updateConfig(merged);
    else if (shifter.enabled !== merged.enabled) shifter.setEnabled(merged.enabled);
  }

  try {
    chrome.storage.local.get(['karaokeConfig'], (res) => applyConfig(res && res.karaokeConfig));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.karaokeConfig) applyConfig(changes.karaokeConfig.newValue);
    });
  } catch (e) {}

  /**
   * 유튜브 SPA 네비게이션 및 DOM 변경 감지
   */
  function observeNavigation() {
    // 초기 로딩·동적 생성 대응 (가벼운 폴링)
    setInterval(() => {
      attachToVideo();
      checkVideoChange();
    }, 1000);

    const onNavigate = () => setTimeout(() => {
      attachToVideo();
      checkVideoChange();
    }, 300);
    window.addEventListener('yt-navigate-finish', onNavigate);
    window.addEventListener('yt-page-data-updated', onNavigate);

    // DOM 변경은 매우 잦으므로 프레임당 한 번만 확인한다.
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video && video !== currentVideo) attachToVideo();
      });
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  /**
   * 팝업 및 백그라운드 메시지 리스너
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const reply = () => sendResponse({ success: true, hasVideo: !!currentVideo, state: shifter.getState() });

    switch (request.action) {
      case 'GET_STATE':
        reply();
        break;

      case 'SET_PITCH':
        if (shifter.enabled) shifter.setPitch(request.semitones);
        refreshUI({ osdPitch: true });
        reply();
        break;

      case 'CHANGE_PITCH':
        if (shifter.enabled) shifter.setPitch(shifter.semitones + Number(request.delta || 0));
        refreshUI({ osdPitch: true });
        reply();
        break;

      case 'SET_TEMPO':
        shifter.setTempo(request.tempo);
        refreshUI();
        reply();
        break;

      case 'SET_VOLUME':
        shifter.setVolume(request.volume);
        refreshUI();
        reply();
        break;

      case 'TOGGLE_VOCAL_CUT': {
        const vocalCut = shifter.setVocalCut(request.enabled);
        if (ui) {
          ui.updateUI();
          ui.showOSD(vocalCut ? '보컬 줄이기 켜짐' : '보컬 줄이기 꺼짐');
        }
        reply();
        break;
      }

      case 'RESET':
        shifter.reset();
        refreshUI({ osdPitch: true });
        reply();
        break;

      case 'SET_POWER':
        if (ui) ui.setEnabled(request.enabled, true);
        else shifter.setEnabled(request.enabled);
        reply();
        break;

      case 'TOGGLE_UI':
        if (ui) ui.toggleVisibility();
        reply();
        break;

      case 'UPDATE_CONFIG':
        applyConfig(request.config);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    return false; // 모든 응답은 동기적으로 보낸다
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      attachToVideo();
      observeNavigation();
    });
  } else {
    attachToVideo();
    observeNavigation();
  }
})();
