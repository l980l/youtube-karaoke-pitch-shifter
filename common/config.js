/**
 * Shared configuration for the popup and the content scripts.
 * Loaded as a classic script in both contexts (content_scripts + popup.html).
 */
const KARAOKE_DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  rememberKeyPerVideo: true,
  shortcuts: {
    pitchDown: { key: '[', code: 'BracketLeft', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, label: '[' },
    pitchUp: { key: ']', code: 'BracketRight', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, label: ']' },
    pitchReset: { key: '0', code: 'Digit0', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, label: 'Alt + 0' },
    toggleUI: { key: 'm', code: 'KeyM', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, label: 'Alt + M' },
    toggleVocalCut: { key: 'v', code: 'KeyV', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, label: 'Alt + V' },
    togglePower: { key: 'p', code: 'KeyP', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, label: 'Alt + P' }
  }
});

/**
 * Merge a stored config over the defaults. Shortcuts are merged per action so
 * configs saved by older versions still get bindings for newly added actions.
 */
function mergeKaraokeConfig(stored) {
  const defaults = JSON.parse(JSON.stringify(KARAOKE_DEFAULT_CONFIG));
  if (!stored || typeof stored !== 'object') return defaults;
  const defaultShortcuts = defaults.shortcuts;
  const merged = Object.assign(defaults, stored);
  merged.shortcuts = Object.assign({}, defaultShortcuts);
  if (stored.shortcuts && typeof stored.shortcuts === 'object') {
    for (const action of Object.keys(defaultShortcuts)) {
      const binding = stored.shortcuts[action];
      if (binding && typeof binding === 'object' && (binding.code || binding.key)) {
        merged.shortcuts[action] = Object.assign({ metaKey: false }, binding);
      }
    }
  }
  return merged;
}

/** Whether a keyboard event matches a stored binding (all four modifiers must match). */
function isKaraokeShortcutMatch(e, binding) {
  if (!binding) return false;
  if (!!binding.altKey !== e.altKey || !!binding.ctrlKey !== e.ctrlKey ||
      !!binding.shiftKey !== e.shiftKey || !!binding.metaKey !== e.metaKey) return false;
  if (binding.code && e.code) return binding.code === e.code;
  return !!(binding.key && e.key && binding.key.toLowerCase() === e.key.toLowerCase());
}

/** YouTube video id of a URL (/watch?v=, /shorts/, youtu.be/), or null. */
function getYouTubeVideoId(href) {
  try {
    const url = new URL(href);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const match = url.pathname.match(/^\/(shorts|live|embed)\/([\w-]{6,})/);
    return match ? match[2] : null;
  } catch (e) {
    return null;
  }
}

if (typeof module !== 'undefined') {
  module.exports = { KARAOKE_DEFAULT_CONFIG, mergeKaraokeConfig, isKaraokeShortcutMatch, getYouTubeVideoId };
}
