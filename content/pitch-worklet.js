/*
 * STFT phase-vocoder AudioWorklet.
 * The processor uses fractional-bin redistribution, rather than rounding a
 * target bin, so a requested equal-temperament ratio is not quantized to the
 * FFT-bin spacing.
 */
class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.hop = 512;
    this.half = this.size >> 1;
    this.ratio = 1;
    this.channels = [];
    this.window = new Float32Array(this.size);
    this.bitReverse = new Uint16Array(this.size);
    this.cosine = new Float32Array(this.half);
    this.sine = new Float32Array(this.half);

    for (let i = 0; i < this.size; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / this.size));
      let value = i;
      let reversed = 0;
      for (let bit = 0; bit < 11; bit++) {
        reversed = (reversed << 1) | (value & 1);
        value >>= 1;
      }
      this.bitReverse[i] = reversed;
    }
    for (let i = 0; i < this.half; i++) {
      const angle = (2 * Math.PI * i) / this.size;
      this.cosine[i] = Math.cos(angle);
      this.sine[i] = Math.sin(angle);
    }

    this.port.onmessage = ({ data }) => {
      if (Number.isFinite(data.pitchRatio) && data.pitchRatio > 0) {
        this.ratio = data.pitchRatio;
      }
    };
  }

  createState() {
    return {
      input: new Float32Array(this.size),
      inputCount: 0,
      output: new Float32Array(this.size * 4),
      outputPos: 0,
      lastPhase: new Float32Array(this.half + 1),
      // Phase belongs to an analysed source partial, not to a destination
      // FFT bin. Several partials may land in one destination bin when
      // shifting down; sharing a phase accumulator there was the source of
      // large pitch errors for negative semitone settings.
      sourcePhase: new Float32Array(this.half + 1),
      real: new Float32Array(this.size),
      imag: new Float32Array(this.size),
      synthReal: new Float32Array(this.size),
      synthImag: new Float32Array(this.size)
    };
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

  processFrame(state) {
    const { size, half, hop, ratio, window } = this;
    const expectedAdvance = (2 * Math.PI * hop) / size;
    const { real, imag, synthReal, synthImag } = state;

    for (let i = 0; i < size; i++) {
      real[i] = state.input[i] * window[i];
      imag[i] = 0;
      synthReal[i] = 0;
      synthImag[i] = 0;
    }
    this.fft(real, imag, false);

    for (let bin = 0; bin <= half; bin++) {
      const magnitude = Math.hypot(real[bin], imag[bin]);
      if (magnitude < 1e-12) continue;

      const phase = Math.atan2(imag[bin], real[bin]);
      let phaseDelta = phase - state.lastPhase[bin] - bin * expectedAdvance;
      state.lastPhase[bin] = phase;
      phaseDelta -= 2 * Math.PI * Math.round(phaseDelta / (2 * Math.PI));
      const instantaneousFrequency = (bin * expectedAdvance + phaseDelta) / hop;
      const target = bin * ratio;
      const lower = Math.floor(target);
      const upperWeight = target - lower;
      const targetPhase = (state.sourcePhase[bin] += instantaneousFrequency * ratio * hop);

      // Preserve the exact fractional target frequency by distributing energy
      // between adjacent bins instead of rounding to one of them. Avoid
      // temporary arrays here: this runs on Chrome's real-time audio thread.
      const phaseCosine = Math.cos(targetPhase);
      const phaseSine = Math.sin(targetPhase);
      if (lower >= 0 && lower <= half) {
        const weight = 1 - upperWeight;
        synthReal[lower] += magnitude * weight * phaseCosine;
        synthImag[lower] += magnitude * weight * phaseSine;
      }
      const upper = lower + 1;
      if (upperWeight > 0 && upper <= half) {
        synthReal[upper] += magnitude * upperWeight * phaseCosine;
        synthImag[upper] += magnitude * upperWeight * phaseSine;
      }
    }

    for (let bin = 1; bin < half; bin++) {
      synthReal[size - bin] = synthReal[bin];
      synthImag[size - bin] = -synthImag[bin];
    }
    synthImag[0] = 0;
    synthImag[half] = 0;
    this.fft(synthReal, synthImag, true);

    // Hann analysis/synthesis windows with 4x overlap sum to 1.5.
    for (let i = 0; i < size; i++) {
      const outputIndex = (state.outputPos + i) % state.output.length;
      state.output[outputIndex] += synthReal[i] * window[i] * (2 / 3);
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;

    for (let channel = 0; channel < output.length; channel++) {
      if (!this.channels[channel]) this.channels[channel] = this.createState();
      const source = input[Math.min(channel, input.length - 1)];
      const destination = output[channel];
      const state = this.channels[channel];

      for (let i = 0; i < destination.length; i++) {
        destination[i] = state.output[state.outputPos];
        state.output[state.outputPos] = 0;
        state.outputPos = (state.outputPos + 1) % state.output.length;

        state.input[state.inputCount++] = source ? source[i] : 0;
        if (state.inputCount === this.size) {
          this.processFrame(state);
          state.input.copyWithin(0, this.hop);
          state.inputCount = this.size - this.hop;
        }
      }
    }
    return true;
  }
}

registerProcessor('karaoke-pitch-processor', PitchProcessor);
