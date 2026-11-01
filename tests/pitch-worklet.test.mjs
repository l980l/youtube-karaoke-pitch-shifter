// Offline accuracy test for content/pitch-worklet.js (run: node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SAMPLE_RATE = 48000;
const BLOCK = 128;

function loadProcessor() {
  let Processor = null;
  const sandbox = {
    Math, Float32Array, Uint16Array, Int32Array, Number, sampleRate: SAMPLE_RATE,
    AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null }; } },
    registerProcessor: (_name, cls) => { Processor = cls; }
  };
  vm.runInNewContext(readFileSync(new URL('../content/pitch-worklet.js', import.meta.url), 'utf8'), sandbox);
  const proc = new Processor();
  proc.send = (data) => proc.port.onmessage({ data });
  return proc;
}

function run(proc, signal, right = signal) {
  const out = new Float32Array(signal.length);
  const outRight = new Float32Array(signal.length);
  for (let start = 0; start + BLOCK <= signal.length; start += BLOCK) {
    const outputs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    proc.process([[signal.subarray(start, start + BLOCK), right.subarray(start, start + BLOCK)]], outputs);
    out.set(outputs[0][0], start);
    outRight.set(outputs[0][1], start);
  }
  out.right = outRight;
  return out;
}

// Frequency estimate from zero crossings with linear interpolation.
function estimateFrequency(x) {
  const crossings = [];
  for (let i = 1; i < x.length; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) crossings.push(i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]));
  }
  const periods = (crossings.length - 1);
  return (periods * SAMPLE_RATE) / (crossings[crossings.length - 1] - crossings[0]);
}

const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const sine = (freq, seconds) => Float32Array.from(
  { length: Math.floor(SAMPLE_RATE * seconds) }, (_, i) => 0.5 * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE));

for (const semitones of [-12, -5, -4, -1, 1, 4, 5, 12]) {
  test(`pitch shift ${semitones > 0 ? '+' : ''}${semitones} semitones is within 5 cents`, () => {
    const proc = loadProcessor();
    const ratio = Math.pow(2, semitones / 12);
    proc.send({ pitchRatio: ratio, active: true, formant: false });
    const input = sine(330, 1.5);
    const out = run(proc, input).subarray(SAMPLE_RATE * 0.5); // skip warm-up
    const measured = estimateFrequency(out);
    const cents = 1200 * Math.log2(measured / (330 * ratio));
    assert.ok(Math.abs(cents) < 5, `expected ${(330 * ratio).toFixed(2)}Hz, got ${measured.toFixed(2)}Hz (${cents.toFixed(2)} cents)`);
    const gainDb = 20 * Math.log10(rms(out) / rms(input));
    assert.ok(Math.abs(gainDb) < 1.5, `level changed by ${gainDb.toFixed(2)} dB`);
  });
}

// Magnitude at an exact frequency (single-bin DFT) — used to check chords.
function toneLevel(x, freq) {
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / x.length));
    re += x[i] * w * Math.cos(2 * Math.PI * freq * i / SAMPLE_RATE);
    im -= x[i] * w * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
  }
  return Math.hypot(re, im) / (x.length / 4);
}

for (const semitones of [-5, 2]) { // shifts where no shifted note lands on an original note
  test(`chord (C-E-G) shifted ${semitones} keeps every note at its new pitch`, () => {
    const proc = loadProcessor();
    const ratio = Math.pow(2, semitones / 12);
    proc.send({ pitchRatio: ratio, active: true, formant: false });
    const notes = [261.63, 329.63, 392.0];
    const input = Float32Array.from({ length: SAMPLE_RATE * 1.5 }, (_, i) =>
      notes.reduce((s, f) => s + 0.2 * Math.sin(2 * Math.PI * f * i / SAMPLE_RATE), 0));
    const out = run(proc, input).subarray(SAMPLE_RATE * 0.5);
    for (const f of notes) {
      const shifted = toneLevel(out, f * ratio);
      const leftover = toneLevel(out, f);
      assert.ok(shifted > 0.12, `note ${f}Hz → ${(f * ratio).toFixed(1)}Hz level ${shifted.toFixed(3)} (expected ~0.2)`);
      assert.ok(leftover < shifted * 0.1, `original ${f}Hz still present (${leftover.toFixed(3)})`);
    }
  });
}

test('output level is steady (no tremolo) for a held note', () => {
  const proc = loadProcessor();
  proc.send({ pitchRatio: Math.pow(2, 5 / 12), active: true, formant: false });
  const out = run(proc, sine(220, 2)).subarray(SAMPLE_RATE * 0.5);
  const blocks = [];
  for (let i = 0; i + 2400 <= out.length; i += 2400) blocks.push(rms(out.subarray(i, i + 2400)));
  const spreadDb = 20 * Math.log10(Math.max(...blocks) / Math.min(...blocks));
  assert.ok(spreadDb < 1.5, `level fluctuates by ${spreadDb.toFixed(2)} dB`);
});

test('goes idle (silent, no processing) after deactivation and recovers when reactivated', () => {
  const proc = loadProcessor();
  proc.send({ pitchRatio: 1.5, active: true, formant: false });
  run(proc, sine(330, 0.3));
  proc.send({ active: false });
  run(proc, sine(330, 0.6));
  assert.equal(proc.idle, true);
  const silent = run(proc, sine(330, 0.1));
  assert.equal(rms(silent), 0);
  proc.send({ active: true });
  const out = run(proc, sine(330, 1)).subarray(SAMPLE_RATE * 0.3);
  const cents = 1200 * Math.log2(estimateFrequency(out) / 495);
  assert.ok(Math.abs(cents) < 5, `after reactivation: ${cents.toFixed(2)} cents`);
});

