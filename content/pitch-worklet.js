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
 * combined (power-summed) L/R spectrum and applied identically to both
 * channels. Processing channels independently let a centred vocal be shifted
 * slightly differently on each side (it leaked into L−R at −18.5 dB) and
 * sound smeared/hollow.
 */
const TWO_PI = 2 * Math.PI;
const IDLE_AFTER_SECONDS = 0.5; // keep running while the output gain fades out

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.hop = 512;
    this.half = this.size >> 1;
    this.ratio = 1;
    this.active = true;
    this.idleCountdown = 0;
    this.idle = false;
    this.needsReset = false;
    this.channels = [];
    this.inputCount = 0;   // shared frame clock: all channels advance together
    this.outputPos = 0;
    this.outputLength = this.size * 4;

    this.window = new Float32Array(this.size);
    this.bitReverse = new Uint16Array(this.size);
    this.cosine = new Float32Array(this.half);
    this.sine = new Float32Array(this.half);
    // Shared per-frame scratch (allocated once).
    this.magnitude = new Float32Array(this.half + 1);
    this.peaks = new Int32Array(this.half + 1);
    this.rotation = new Float32Array(this.half + 1);
    this.nextRotation = new Float32Array(this.half + 1);

    const bits = Math.log2(this.size);
    for (let i = 0; i < this.size; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / this.size));
      let value = i;
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) {
        reversed = (reversed << 1) | (value & 1);
        value >>= 1;
      }
      this.bitReverse[i] = reversed;
    }
    for (let i = 0; i < this.half; i++) {
      const angle = (TWO_PI * i) / this.size;
      this.cosine[i] = Math.cos(angle);
      this.sine[i] = Math.sin(angle);
    }

    this.port.onmessage = ({ data }) => {
      if (Number.isFinite(data.pitchRatio) && data.pitchRatio > 0) this.ratio = data.pitchRatio;
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

  fft(real, imag, inverse) {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.bitReverse[i];
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
          const cosine = this.cosine[offset * tableStep];
          const sine = inverse ? this.sine[offset * tableStep] : -this.sine[offset * tableStep];
          const even = start + offset;
          const odd = even + halfWidth;
          const oddReal = real[odd] * cosine - imag[odd] * sine;
          const oddImag = real[odd] * sine + imag[odd] * cosine;
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
  }

  processFrame() {
    const { size, half, hop, ratio, window, magnitude, peaks, rotation, nextRotation, channels } = this;
    const channelCount = channels.length;
    const advancePerBin = (TWO_PI * hop) / size;

    for (const state of channels) {
      for (let i = 0; i < size; i++) {
        state.real[i] = state.input[i] * window[i];
        state.imag[i] = 0;
        state.synthReal[i] = 0;
        state.synthImag[i] = 0;
      }
      this.fft(state.real, state.imag, false);
    }

    // Combined (power-summed) magnitude drives peak picking; unlike L+R it
    // does not cancel for out-of-phase content.
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

    // Local maxima above a -100 dB floor relative to the frame's loudest bin.
    const floor = maxMagnitude * 1e-5;
    let peakCount = 0;
    for (let bin = 1; bin < half; bin++) {
      const m = magnitude[bin];
      if (m > floor && m > magnitude[bin - 1] && m >= magnitude[bin + 1]) peaks[peakCount++] = bin;
    }

    nextRotation.fill(0);
    let regionStart = 0;
    for (let p = 0; p < peakCount; p++) {
      const peak = peaks[p];
      // Region boundary: the lowest bin between this peak and the next.
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
      const rotCos = Math.cos(theta);
      const rotSin = Math.sin(theta);

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
