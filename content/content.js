/**
 * YouTube Karaoke Controller - Content Script Entry Point
 */

(() => {
  const shifter = window.__KaraokePitchShifter;
  let ui = null;
  let currentVideo = null;
  let checkInterval = null;

  /**
   * 비디오 요소 탐색 및 오디오 엔진 연결
   */
  async function attachToVideo() {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return;

    if (currentVideo !== video) {
      currentVideo = video;
      console.log('[Karaoke Extension] Video element detected. Attaching audio engine...');

      const connected = await shifter.init(video);
      if (connected) {
        if (!ui) {
          ui = new KaraokeUI(shifter);
          window.__KaraokeUI = ui;
          ui.init();
        } else {
          ui.findPlayerContainer();
          ui.updateUI();
          ui.injectMiniButton();
        }
      }

      // 비디오 재생 이벤트 시 AudioContext suspended 해제
      video.addEventListener('play', () => {
        if (shifter.audioCtx && shifter.audioCtx.state === 'suspended') {
          shifter.audioCtx.resume();
        }
      });
    }
  }

  /**
   * 유튜브 네비게이션 및 DOM 변경 감지
   */
  function observeNavigation() {
    // 1. 주기적 비디오 탐색 (초기 로딩 및 동적 생성 대응)
    checkInterval = setInterval(() => {
      attachToVideo();
    }, 1000);

    // 2. 유튜브 전용 네비게이션 이벤트
    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(attachToVideo, 500);
    });

    window.addEventListener('yt-page-data-updated', () => {
      setTimeout(attachToVideo, 500);
    });

    // 3. MutationObserver
    const observer = new MutationObserver(() => {
      const video = document.querySelector('video');
      if (video && video !== currentVideo) {
        attachToVideo();
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * 팝업 및 백그라운드 메시지 리스너
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 비디오 연결 확인
    if (!shifter.isInitialized && currentVideo) {
      shifter.init(currentVideo);
    }

    switch (request.action) {
      case 'GET_STATE':
        sendResponse({
          success: true,
          hasVideo: !!currentVideo,
          state: shifter.getState()
        });
        break;

      case 'SET_PITCH':
        shifter.setPitch(request.semitones);
        if (ui) {
          ui.updateUI();
          ui.showOSDPitch(request.semitones);
        }
        sendResponse({ success: true, state: shifter.getState() });
        break;

      case 'CHANGE_PITCH':
        const newPitch = shifter.semitones + request.delta;
        shifter.setPitch(newPitch);
        if (ui) {
          ui.updateUI();
          ui.showOSDPitch(shifter.semitones);
        }
        sendResponse({ success: true, state: shifter.getState() });
        break;

      case 'SET_TEMPO':
        shifter.setTempo(request.tempo);
        if (ui) ui.updateUI();
        sendResponse({ success: true, state: shifter.getState() });
        break;

      case 'SET_VOLUME':
        shifter.setVolume(request.volume);
        if (ui) ui.updateUI();
        sendResponse({ success: true, state: shifter.getState() });
        break;

      case 'TOGGLE_VOCAL_CUT':
        const vocalCut = shifter.setVocalCut(request.enabled);
        if (ui) {
          ui.updateUI();
          ui.showOSD(vocalCut ? '🎙️ 보컬 컷 (MR 모드) ON' : '🎵 일반 오디오 모드 OFF');
        }
        sendResponse({ success: true, state: shifter.getState() });
        break;

      case 'RESET':
        shifter.reset();
        if (ui) {
          ui.updateUI();
          ui.showOSDPitch(0);
        }
        sendResponse({ success: true, state: shifter.getState() });
        break;

      case 'TOGGLE_UI':
        if (ui) {
          ui.toggleVisibility();
        }
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }

    return true; // 비동기 응답 지원
  });

  // 초기화 실행
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