// ---------------------------------------------------------------------------
// Formant preservation (voice timbre) and stereo link
// ---------------------------------------------------------------------------

// A sung vowel: two formants (~100 Hz bandwidth) and a -6 dB/oct source tilt.
const vowelEnvelope = (f, F1, F2) =>
  (1 / Math.sqrt(1 + ((f - F1) / 90) ** 2) + 0.7 / Math.sqrt(1 + ((f - F2) / 110) ** 2)) / Math.sqrt(1 + f / 300);

function vowel(f0, seconds, F1 = 700, F2 = 1200) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const x = new Float32Array(n);
  for (let h = 1; h * f0 < 8000; h++) {
    const f = h * f0;
    const amp = 0.1 * vowelEnvelope(f, F1, F2);
    for (let i = 0; i < n; i++) x[i] += amp * Math.sin(2 * Math.PI * f * i / SAMPLE_RATE + h * h * 0.7);
  }
  return x;
}

// RMS dB difference between the output harmonics and the ORIGINAL timbre at
// their new frequencies (overall gain removed). Lower = voice colour kept.
function timbreError(out, f0, ratio, F1, F2) {
  const diffs = [];
  for (let h = 1; h * f0 * ratio < 4000; h++) {
    const f = h * f0 * ratio;
    diffs.push(20 * Math.log10((toneLevel(out, f) + 1e-7) / (0.1 * vowelEnvelope(f, F1, F2))));
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length);
}

for (const [f0, F1, F2] of [[110, 700, 1200], [220, 600, 1000], [300, 800, 1300]]) {
  test(`voice timbre (f0 ${f0} Hz): formant correction keeps the original voice colour at ±4`, () => {
    for (const semitones of [-4, 4]) {
      const ratio = Math.pow(2, semitones / 12);
      const input = vowel(f0, 1.2, F1, F2);
      const error = (formant) => {
        const proc = loadProcessor();
        proc.send({ pitchRatio: ratio, active: true, formant });
        return timbreError(run(proc, input).subarray(SAMPLE_RATE * 0.4), f0, ratio, F1, F2);
      };
      const on = error(true);
      const off = error(false);
      assert.ok(on < 3, `${semitones}: timbre error ${on.toFixed(2)} dB with correction`);
      assert.ok(on < off - 0.5, `${semitones}: correction ${on.toFixed(2)} dB should beat ${off.toFixed(2)} dB without`);
    }
  });
}

test('formant correction keeps overall loudness of a rich (many-harmonic) sound', () => {
  const proc = loadProcessor();
  proc.send({ pitchRatio: Math.pow(2, 4 / 12), active: true, formant: true });
  const n = SAMPLE_RATE * 1.5;
  const input = Float32Array.from({ length: n }, (_, i) => {
    let v = 0;
    for (let h = 1; h <= 40; h++) v += Math.sin(2 * Math.PI * 110 * h * i / SAMPLE_RATE + h * h) / Math.sqrt(h);
    return 0.03 * v;
  });
  const out = run(proc, input).subarray(SAMPLE_RATE * 0.5);
  const gainDb = 20 * Math.log10(rms(out) / rms(input.subarray(SAMPLE_RATE * 0.5)));
  assert.ok(Math.abs(gainDb) < 1.5, `level changed by ${gainDb.toFixed(2)} dB`);
});

test('stereo link: a centred voice stays centred when L/R accompaniment differs', () => {
  const proc = loadProcessor();
  const ratio = Math.pow(2, 4 / 12);
  proc.send({ pitchRatio: ratio, active: true, formant: true });
  const voice = vowel(220, 1.5, 600, 1000);
  const left = voice.map((v, i) => v + 0.12 * Math.sin(2 * Math.PI * 587 * i / SAMPLE_RATE));
  const right = voice.map((v, i) => v + 0.12 * Math.sin(2 * Math.PI * 740 * i / SAMPLE_RATE));
  const out = run(proc, left, right);
  const start = SAMPLE_RATE * 0.5;
  const L = out.subarray(start), R = out.right.subarray(start);
  const mid = L.map((v, i) => (v + R[i]) / 2);
  const side = L.map((v, i) => (v - R[i]) / 2);
  let midV = 0, sideV = 0;
  for (let h = 1; h <= 5; h++) { midV += toneLevel(mid, 220 * ratio * h); sideV += toneLevel(side, 220 * ratio * h); }
  const leakDb = 20 * Math.log10(sideV / midV);
  assert.ok(leakDb < -40, `voice leaks into L-R at ${leakDb.toFixed(1)} dB`);
});

test('formant correction does not change the level of sparse sounds (lone sine, bass)', () => {
  const sounds = {
    'sine 440': (i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / SAMPLE_RATE),
    'bass 82 Hz': (i) => 0.4 * Math.sin(2 * Math.PI * 82 * i / SAMPLE_RATE) + 0.2 * Math.sin(2 * Math.PI * 164 * i / SAMPLE_RATE)
  };
  for (const [name, gen] of Object.entries(sounds)) {
    for (const semitones of [-5, -3, 3, 5]) {
      const proc = loadProcessor();
      proc.send({ pitchRatio: Math.pow(2, semitones / 12), active: true, formant: true });
      const input = Float32Array.from({ length: SAMPLE_RATE * 1.2 }, (_, i) => gen(i));
      const out = run(proc, input).subarray(SAMPLE_RATE * 0.4);
      const gainDb = 20 * Math.log10(rms(out) / rms(input.subarray(SAMPLE_RATE * 0.4)));
      assert.ok(Math.abs(gainDb) < 1.5, `${name} at ${semitones}: level changed by ${gainDb.toFixed(2)} dB`);
    }
  }
});
