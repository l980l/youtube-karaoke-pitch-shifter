/**
 * Background Service Worker - YouTube Karaoke Pitch Shifter
 */

// 단축키 명령 리스너
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url) return;

    if (!tab.url.includes('youtube.com') && !tab.url.includes('youtu.be')) return;

    switch (command) {
      case 'pitch-up':
        chrome.tabs.sendMessage(tab.id, { action: 'CHANGE_PITCH', delta: 1 });
        break;

      case 'pitch-down':
        chrome.tabs.sendMessage(tab.id, { action: 'CHANGE_PITCH', delta: -1 });
        break;

      case 'pitch-reset':
        chrome.tabs.sendMessage(tab.id, { action: 'SET_PITCH', semitones: 0 });
        break;

      case 'toggle-ui':
        chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_UI' });
        break;
    }
  } catch (err) {
    console.warn('[Karaoke Background] Command handling error:', err);
  }
});

// 확장프로그램 설치 시 기본 안내
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Karaoke Background] YouTube Karaoke Extension Installed.');
  }
});
