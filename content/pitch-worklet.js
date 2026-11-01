/*
 * Peak-locked phase-vocoder pitch shifter (AudioWorklet).
 *
 * Each spectral peak and its surrounding region (the window main lobe) is
 * moved as a unit by an integer number of bins, and a per-peak phase rotation
 * accumulated across frames sets the exact output frequency
 * (Laroche & Dolson, "New phase-vocoder techniques for pitch-shifting", 1999).
 * Moving whole regions keeps each lobe's internal phase pattern, so loudness
 * is preserved.
 *
 * Stereo link: peaks, regions, shifts and rotations are decided once from the
 * combined L/R spectrum and applied identically to both channels. Processing
 * channels independently let a centred vocal be shifted slightly differently
 * on each side (it leaked into L−R at −18 dB) and sound smeared/hollow.
 *
 * Formant preservation: a cepstrally smoothed spectral envelope of the input
 * is measured every frame. A region moved from bin k to k+s is rescaled by
 * envelope(k+s) / envelope(k), so harmonics take the loudness the original
 * timbre has at their new frequency. The pitch changes, the vowel/voice
 * colour stays (no "chipmunk" or "giant" voice).
 */
const TWO_PI = 2 * Math.PI;
const IDLE_AFTER_SECONDS = 0.5;   // keep running while the output gain fades out
const LIFTER_SECONDS = 0.0012;    // envelope detail cutoff (tuned on 110–440 Hz voices, see tests)
const ENVELOPE_POOL = 4;          // envelope is computed on a 4x max-pooled spectrum (cheaper, keeps peaks)
const TRUE_ENVELOPE_ITERATIONS = 8;
const TRUE_ENVELOPE_TOLERANCE = 0.23; // stop when every bin is within ~2 dB of the envelope
const MAX_FORMANT_LOG_GAIN = 2.3; // clamp envelope correction to ±20 dB
// Formant correction only where formants live (F1-F3). Above it, sibilants
// ("s", "ch") would be pulled toward the original noise band and lose
// ~12 dB at -7 keys, making speech sound muffled; fade it out 3 → 5 kHz.
const FORMANT_FULL_HZ = 3000;
const FORMANT_NONE_HZ = 5000;
const ENVELOPE_RANGE = 5.76;      // ln(10^(50/20)): envelope floor 50 dB below the frame maximum
const FIRST_PARTIAL_RANGE = 3.45; // ln(10^(30/20)): first partial = first bin within 30 dB of the maximum

