import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { KARAOKE_DEFAULT_CONFIG, mergeKaraokeConfig, isKaraokeShortcutMatch, getYouTubeVideoId } = require('../common/config.js');

const key = (code, mods = {}) => ({ code, key: '', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, ...mods });

test('older saved configs gain newly added shortcut actions and options', () => {
  const old = { enabled: false, shortcuts: { pitchUp: { key: 'k', code: 'KeyK', label: 'K' } } };
  const merged = mergeKaraokeConfig(old);
  assert.equal(merged.enabled, false);
  assert.equal(merged.rememberKeyPerVideo, true);
  assert.equal(merged.shortcuts.pitchUp.code, 'KeyK');
  assert.deepEqual(merged.shortcuts.togglePower, KARAOKE_DEFAULT_CONFIG.shortcuts.togglePower);
});

test('merging never mutates the frozen defaults', () => {
  const merged = mergeKaraokeConfig(null);
  merged.shortcuts.pitchUp.code = 'KeyZ';
  assert.equal(KARAOKE_DEFAULT_CONFIG.shortcuts.pitchUp.code, 'BracketRight');
});

test('Cmd+[ (macOS back) does not trigger the plain "[" shortcut', () => {
  const binding = KARAOKE_DEFAULT_CONFIG.shortcuts.pitchDown;
  assert.equal(isKaraokeShortcutMatch(key('BracketLeft'), binding), true);
  assert.equal(isKaraokeShortcutMatch(key('BracketLeft', { metaKey: true }), binding), false);
});

test('Alt+V on macOS (key "√") matches by physical key code', () => {
  const binding = KARAOKE_DEFAULT_CONFIG.shortcuts.toggleVocalCut;
  assert.equal(isKaraokeShortcutMatch({ ...key('KeyV', { altKey: true }), key: '√' }, binding), true);
  assert.equal(isKaraokeShortcutMatch(key('KeyV'), binding), false);
});

test('video ids are read from watch, shorts and youtu.be URLs', () => {
  assert.equal(getYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(getYouTubeVideoId('https://www.youtube.com/shorts/abcDEF12345'), 'abcDEF12345');
  assert.equal(getYouTubeVideoId('https://youtu.be/abcDEF12345'), 'abcDEF12345');
  assert.equal(getYouTubeVideoId('https://www.youtube.com/'), null);
});
