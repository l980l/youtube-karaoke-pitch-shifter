/**
 * YouTube Karaoke Pitch Shifter Engine
 *
 * Audio graph (per attached <video>):
 *
 *   source ─► directGain ───────────────────────────────────────────────► destination
 *      │                                                   (true bypass: OFF / neutral)
 *      └─► inputGain ─► [vocal cut] ─► vocalOut ─┬─► bypassGain ─────────────┐
 *                                                └─► pitch engine ─► pitchGain ─► toneFilter ─┤
 *                                                                                              ▼
 *                       destination ◄─ processedGain ◄─ limiter ◄─ volumeGain ◄──────────── mixBus
 *
 * "Neutral" (power OFF, or key 0 + vocal cut off + volume 100%) routes the
 * untouched source straight to the speakers, so nothing (not even the
 * limiter) colours the original sound. The volume boost sits before a peak
 * limiter so boosted audio cannot clip.
 */

const SMOOTH = 0.03;
// DynamicsCompressorNode applies automatic makeup gain derived from its curve
// (+0.57 dB measured in Chrome for the limiter settings below). Cancel it so
// switching between the bypass and processed paths has no level jump.
const LIMITER_MAKEUP_COMPENSATION = Math.pow(10, -0.57 / 20);

class AudioPitchShifter {
  constructor() {
    this.audioCtx = null;
    this.videoElement = null;
    this.sourceNode = null;
    this.isWorkletLoaded = false;
    this.workletNode = null;
    this.nodes = [];          // every node created for the current graph (for teardown)
    this.loopSources = [];    // fallback engine LFO sources (must be stopped)
    this.bufferTime = 0.100;  // fallback delay-line window
    this.onPitchChange = null;    // callback() after the key changes (per-video memory)
    this.onExternalChange = null; // callback(state) when state changes outside our UI (e.g. YouTube speed menu)
    this.handleRateChange = this.handleRateChange.bind(this);

    // State
    this.enabled = true;
    this.semitones = 0;
    this.tempo = 1.0;
    this.volume = 1.0;
    this.vocalCutEnabled = false;
    this.preserveFormants = true;
    this.isInitialized = false;
  }