/** In-place radix-2 FFT for a fixed size (tables allocated once). */
function createFFT(n) {
  const bits = Math.log2(n);
  const half = n >> 1;
  const bitReverse = new Uint16Array(n);
  const cosine = new Float32Array(half);
  const sine = new Float32Array(half);
  for (let i = 0; i < n; i++) {
    let value = i;
    let reversed = 0;
    for (let bit = 0; bit < bits; bit++) {
      reversed = (reversed << 1) | (value & 1);
      value >>= 1;
    }
    bitReverse[i] = reversed;
  }
  for (let i = 0; i < half; i++) {
    cosine[i] = Math.cos((TWO_PI * i) / n);
    sine[i] = Math.sin((TWO_PI * i) / n);
  }
  return function fft(real, imag, inverse) {
    for (let i = 0; i < n; i++) {
      const j = bitReverse[i];
      if (j > i) {
        let value = real[i]; real[i] = real[j]; real[j] = value;
        value = imag[i]; imag[i] = imag[j]; imag[j] = value;
      }
    }
    for (let width = 2; width <= n; width <<= 1) {
      const halfWidth = width >> 1;
      const tableStep = n / width;
      for (let start = 0; start < n; start += width) {
        for (let offset = 0; offset < halfWidth; offset++) {
          const c = cosine[offset * tableStep];
          const s = inverse ? sine[offset * tableStep] : -sine[offset * tableStep];
          const even = start + offset;
          const odd = even + halfWidth;
          const oddReal = real[odd] * c - imag[odd] * s;
          const oddImag = real[odd] * s + imag[odd] * c;
          real[odd] = real[even] - oddReal;
          imag[odd] = imag[even] - oddImag;
          real[even] += oddReal;
          imag[even] += oddImag;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        real[i] /= n;
        imag[i] /= n;
      }
    }
  };
}

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.hop = 512;
    this.half = this.size >> 1;
    this.ratio = 1;
    this.formant = true;
    this.formantMix = 1; // eases toward 0/1 so toggling mid-song fades over ~85 ms
    this.active = true;
    this.idleCountdown = 0;
    this.idle = false;
    this.needsReset = false;
    this.channels = [];
    this.inputCount = 0;   // shared frame clock: all channels advance together
    this.outputPos = 0;
    this.outputLength = this.size * 4;

    this.window = new Float32Array(this.size);
    for (let i = 0; i < this.size; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / this.size));
    }
    this.fft = createFFT(this.size);

    // Shared per-frame scratch (allocated once).
    this.magnitude = new Float32Array(this.half + 1);
    this.peaks = new Int32Array(this.half + 1);
    this.rotation = new Float32Array(this.half + 1);
    this.nextRotation = new Float32Array(this.half + 1);
    this.envelope = new Float32Array(this.half + 1);

    // True-envelope scratch on the pooled spectrum.
    this.envBins = this.half / ENVELOPE_POOL;          // 256 pooled bins
    this.envSize = this.envBins * 2;                    // 512-point cepstrum
    this.envFFT = createFFT(this.envSize);
    this.envTarget = new Float32Array(this.envBins + 1); // pooled log magnitude
    this.envWork = new Float32Array(this.envBins + 1);
    this.cepReal = new Float32Array(this.envSize);
    this.cepImag = new Float32Array(this.envSize);
    // Cepstral index n is n / sampleRate seconds in the pooled domain too (N·Δf = sampleRate).
    this.lifter = Math.min(this.envBins - 1, Math.max(8, Math.round(sampleRate * LIFTER_SECONDS)));

    this.port.onmessage = ({ data }) => {
      if (Number.isFinite(data.pitchRatio) && data.pitchRatio > 0) this.ratio = data.pitchRatio;
      if (typeof data.formant === 'boolean') {
        this.formant = data.formant;
        if (this.inputCount === 0 && this.outputPos === 0) this.formantMix = data.formant ? 1 : 0; // not started yet: no fade
      }
      if (typeof data.active === 'boolean') {
        this.active = data.active;
        if (data.active) {
          if (this.idle) this.needsReset = true; // clear stale history in process()
          this.idle = false;
        } else {
          this.idleCountdown = Math.ceil(IDLE_AFTER_SECONDS * sampleRate);
        }
      }
    };
  }

  createState() {
    return {
      input: new Float32Array(this.size),
      output: new Float32Array(this.outputLength),
      phase: new Float32Array(this.half + 1),
      lastPhase: new Float32Array(this.half + 1),
      real: new Float32Array(this.size),
      imag: new Float32Array(this.size),
      synthReal: new Float32Array(this.size),
      synthImag: new Float32Array(this.size)
    };
  }

  /** Clear history in place (no allocation on the real-time thread). */
  reset() {
    for (const state of this.channels) {
      state.input.fill(0);
      state.output.fill(0);
      state.lastPhase.fill(0);
    }
    this.rotation.fill(0);
    this.inputCount = 0;
    this.outputPos = 0;
  }

  /** Cepstral smoothing of envWork (pooled log spectrum) in place. */
  smoothEnvelope() {
    const { envBins, envSize, envWork, cepReal, cepImag, lifter } = this;
    for (let bin = 0; bin <= envBins; bin++) {
      cepReal[bin] = envWork[bin];
      if (bin > 0 && bin < envBins) cepReal[envSize - bin] = envWork[bin];
    }
    cepImag.fill(0);
    this.envFFT(cepReal, cepImag, true);       // log spectrum → cepstrum
    for (let n = lifter + 1; n < envSize - lifter; n++) {
      cepReal[n] = 0;                          // drop fine (harmonic) structure
      cepImag[n] = 0;
    }
    this.envFFT(cepReal, cepImag, false);      // → smoothed log spectrum
    for (let bin = 0; bin <= envBins; bin++) envWork[bin] = cepReal[bin];
  }

  /**
   * "True envelope" (Röbel & Rodet 2005): repeated cepstral smoothing where
   * the target is raised to the current envelope each pass, so the result
   * rides on the harmonic peaks instead of averaging peaks and valleys.
   * Output: this.envelope (natural-log magnitude) for every analysis bin.
   */
  computeEnvelope(floor) {
    const { half, magnitude, envBins, envTarget, envWork, envelope } = this;
    for (let p = 0; p <= envBins; p++) {
      let max = 0;
      const start = p * ENVELOPE_POOL - (ENVELOPE_POOL >> 1);
      for (let k = Math.max(0, start); k < Math.min(half + 1, start + ENVELOPE_POOL); k++) {
        if (magnitude[k] > max) max = magnitude[k];
      }
      envTarget[p] = Math.log(max + floor);
    }

    // Bins with no partials (e.g. below a high voice's fundamental) carry no
    // timbre information. Left near the -100 dB floor they drag the smoothed
    // envelope down and make it ring (+18 dB false bumps for a 440 Hz voice).
    // Limit the range to 50 dB, and hold the first strong partial's level
    // below it, so harmonics shifted down there keep a sensible level.
    let maxTarget = -Infinity;
    for (let p = 0; p <= envBins; p++) if (envTarget[p] > maxTarget) maxTarget = envTarget[p];
    const lowest = maxTarget - ENVELOPE_RANGE;
    // The same holds above the last strong partial: e.g. a lone sine or a
    // sparse instrument would otherwise read as a narrow "formant" and be
    // attenuated (-4 dB at +3 keys) when shifted out of it.
    let first = 0;
    while (first < envBins && envTarget[first] < maxTarget - FIRST_PARTIAL_RANGE) first++;
    let last = envBins;
    while (last > first && envTarget[last] < maxTarget - FIRST_PARTIAL_RANGE) last--;
    // Hold the level of the partial itself, not of the edge bin on its flank.
    let firstLevel = -Infinity;
    for (let p = first; p <= Math.min(last, first + 2); p++) firstLevel = Math.max(firstLevel, envTarget[p]);
    let lastLevel = -Infinity;
    for (let p = Math.max(first, last - 2); p <= last; p++) lastLevel = Math.max(lastLevel, envTarget[p]);
    for (let p = 0; p <= envBins; p++) {
      if (p < first) envTarget[p] = firstLevel;
      else if (p > last) envTarget[p] = lastLevel;
      else envTarget[p] = Math.max(envTarget[p], lowest);
      envWork[p] = envTarget[p];
    }

    for (let iteration = 0; iteration < TRUE_ENVELOPE_ITERATIONS; iteration++) {
      this.smoothEnvelope();
      let worst = 0;
      for (let p = 0; p <= envBins; p++) {
        const above = envTarget[p] - envWork[p];
        if (above > worst) worst = above;
        if (above > 0) envWork[p] = envTarget[p]; // lift the target to the envelope
      }
      if (worst < TRUE_ENVELOPE_TOLERANCE) break;
    }
    this.smoothEnvelope();

    // Linear interpolation back to the full-resolution bins.
    for (let bin = 0; bin <= half; bin++) {
      const position = bin / ENVELOPE_POOL;
      const p = Math.min(envBins - 1, Math.floor(position));
      const t = position - p;
      envelope[bin] = envWork[p] * (1 - t) + envWork[p + 1] * t;
    }
  }

  processFrame() {
    const { size, half, hop, ratio, window, magnitude, peaks, rotation, nextRotation, envelope, channels } = this;
    const channelCount = channels.length;
    const advancePerBin = (TWO_PI * hop) / size;
    const binHz = sampleRate / size;

    for (const state of channels) {
      for (let i = 0; i < size; i++) {
        state.real[i] = state.input[i] * window[i];
        state.imag[i] = 0;
        state.synthReal[i] = 0;
        state.synthImag[i] = 0;
      }
      this.fft(state.real, state.imag, false);
    }

    // Combined (power-summed) magnitude drives peak picking and the envelope;
    // it does not cancel for out-of-phase content the way L+R would.
    let maxMagnitude = 0;
    for (let bin = 0; bin <= half; bin++) {
      let power = 0;
      for (const state of channels) {
        const re = state.real[bin];
        const im = state.imag[bin];
        power += re * re + im * im;
        state.phase[bin] = Math.atan2(im, re);
      }
      magnitude[bin] = Math.sqrt(power);
      if (magnitude[bin] > maxMagnitude) maxMagnitude = magnitude[bin];
    }

    const floor = maxMagnitude * 1e-5; // -100 dB relative to the loudest bin
    const formantTarget = this.formant ? 1 : 0;
    this.formantMix += Math.max(-0.125, Math.min(0.125, formantTarget - this.formantMix));
    const formantMix = this.formantMix;
    const preserveFormants = formantMix > 0 && ratio !== 1 && maxMagnitude > 0;
    if (preserveFormants) this.computeEnvelope(floor + 1e-12);

    let peakCount = 0;
    for (let bin = 1; bin < half; bin++) {
      const m = magnitude[bin];
      if (m > floor && m > magnitude[bin - 1] && m >= magnitude[bin + 1]) peaks[peakCount++] = bin;
    }

    nextRotation.fill(0);
    let regionStart = 0;
    for (let p = 0; p < peakCount; p++) {
      const peak = peaks[p];
      let regionEnd = half;
      if (p + 1 < peakCount) {
        regionEnd = peak;
        for (let bin = peak + 1; bin < peaks[p + 1]; bin++) {
          if (magnitude[bin] < magnitude[regionEnd]) regionEnd = bin;
        }
      }

      // True peak frequency from the channel that carries it most strongly.
      let dominant = channels[0];
      let dominantPower = -1;
      for (const state of channels) {
        const power = state.real[peak] * state.real[peak] + state.imag[peak] * state.imag[peak];
        if (power > dominantPower) { dominantPower = power; dominant = state; }
      }
      let delta = dominant.phase[peak] - dominant.lastPhase[peak] - peak * advancePerBin;
      delta -= TWO_PI * Math.round(delta / TWO_PI);
      const frequency = peak + delta / advancePerBin;
      const shift = frequency * (ratio - 1);
      const binShift = Math.round(shift);

      let theta = rotation[peak] + shift * advancePerBin;
      theta -= TWO_PI * Math.round(theta / TWO_PI);

      let gain = 1;
      if (preserveFormants) {
        const target = Math.min(half, Math.max(0, peak + binShift));
        const targetHz = target * binHz;
        const weight = targetHz <= FORMANT_FULL_HZ ? 1
          : targetHz >= FORMANT_NONE_HZ ? 0
          : (FORMANT_NONE_HZ - targetHz) / (FORMANT_NONE_HZ - FORMANT_FULL_HZ);
        if (weight > 0) {
          const logGain = Math.max(-MAX_FORMANT_LOG_GAIN, Math.min(MAX_FORMANT_LOG_GAIN, envelope[target] - envelope[peak]));
          gain = Math.exp(logGain * weight * formantMix);
        }
      }
      const rotCos = Math.cos(theta) * gain;
      const rotSin = Math.sin(theta) * gain;

      for (let bin = regionStart; bin <= regionEnd; bin++) {
        nextRotation[bin] = theta;
        const target = bin + binShift;
        if (target < 0 || target > half) continue;
        for (let c = 0; c < channelCount; c++) {
          const state = channels[c];
          const re = state.real[bin];
          const im = state.imag[bin];
          state.synthReal[target] += re * rotCos - im * rotSin;
          state.synthImag[target] += re * rotSin + im * rotCos;
        }
      }
      regionStart = regionEnd + 1;
    }

    rotation.set(nextRotation);

    for (const state of channels) {
      state.lastPhase.set(state.phase);
      const { synthReal, synthImag } = state;
      for (let bin = 1; bin < half; bin++) {
        synthReal[size - bin] = synthReal[bin];
        synthImag[size - bin] = -synthImag[bin];
      }
      synthImag[0] = 0;
      synthImag[half] = 0;
      this.fft(synthReal, synthImag, true);

      // Hann analysis/synthesis windows with 4x overlap sum to 1.5.
      for (let i = 0; i < size; i++) {
        const outputIndex = (this.outputPos + i) % this.outputLength;
        state.output[outputIndex] += synthReal[i] * window[i] * (2 / 3);
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || !output.length) return true;

    // Idle while the pitch path is muted (key 0 / power off): no FFT work.
    if (!this.active && !this.idle) {
      this.idleCountdown -= output[0].length;
      if (this.idleCountdown <= 0) this.idle = true;
    }
    if (this.idle) {
      for (let channel = 0; channel < output.length; channel++) output[channel].fill(0);
      return true;
    }

    while (this.channels.length < output.length) this.channels.push(this.createState());
    // Never analyse a channel that is no longer fed (its buffer would repeat stale audio).
    if (this.channels.length > output.length) this.channels.length = output.length;
    if (this.needsReset) {
      this.reset();
      this.needsReset = false;
    }

    const channelCount = output.length;
    const frames = output[0].length;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channelCount; c++) {
        const state = this.channels[c];
        const source = input.length ? input[Math.min(c, input.length - 1)] : null;
        output[c][i] = state.output[this.outputPos];
        state.output[this.outputPos] = 0;
        state.input[this.inputCount] = source ? source[i] : 0;
      }
      this.outputPos = (this.outputPos + 1) % this.outputLength;
      if (++this.inputCount === this.size) {
        this.processFrame();
        for (const state of this.channels) state.input.copyWithin(0, this.hop);
        this.inputCount = this.size - this.hop;
      }
    }
    return true;
  }
}

registerProcessor('karaoke-pitch-processor', PitchProcessor);
