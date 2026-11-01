/*
 * End-to-end check: loads the unpacked extension in Chromium, serves a fake
 * youtube.com watch page with a 440 Hz stereo tone, and measures the real
 * audio output inside the content script's isolated world.
 *
 *   npm i -D playwright-core && npx playwright install chromium
 *   CHROME_PATH="<Chrome for Testing binary>" node tests/e2e/extension.e2e.mjs
 *
 * (Branded Google Chrome ignores --load-extension; use Chromium / Chrome for Testing.)
 */
import { chromium } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = mkdtempSync(path.join(tmpdir(), 'karaoke-e2e-'));

function makeToneWav(freq = 440, seconds = 30, sampleRate = 48000) {
  const frames = sampleRate * seconds;
  const buf = Buffer.alloc(44 + frames * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + frames * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(0.3 * 32767 * Math.sin(2 * Math.PI * freq * i / sampleRate));
    buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4);
  }
  return buf;
}
const wav = makeToneWav();
const html = `<!doctype html><html><body>
<div class="html5-video-player" style="position:relative;width:640px;height:360px">
  <video class="html5-main-video" src="/tone.wav" loop autoplay></video>
  <div class="ytp-right-controls"></div>
</div></body></html>`;

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(DIR, 'profile-')), {
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required']
});
await ctx.route('https://www.youtube.com/**', (route) => {
  const url = route.request().url();
  if (url.endsWith('/tone.wav')) return route.fulfill({ body: wav, contentType: 'audio/wav' });
  return route.fulfill({ body: html, contentType: 'text/html' });
});

const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const cdp = await ctx.newCDPSession(page);
const worlds = new Map();
cdp.on('Runtime.executionContextCreated', ({ context }) => {
  if (context.auxData?.type === 'isolated') worlds.set(context.name, context.id);
});
await cdp.send('Runtime.enable');
await page.goto('https://www.youtube.com/watch?v=AAAAAAAAAAA');
await page.waitForSelector('#yk-karaoke-overlay', { state: 'attached', timeout: 15000 });