  /**
   * AudioContext 초기화 및 비디오 요소 연결.
   * 다른 <video>로 바뀌면 이전 그래프를 완전히 해제한 뒤 새로 구성한다.
   */
  async init(videoElement) {
    if (!videoElement) return false;
    if (this.videoElement === videoElement && this.isInitialized) {
      if (this.audioCtx && this.audioCtx.state === 'suspended') this.setupUserGestureResume();
      return true;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!this.audioCtx) this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
      await this.loadAudioWorklet();

      // createMediaElementSource는 요소당 한 번만 가능하므로 요소에 캐시한다.
      let source = videoElement.__pitchSourceNode;
      if (!source) {
        source = this.audioCtx.createMediaElementSource(videoElement);
        videoElement.__pitchSourceNode = source;
      }

      this.teardownGraph();
      try { source.disconnect(); } catch (e) {} // 이전 원음 직결(passthrough) 해제
      this.videoElement = videoElement;
      this.sourceNode = source;
      videoElement.addEventListener('ratechange', this.handleRateChange);

      if (this.audioCtx.state === 'suspended') this.setupUserGestureResume();

      this.setupAudioGraph();
      this.isInitialized = true;
      this.applyAll();
      console.log('[Karaoke Shifter] Audio engine attached');
      return true;
    } catch (err) {
      console.error('[Karaoke Shifter] Init failed:', err);
      return false;
    }
  }

  /** 이전 비디오에 연결된 노드를 모두 끊어 중복 출력·메모리 누수를 막는다. */
  teardownGraph() {
    if (this.videoElement) {
      this.videoElement.removeEventListener('ratechange', this.handleRateChange);
    }
    if (this.sourceNode) {
      // 미디어 요소는 소스 노드를 통해서만 소리가 나므로, 이전 영상은 원음 그대로 출력되게 남겨둔다.
      try { this.sourceNode.disconnect(); } catch (e) {}
      try { this.sourceNode.connect(this.audioCtx.destination); } catch (e) {}
    }
    for (const src of this.loopSources) {
      try { src.stop(); } catch (e) {}
    }
    for (const node of this.nodes) {
      try { node.disconnect(); } catch (e) {}
    }
    if (this.workletNode) {
      try { this.workletNode.port.close(); } catch (e) {}
    }
    this.nodes = [];
    this.loopSources = [];
    this.workletNode = null;
    this.isInitialized = false;
  }

  /**
   * 확장 프로그램 리소스에서 워크릿을 읽는다. 실패하면 지연선 호환 엔진을 쓴다.
   */
  async loadAudioWorklet() {
    if (this.isWorkletLoaded || !this.audioCtx?.audioWorklet) return;
    try {
      await this.audioCtx.audioWorklet.addModule(chrome.runtime.getURL('content/pitch-worklet.js'));
      this.isWorkletLoaded = true;
    } catch (error) {
      console.warn('[Karaoke Shifter] Precision worklet unavailable; using compatibility engine.', error);
    }
  }

  /** 자동재생 정책: 사용자 상호작용(재생/클릭/키입력) 시 AudioContext 재개 */
  setupUserGestureResume() {
    if (!this.audioCtx || this.audioCtx.state === 'running') return;
    const resume = () => {
      if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
      window.removeEventListener('pointerdown', resume, true);
      window.removeEventListener('keydown', resume, true);
    };
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
    if (this.videoElement) this.videoElement.addEventListener('play', resume, { once: true });
  }

  /** 그래프용 노드 생성 헬퍼 (teardown 대상 등록) */
  track(node) {
    this.nodes.push(node);
    return node;
  }

  gain(value = 1) {
    const node = this.track(this.audioCtx.createGain());
    node.gain.value = value;
    return node;
  }

  setupAudioGraph() {
    const ctx = this.audioCtx;

    this.directGain = this.gain(1);
    this.processedGain = this.gain(0);
    this.inputGain = this.gain(1);
    this.bypassGain = this.gain(1);
    this.pitchGain = this.gain(0);
    this.mixBus = this.gain(1);
    this.volumeGain = this.gain(1);

    // 피치 경로 음색 보정 (지연/위상 처리로 얇아지는 저역 보강)
    this.toneFilter = this.track(ctx.createBiquadFilter());
    this.toneFilter.type = 'lowshelf';
    this.toneFilter.frequency.value = 350;
    this.toneFilter.gain.value = 1.5;

    // 피크 리미터: 볼륨 증폭 후 클리핑 방지. 평소 레벨에서는 거의 동작하지 않는다.
    this.limiter = this.track(ctx.createDynamicsCompressor());
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;

    // True bypass
    this.sourceNode.connect(this.directGain);
    this.directGain.connect(ctx.destination);

    // Processed path
    this.sourceNode.connect(this.inputGain);
    this.setupVocalCutGraph();
    this.vocalProcessingOut.connect(this.bypassGain);
    this.bypassGain.connect(this.mixBus);
    if (this.isWorkletLoaded) {
      this.setupWorkletPitchGraph();
    } else {
      this.setupPitchShifterGraph();
    }
    this.pitchGain.connect(this.toneFilter);
    this.toneFilter.connect(this.mixBus);
    this.mixBus.connect(this.volumeGain);
    this.volumeGain.connect(this.limiter);
    this.limiter.connect(this.processedGain);
    this.processedGain.connect(ctx.destination);
  }

  /** STFT phase-vocoder 워크릿 경로 */
  setupWorkletPitchGraph() {
    this.workletNode = this.track(new AudioWorkletNode(this.audioCtx, 'karaoke-pitch-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    }));
    this.vocalProcessingOut.connect(this.workletNode);
    this.workletNode.connect(this.pitchGain);
  }

  /** 보컬 제거: (L - R) 사이드 신호 + 저역(140Hz 이하) 복원 */
  setupVocalCutGraph() {
    const ctx = this.audioCtx;
    this.vocalProcessingIn = this.gain(0);
    this.vocalProcessingOut = this.gain(1);
    this.directPassGain = this.gain(1);
    this.vocalCutGain = this.gain(0);

    this.inputGain.connect(this.directPassGain);
    this.directPassGain.connect(this.vocalProcessingOut);

    const splitter = this.track(ctx.createChannelSplitter(2));
    const merger = this.track(ctx.createChannelMerger(2));
    const inverter = this.gain(-1);
    const side = this.gain(1);
    const bass = this.track(ctx.createBiquadFilter());
    bass.type = 'lowpass';
    bass.frequency.value = 140;

    this.inputGain.connect(this.vocalProcessingIn);
    this.vocalProcessingIn.connect(splitter);
    splitter.connect(side, 0);
    splitter.connect(inverter, 1);
    inverter.connect(side);
    side.connect(merger, 0, 0);
    side.connect(merger, 0, 1);

    this.vocalProcessingIn.connect(bass);
    bass.connect(merger, 0, 0);
    bass.connect(merger, 0, 1);

    merger.connect(this.vocalCutGain);
    this.vocalCutGain.connect(this.vocalProcessingOut);
  }

  /** 호환 엔진: 2-탭 변조 지연선 (AudioWorklet 미지원 환경용) */
  setupPitchShifterGraph() {
    const ctx = this.audioCtx;
    const bufferTime = this.bufferTime;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(bufferTime * sampleRate);

    this.delay1 = this.track(ctx.createDelay(1.0));
    this.delay2 = this.track(ctx.createDelay(1.0));
    const delayGain1 = this.gain(0);
    const delayGain2 = this.gain(0);

    const modBuffer1 = ctx.createBuffer(1, length, sampleRate);
    const modBuffer2 = ctx.createBuffer(1, length, sampleRate);
    const fadeBuffer1 = ctx.createBuffer(1, length, sampleRate);
    const fadeBuffer2 = ctx.createBuffer(1, length, sampleRate);
    const d1 = modBuffer1.getChannelData(0);
    const d2 = modBuffer2.getChannelData(0);
    const f1 = fadeBuffer1.getChannelData(0);
    const f2 = fadeBuffer2.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const t2 = (t + 0.5) % 1.0;
      d1[i] = t * bufferTime;
      d2[i] = t2 * bufferTime;
      f1[i] = t <= 0.5 ? 2.0 * t : 2.0 * (1.0 - t);
      f2[i] = t2 <= 0.5 ? 2.0 * t2 : 2.0 * (1.0 - t2);
    }

    const loop = (buffer) => {
      const src = this.track(ctx.createBufferSource());
      src.buffer = buffer;
      src.loop = true;
      this.loopSources.push(src);
      return src;
    };
    const mod1 = loop(modBuffer1);
    const mod2 = loop(modBuffer2);
    const fade1 = loop(fadeBuffer1);
    const fade2 = loop(fadeBuffer2);

    this.modGain1 = this.gain(0);
    this.modGain2 = this.gain(0);
    mod1.connect(this.modGain1);
    mod2.connect(this.modGain2);
    this.modGain1.connect(this.delay1.delayTime);
    this.modGain2.connect(this.delay2.delayTime);
    fade1.connect(delayGain1.gain);
    fade2.connect(delayGain2.gain);

    this.vocalProcessingOut.connect(this.delay1);
    this.vocalProcessingOut.connect(this.delay2);
    this.delay1.connect(delayGain1);
    this.delay2.connect(delayGain2);
    delayGain1.connect(this.pitchGain);
    delayGain2.connect(this.pitchGain);

    for (const src of this.loopSources) src.start(0);
  }

  ramp(param, value, smooth = SMOOTH) {
    const now = this.audioCtx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, smooth);
  }

  /** 원음과 완전히 같은 상태인지 (그래프를 통째로 우회 가능한지) */
  isNeutral() {
    return !this.enabled || (this.semitones === 0 && !this.vocalCutEnabled && this.volume === 1);
  }

  /** 모든 상태를 오디오 그래프에 반영 */
  applyAll() {
    if (!this.isInitialized || !this.audioCtx) return;
    const neutral = this.isNeutral();
    const shifting = this.enabled && this.semitones !== 0;
    const vocalCut = this.enabled && this.vocalCutEnabled;

    this.ramp(this.directGain.gain, neutral ? 1 : 0);
    this.ramp(this.processedGain.gain, neutral ? 0 : LIMITER_MAKEUP_COMPENSATION);
    this.ramp(this.bypassGain.gain, shifting ? 0 : 1);
    this.ramp(this.pitchGain.gain, shifting ? 1 : 0);
    this.ramp(this.volumeGain.gain, this.enabled ? this.volume : 1);
    this.ramp(this.directPassGain.gain, vocalCut ? 0 : 1, 0.05);
    this.ramp(this.vocalProcessingIn.gain, vocalCut ? 1 : 0, 0.05);
    this.ramp(this.vocalCutGain.gain, vocalCut ? 1 : 0, 0.05);

    this.applyPitchEngine(shifting);
  }

  applyPitchEngine(shifting) {
    const pitchRatio = Math.pow(2, this.semitones / 12);
    if (this.workletNode) {
      // 키 0 / OFF 동안 워크릿은 페이드아웃 후 FFT 연산을 멈춘다 (CPU 절약).
      this.workletNode.port.postMessage({ pitchRatio, active: shifting, formant: this.preserveFormants });
      return;
    }
    if (!shifting || !this.delay1) return;
    const bufferTime = this.bufferTime;
    if (pitchRatio > 1.0) {
      const delayOffset = bufferTime * (pitchRatio - 1.0);
      this.ramp(this.delay1.delayTime, delayOffset);
      this.ramp(this.delay2.delayTime, delayOffset);
      this.ramp(this.modGain1.gain, -(pitchRatio - 1.0));
      this.ramp(this.modGain2.gain, -(pitchRatio - 1.0));
    } else {
      this.ramp(this.delay1.delayTime, 0);
      this.ramp(this.delay2.delayTime, 0);
      this.ramp(this.modGain1.gain, 1.0 - pitchRatio);
      this.ramp(this.modGain2.gain, 1.0 - pitchRatio);
    }
  }

  /** 반음 단위 키 설정 (-12 ~ +12) */
  setPitch(semitones) {
    const value = Math.round(Number(semitones));
    this.semitones = Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0;
    if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
    this.applyAll();
    if (this.onPitchChange) this.onPitchChange();
    return this.semitones;
  }

  /** 템포(재생 속도) 설정 (0.5x ~ 2.0x). 피치는 브라우저의 preservesPitch로 유지된다. */
  setTempo(tempo) {
    const value = Number(tempo);
    this.tempo = Number.isFinite(value) ? Math.max(0.5, Math.min(2.0, Math.round(value * 100) / 100)) : 1;
    if (this.videoElement && this.enabled) this.videoElement.playbackRate = this.tempo;
    return this.tempo;
  }

  /** 유튜브 자체 속도 메뉴로 바뀐 재생 속도를 상태에 반영 */
  handleRateChange() {
    if (!this.enabled || !this.videoElement) return;
    const rate = this.videoElement.playbackRate;
    if (Math.abs(rate - this.tempo) < 0.001) return;
    this.tempo = Math.round(rate * 100) / 100;
    if (this.onExternalChange) this.onExternalChange(this.getState());
  }

  /** 마스터 볼륨 (0.0 ~ 2.5x) */
  setVolume(vol) {
    const value = Number(vol);
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(2.5, Math.round(value * 100) / 100)) : 1;
    this.applyAll();
    return this.volume;
  }

  /** 보컬 제거 (가라오케 모드) */
  setVocalCut(enable) {
    this.vocalCutEnabled = !!enable;
    this.applyAll();
    return this.vocalCutEnabled;
  }

  /** 포먼트 유지: 키를 바꿔도 목소리 음색(다람쥐/굵은 목소리 현상 방지) */
  setPreserveFormants(enabled) {
    this.preserveFormants = !!enabled;
    if (this.workletNode) this.workletNode.port.postMessage({ formant: this.preserveFormants });
    return this.preserveFormants;
  }

  /** 마스터 ON/OFF: OFF면 원음 직결 + 재생 속도 1.0 */
  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.videoElement) this.videoElement.playbackRate = this.enabled ? this.tempo : 1.0;
    this.applyAll();
    return this.enabled;
  }

  /** 상태 리셋 (원키 0, 템포 1.0, 볼륨 100%, 보컬컷 OFF) */
  reset() {
    this.semitones = 0;
    this.volume = 1;
    this.vocalCutEnabled = false;
    this.setTempo(1.0);
    this.applyAll();
    if (this.onPitchChange) this.onPitchChange();
    return this.getState();
  }

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

window.__KaraokePitchShifter = window.__KaraokePitchShifter || new AudioPitchShifter();
