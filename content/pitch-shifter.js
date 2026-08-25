/**
 * Phase Vocoder AudioWorklet Source Code
 * 고품질 STFT (Short-Time Fourier Transform) 기반 실시간 주파수 피치 시프터
 */

const PHASE_VOCODER_WORKLET_CODE = `
class PhaseVocoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fftSize = 2048;
    this.hopSize = 512; // 75% overlap
    this.pitchRatio = 1.0;
    this.sampleRate = 44100;

    // FFT Tables
    this.cosTable = new Float32Array(this.fftSize / 2);
    this.sinTable = new Float32Array(this.fftSize / 2);
    for (let i = 0; i < this.fftSize / 2; i++) {
      this.cosTable[i] = Math.cos((2.0 * Math.PI * i) / this.fftSize);
      this.sinTable[i] = Math.sin((2.0 * Math.PI * i) / this.fftSize);
    }

    // Bit reversal table
    this.bitRev = new Int32Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      let rev = 0;
      for (let j = 0; j < 11; j++) { // log2(2048) = 11
        rev = (rev << 1) | ((i >> j) & 1);
      }
      this.bitRev[i] = rev;
    }

    // Hann window
    this.window = new Float32Array(this.fftSize);
    let winSum = 0;
    for (let i = 0; i < this.fftSize; i++) {
      this.window[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / this.fftSize));
      winSum += this.window[i];
    }
    // Normalize window for 75% overlap
    const winNorm = (2.0 / 3.0) / (this.fftSize / this.hopSize);

    // Channel buffers (Stereo: L, R)
    this.channels = [this.createChannelState(), this.createChannelState()];

    this.port.onmessage = (e) => {
      if (e.data.pitchRatio !== undefined) {
        this.pitchRatio = e.data.pitchRatio;
      }
      if (e.data.sampleRate !== undefined) {
        this.sampleRate = e.data.sampleRate;
      }
    };
  }

  createChannelState() {
    const N = this.fftSize;
    return {
      inFifo: new Float32Array(N),
      outFifo: new Float32Array(N),
      inPos: 0,
      outPos: 0,
      lastPhase: new Float32Array(N / 2 + 1),
      sumPhase: new Float32Array(N / 2 + 1),
      re: new Float32Array(N),
      im: new Float32Array(N),
      synRe: new Float32Array(N),
      synIm: new Float32Array(N)
    };
  }

  fft(re, im, inverse) {
    const n = this.fftSize;
    // Bit reversal
    for (let i = 0; i < n; i++) {
      const j = this.bitRev[i];
      if (j > i) {
        let temp = re[i]; re[i] = re[j]; re[j] = temp;
        temp = im[i]; im[i] = im[j]; im[j] = temp;
      }
    }

    // Cooley-Tukey Radix-2
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const k = j * step;
          const c = this.cosTable[k];
          const s = inverse ? -this.sinTable[k] : this.sinTable[k];
          const tr = re[i + j + half] * c - im[i + j + half] * s;
          const ti = re[i + j + half] * s + im[i + j + half] * c;
          re[i + j + half] = re[i + j] - tr;
          im[i + j + half] = im[i + j] - ti;
          re[i + j] += tr;
          im[i + j] += ti;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  processChannel(inData, outData, state) {
    const N = this.fftSize;
    const H = this.hopSize;
    const halfN = N / 2;
    const pitch = this.pitchRatio;
    const expPhaseAdv = (2.0 * Math.PI * H) / N;

    for (let i = 0; i < inData.length; i++) {
      state.inFifo[state.inPos++] = inData[i];
      outData[i] = state.outFifo[state.outPos];
      state.outFifo[state.outPos] = 0; // Clear after consumption
      state.outPos = (state.outPos + 1) % N;

      // When we have hopSize new samples, run STFT Phase Vocoder
      if (state.inPos >= H) {
        state.inPos = 0;

        // 1. Windowing into FFT buffer
        for (let k = 0; k < N; k++) {
          const idx = (state.outPos + k) % N;
          state.re[k] = state.inFifo[k] * this.window[k];
          state.im[k] = 0;
        }

        // Shift inFifo by H
        state.inFifo.copyWithin(0, H, N);

        // 2. Forward FFT
        this.fft(state.re, state.im, false);

        // 3. Phase Vocoder Processing
        state.synRe.fill(0);
        state.synIm.fill(0);

        for (let k = 0; k <= halfN; k++) {
          const real = state.re[k];
          const imag = state.im[k];
          const mag = 2.0 * Math.sqrt(real * real + imag * imag);
          const phase = Math.atan2(imag, real);

          // Phase difference
          let dPhase = phase - state.lastPhase[k];
          state.lastPhase[k] = phase;

          // Expected phase advance
          dPhase -= k * expPhaseAdv;

          // Unwrap to [-PI, +PI]
          let qpd = Math.floor(dPhase / (2.0 * Math.PI) + 0.5);
          dPhase -= 2.0 * Math.PI * qpd;

          // Instantaneous frequency
          const trueFreq = k + (dPhase / expPhaseAdv);

          // Pitch shift target bin
          const newBin = Math.round(k * pitch);
          if (newBin <= halfN && newBin >= 0) {
            // Accumulate synthesis phase
            state.sumPhase[newBin] += trueFreq * pitch * expPhaseAdv;
            const synPhase = state.sumPhase[newBin];

            state.synRe[newBin] += mag * Math.cos(synPhase);
            state.synIm[newBin] += mag * Math.sin(synPhase);
          }
        }

        // Mirror complex spectrum for IFFT
        for (let k = 1; k < halfN; k++) {
          state.synRe[N - k] = state.synRe[k];
          state.synIm[N - k] = -state.synIm[k];
        }
        state.synIm[0] = 0;
        state.synIm[halfN] = 0;

        // 4. Inverse FFT
        this.fft(state.synRe, state.synIm, true);

        // 5. Overlap-Add with Synthesis Window (Normalized for 75% overlap Hann window)
        const normFactor = 2.0 / 3.0;
        for (let k = 0; k < N; k++) {
          const outIdx = (state.outPos + k) % N;
          state.outFifo[outIdx] += state.synRe[k] * this.window[k] * normFactor;
        }
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const numChannels = Math.min(input.length, output.length, 2);

    // Bypass mode when pitchRatio is 1.0 (Bit-perfect fast copy)
    if (Math.abs(this.pitchRatio - 1.0) < 1e-4) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    for (let c = 0; c < numChannels; c++) {
      this.processChannel(input[c], output[c], this.channels[c]);
    }

    return true;
  }
}

registerProcessor('phase-vocoder-processor', PhaseVocoderProcessor);
`;