const contextId = [...worlds.values()].pop();
async function iso(expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, contextId, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tap the final output (direct + processed paths) with an analyser.
await iso(`(() => {
  const s = window.__KaraokePitchShifter;
  const a = s.audioCtx.createAnalyser(); a.fftSize = 32768; a.smoothingTimeConstant = 0;
  window.__tapNodes = [s.directGain, s.processedGain];
  window.__tapNodes.forEach(n => n.connect(a)); window.__an = a; return s.audioCtx.state;
})()`).then((st) => console.log('AudioContext:', st));

const measure = () => iso(`(() => {
  const a = window.__an, sr = a.context.sampleRate;
  const f = new Float32Array(a.frequencyBinCount); a.getFloatFrequencyData(f);
  let k = 1; for (let i = 2; i < f.length - 1; i++) if (f[i] > f[k]) k = i;
  const [l, c, r] = [f[k-1], f[k], f[k+1]]; const d = 0.5 * (l - r) / (l - 2*c + r);
  const t = new Float32Array(a.fftSize); a.getFloatTimeDomainData(t);
  const rms = Math.sqrt(t.reduce((s, v) => s + v*v, 0) / t.length);
  return { hz: +((k + d) * sr / a.fftSize).toFixed(2), db: +(20 * Math.log10(rms)).toFixed(2) };
})()`);
const state = () => iso('window.__KaraokePitchShifter.getState()');
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`); };
const cents = (hz, want) => 1200 * Math.log2(hz / want);

await sleep(1500);
let m0 = await measure();
check('key 0 = original 440Hz (true bypass)', Math.abs(cents(m0.hz, 440)) < 5, JSON.stringify(m0));

for (let i = 0; i < 3; i++) await click('#yk-btn-up');
await sleep(1500);
let m = await measure();
check('+3 via overlay button → 523.25Hz', Math.abs(cents(m.hz, 523.25)) < 5, JSON.stringify(m));
check('+3 keeps loudness (±2dB of original)', Math.abs(m.db - m0.db) < 2, `${m.db} vs ${m0.db} dB`);
check('overlay shows +3', (await page.textContent('#yk-pitch-num')) === '+3', await page.textContent('#yk-pitch-num'));

await page.keyboard.press('Meta+BracketLeft');
await sleep(200);
check('Cmd+[ does not change key', (await state()).semitones === 3, JSON.stringify(await state()));
await page.keyboard.press('BracketLeft');
await sleep(200);
check('[ lowers key to +2', (await state()).semitones === 2, String((await state()).semitones));

await click('#yk-preset-male-to-female');
await sleep(1500);
m = await measure();
check('-4 preset → 349.23Hz', Math.abs(cents(m.hz, 349.23)) < 5, JSON.stringify(m));

await page.keyboard.press('Alt+KeyP');
await sleep(1200);
m = await measure();
check('power OFF → original 440Hz', Math.abs(cents(m.hz, 440)) < 5 && !(await state()).enabled, JSON.stringify(m));
await page.keyboard.press('Alt+KeyP');
await sleep(1500);
m = await measure();
check('power ON restores -4 (349.23Hz)', Math.abs(cents(m.hz, 349.23)) < 5, JSON.stringify(m));

await click('#yk-btn-reset');
await page.evaluate(() => document.querySelector('#yk-chk-vocal-cut').click());
await sleep(1200);
m = await measure();
check('vocal cut removes centered tone (≥15dB)', m0.db - m.db > 15, `${m.db} vs ${m0.db} dB`);
await page.evaluate(() => document.querySelector('#yk-chk-vocal-cut').click());

// Per-video key memory: set +5 on AAA, navigate to BBB, set -2, come back.
await click('#yk-btn-up'); await click('#yk-btn-up'); // 0 → +2
await sleep(800);
await page.evaluate(() => { history.pushState({}, '', '/watch?v=BBBBBBBBBBB'); window.dispatchEvent(new Event('yt-navigate-finish')); });
await sleep(1500);
await click('#yk-btn-down'); await click('#yk-btn-down'); await click('#yk-btn-down'); // +2 → -1
await sleep(800);
await page.evaluate(() => { history.pushState({}, '', '/watch?v=AAAAAAAAAAA'); window.dispatchEvent(new Event('yt-navigate-finish')); });
await sleep(1500);
check('returning to video A restores its key (+2)', (await state()).semitones === 2, String((await state()).semitones));
await page.evaluate(() => { history.pushState({}, '', '/watch?v=BBBBBBBBBBB'); window.dispatchEvent(new Event('yt-navigate-finish')); });
await sleep(1500);
check('returning to video B restores its key (-1)', (await state()).semitones === -1, String((await state()).semitones));

// Explicit original key (0) is remembered too, distinct from "no record"
await click('#yk-btn-reset');
await sleep(800);
await page.evaluate(() => { history.pushState({}, '', '/watch?v=AAAAAAAAAAA'); window.dispatchEvent(new Event('yt-navigate-finish')); });
await sleep(1500);
await page.evaluate(() => { history.pushState({}, '', '/watch?v=BBBBBBBBBBB'); window.dispatchEvent(new Event('yt-navigate-finish')); });
await sleep(1500);
check('video B set to original key stays 0 after visiting A (+2)', (await state()).semitones === 0, String((await state()).semitones));

// Limiter level step: volume 99% vs bypass
await iso('window.__KaraokePitchShifter.setVolume(0.99)');
await sleep(1500);
m = await measure();
console.log(`  limiter path level at 99%: ${m.db} dB vs bypass ${m0.db} dB (expected ${(m0.db + 20*Math.log10(0.99)).toFixed(2)})`);
check('limiter path level step < 0.3dB', Math.abs(m.db - (m0.db + 20 * Math.log10(0.99))) < 0.3, `${(m.db - m0.db).toFixed(2)} dB`);
await iso('window.__KaraokePitchShifter.setVolume(1)');

// YouTube's own speed menu → tempo state sync
await page.evaluate(() => { document.querySelector('video').playbackRate = 1.25; });
await sleep(300);
check('YouTube speed change syncs tempo state', (await state()).tempo === 1.25, String((await state()).tempo));

// New <video> element (e.g. player swap): old graph torn down, no doubled audio
await page.evaluate(() => {
  const old = document.querySelector('video'); const v = old.cloneNode(); old.pause(); old.remove();
  document.querySelector('.html5-video-player').prepend(v); v.play();
});
await sleep(2500);
const reattached = await iso('window.__KaraokePitchShifter.videoElement === document.querySelector("video") && window.__KaraokePitchShifter.isInitialized');
check('engine re-attaches to replaced <video>', reattached, String(reattached));

check('no page/console errors', errors.length === 0, errors.join(' | ') || 'none');
await ctx.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