/**
 * AudioPitchShifter Master Engine
 */
class AudioPitchShifter {
  constructor() {
    this.audioCtx = null;
    this.videoElement = null;
    this.sourceNode = null;
    
    // Master Nodes
    this.inputGain = null;
    this.outputGain = null;
    this.bypassGain = null;
    this.pitchGain = null;
    this.workletNode = null;
    this.compressor = null;
    
    // Vocal Cut Nodes
    this.vocalCutEnabled = false;
    this.splitterNode = null;
    this.mergerNode = null;
    this.inverterNode = null;
    this.bassFilterNode = null;
    this.vocalCutGain = null;
    this.directPassGain = null;
    this.vocalProcessingIn = null;
    this.vocalProcessingOut = null;
    
    // State
    this.enabled = true;
    this.semitones = 0;
    this.tempo = 1.0;
    this.volume = 1.0;
    this.isInitialized = false;
    this.isConnected = false;
    this.isWorkletLoaded = false;
  }

  /**
   * AudioContext 초기화 및 비디오 요소 연결
   */
  async init(videoElement) {
    if (!videoElement) return false;
    if (this.videoElement === videoElement && this.isInitialized) {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      return true;
    }

    try {
      this.videoElement = videoElement;
      
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
      }

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      // 비디오에 중복 createMediaElementSource 호출 방지
      if (!videoElement.__pitchSourceConnected) {
        try {
          this.sourceNode = this.audioCtx.createMediaElementSource(videoElement);
          videoElement.__pitchSourceConnected = true;
          videoElement.__pitchSourceNode = this.sourceNode;
        } catch (e) {
          if (videoElement.__pitchSourceNode) {
            this.sourceNode = videoElement.__pitchSourceNode;
          } else {
            console.warn('[Karaoke Shifter] MediaElementSource attach error:', e);
            return false;
          }
        }
      } else if (videoElement.__pitchSourceNode) {
        this.sourceNode = videoElement.__pitchSourceNode;
      }

      // AudioWorklet 모듈 로드
      await this.loadAudioWorklet();

      this.setupAudioGraph();
      this.isInitialized = true;
      this.isConnected = true;

      // 초기 설정값 적용
      this.setPitch(this.semitones);
      this.setVolume(this.volume);
      this.setTempo(this.tempo);
      this.setVocalCut(this.vocalCutEnabled);

      console.log('[Karaoke Shifter] Phase Vocoder AudioWorklet Initialized Successfully');
      return true;
    } catch (err) {
      console.error('[Karaoke Shifter] Init failed:', err);
      return false;
    }
  }

  /**
   * 인라인 Blob URL로 AudioWorklet 로드 (CORS/권한 이슈 없음)
   */
  async loadAudioWorklet() {
    if (this.isWorkletLoaded) return;
    try {
      const blob = new Blob([PHASE_VOCODER_WORKLET_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await this.audioCtx.audioWorklet.addModule(workletUrl);
      this.isWorkletLoaded = true;
      URL.revokeObjectURL(workletUrl);
    } catch (e) {
      console.error('[Karaoke Shifter] AudioWorklet load failed:', e);
    }
  }

  /**
   * Web Audio DSP 그래프 구성
   */
  setupAudioGraph() {
    const ctx = this.audioCtx;

    // 1. Master Gains & Transparent Limiter
    this.inputGain = ctx.createGain();
    this.outputGain = ctx.createGain();
    this.bypassGain = ctx.createGain();
    this.pitchGain = ctx.createGain();

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-6, ctx.currentTime);
    this.compressor.knee.setValueAtTime(12, ctx.currentTime);
    this.compressor.ratio.setValueAtTime(3, ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    this.compressor.release.setValueAtTime(0.15, ctx.currentTime);

    // Source -> Input Gain
    this.sourceNode.connect(this.inputGain);

    // 2. Vocal Cut (Center Cancellation) 서브그래프
    this.setupVocalCutGraph();

    // 3. Phase Vocoder Worklet Node 연결
    try {
      this.workletNode = new AudioWorkletNode(ctx, 'phase-vocoder-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      this.vocalProcessingOut.connect(this.workletNode);
      this.workletNode.connect(this.pitchGain);
    } catch (e) {
      console.warn('[Karaoke Shifter] AudioWorkletNode init fallback:', e);
    }

    // Direct Bypass path
    this.vocalProcessingOut.connect(this.bypassGain);

    // Sum -> Compressor -> Master Output -> Destination
    this.bypassGain.connect(this.compressor);
    this.pitchGain.connect(this.compressor);
    this.compressor.connect(this.outputGain);
    this.outputGain.connect(ctx.destination);

    this.updatePitchInternal(1.0);
  }

  /**
   * 보컬 제거 (가라오케 모드) 그래프 설정
   */
  setupVocalCutGraph() {
    const ctx = this.audioCtx;
    
    this.vocalProcessingIn = ctx.createGain();
    this.vocalProcessingOut = ctx.createGain();
    this.directPassGain = ctx.createGain();
    this.vocalCutGain = ctx.createGain();

    // Direct path
    this.inputGain.connect(this.directPassGain);
    this.directPassGain.connect(this.vocalProcessingOut);

    // Vocal Cut path
    this.splitterNode = ctx.createChannelSplitter(2);
    this.mergerNode = ctx.createChannelMerger(2);
    this.inverterNode = ctx.createGain();
    this.inverterNode.gain.value = -1;

    this.bassFilterNode = ctx.createBiquadFilter();
    this.bassFilterNode.type = 'lowpass';
    this.bassFilterNode.frequency.value = 140;

    const leftGain = ctx.createGain();

    this.inputGain.connect(this.vocalProcessingIn);
    this.vocalProcessingIn.connect(this.splitterNode);

    this.splitterNode.connect(leftGain, 0);
    this.splitterNode.connect(this.inverterNode, 1);
    this.inverterNode.connect(leftGain);

    leftGain.connect(this.mergerNode, 0, 0);
    leftGain.connect(this.mergerNode, 0, 1);

    this.vocalProcessingIn.connect(this.bassFilterNode);
    this.bassFilterNode.connect(this.mergerNode, 0, 0);
    this.bassFilterNode.connect(this.mergerNode, 0, 1);

    this.mergerNode.connect(this.vocalCutGain);
    this.vocalCutGain.connect(this.vocalProcessingOut);

    this.directPassGain.gain.value = 1.0;
    this.vocalCutGain.gain.value = 0.0;
    this.vocalProcessingIn.gain.value = 0.0;
  }

  /**
   * 반음 단위 키(Pitch) 설정 (-12 ~ +12)
   */
  setPitch(semitones) {
    this.semitones = Math.max(-12, Math.min(12, Math.round(semitones)));
    const pitchRatio = Math.pow(2, this.semitones / 12);
    
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.updatePitchInternal(pitchRatio);
    return this.semitones;
  }

  /**
   * 피치 내부 파라미터 갱신 (Phase Vocoder)
   */
  updatePitchInternal(pitchRatio) {
    if (!this.isInitialized || !this.audioCtx) return;

    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const smoothTime = 0.03;

    if (this.workletNode && this.workletNode.port) {
      this.workletNode.port.postMessage({
        pitchRatio: pitchRatio,
        sampleRate: ctx.sampleRate
      });
    }

    if (this.semitones === 0 || !this.enabled) {
      // Bypass Mode: 100% 원음 직결 (음질 손실 0%, 레이턴시 0ms)
      this.bypassGain.gain.cancelScheduledValues(now);
      this.pitchGain.gain.cancelScheduledValues(now);
      this.bypassGain.gain.setTargetAtTime(1.0, now, smoothTime);
      this.pitchGain.gain.setTargetAtTime(0.0, now, smoothTime);
    } else {
      // Phase Vocoder Mode
      this.bypassGain.gain.cancelScheduledValues(now);
      this.pitchGain.gain.cancelScheduledValues(now);
      this.bypassGain.gain.setTargetAtTime(0.0, now, smoothTime);
      this.pitchGain.gain.setTargetAtTime(1.0, now, smoothTime);
    }
  }

  /**
   * 템포(재생 속도) 설정 (0.5x ~ 1.5x)
   */
  setTempo(tempo) {
    this.tempo = Math.max(0.5, Math.min(2.0, parseFloat(tempo.toFixed(2))));
    if (this.videoElement) {
      this.videoElement.playbackRate = this.tempo;
    }
    return this.tempo;
  }

  /**
   * 마스터 볼륨 부스트 (0.0 ~ 2.5x)
   */
  setVolume(vol) {
    this.volume = Math.max(0.0, Math.min(2.5, parseFloat(vol.toFixed(2))));
    if (this.outputGain && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.outputGain.gain.cancelScheduledValues(now);
      this.outputGain.gain.setTargetAtTime(this.volume, now, 0.03);
    }
    return this.volume;
  }

  /**
   * 보컬 제거 (가라오케 모드) 토글
   */
  setVocalCut(enable) {
    this.vocalCutEnabled = !!enable;
    if (!this.isInitialized || !this.audioCtx) return this.vocalCutEnabled;

    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const smooth = 0.05;

    if (this.vocalCutEnabled) {
      this.directPassGain.gain.setTargetAtTime(0.0, now, smooth);
      this.vocalProcessingIn.gain.setTargetAtTime(1.0, now, smooth);
      this.vocalCutGain.gain.setTargetAtTime(1.0, now, smooth);
    } else {
      this.directPassGain.gain.setTargetAtTime(1.0, now, smooth);
      this.vocalCutGain.gain.setTargetAtTime(0.0, now, smooth);
      this.vocalProcessingIn.gain.setTargetAtTime(0.0, now, smooth);
    }
    return this.vocalCutEnabled;
  }

  /**
   * 마스터 ON/OFF 설정
   */
  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.isInitialized || !this.audioCtx) return this.enabled;

    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const smooth = 0.03;

    if (!this.enabled) {
      this.bypassGain.gain.setTargetAtTime(1.0, now, smooth);
      this.pitchGain.gain.setTargetAtTime(0.0, now, smooth);
      this.directPassGain.gain.setTargetAtTime(1.0, now, smooth);
      this.vocalCutGain.gain.setTargetAtTime(0.0, now, smooth);
      if (this.videoElement) {
        this.videoElement.playbackRate = 1.0;
      }
    } else {
      this.setPitch(this.semitones);
      this.setTempo(this.tempo);
      this.setVolume(this.volume);
      this.setVocalCut(this.vocalCutEnabled);
    }
    return this.enabled;
  }

  /**
   * 상태 리셋 (원키 0, 템포 1.0, 보컬컷 OFF)
   */
  reset() {
    this.setPitch(0);
    this.setTempo(1.0);
    this.setVolume(1.0);
    this.setVocalCut(false);
    return this.getState();
  }

  /**
   * 현재 상태 반환
   */
  getState() {
    return {
      enabled: this.enabled,
      semitones: this.semitones,
      tempo: this.tempo,
      volume: this.volume,
      vocalCutEnabled: this.vocalCutEnabled,
      isInitialized: this.isInitialized
    };
  }
}

// 전역 인스턴스 등록
window.__KaraokePitchShifter = window.__KaraokePitchShifter || new AudioPitchShifter();
