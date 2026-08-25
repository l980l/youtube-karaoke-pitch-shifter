/**
 * YouTube Karaoke Pitch Shifter Engine
 * Web Audio API 기반 실시간 키(Pitch) / 템포(Tempo) / 보컬컷(Vocal Cut) 제어기
 */

class AudioPitchShifter {
  constructor() {
    this.audioCtx = null;
    this.videoElement = null;
    this.sourceNode = null;
    
    // Master Gains & Limiter
    this.inputGain = null;
    this.outputGain = null;
    this.bypassGain = null;
    this.pitchGain = null;
    this.compressor = null;
    
    // Jungle Pitch Shifter Nodes
    this.delay1 = null;
    this.delay2 = null;
    this.delayGain1 = null;
    this.delayGain2 = null;
    this.mod1 = null;
    this.mod2 = null;
    this.fade1 = null;
    this.fade2 = null;
    this.modGain1 = null;
    this.modGain2 = null;
    
    // Vocal Cut (Center Channel Cancellation) Nodes
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
    this.semitones = 0; // -12 to +12
    this.tempo = 1.0; // 0.5 to 1.5
    this.volume = 1.0; // 0.0 to 2.5
    this.isInitialized = false;
    this.isConnected = false;
    this.bufferTime = 0.060; // 60ms buffer (최적의 노래방 음질 및 제로 레이턴시)
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

      this.setupAudioGraph();
      this.isInitialized = true;
      this.isConnected = true;

      // 초기 설정값 적용
      this.setPitch(this.semitones);
      this.setVolume(this.volume);
      this.setTempo(this.tempo);
      this.setVocalCut(this.vocalCutEnabled);

      console.log('[Karaoke Shifter] Web Audio Graph Initialized Successfully');
      return true;
    } catch (err) {
      console.error('[Karaoke Shifter] Init failed:', err);
      return false;
    }
  }

  /**
   * Web Audio DSP 그래프 구성
   */
  setupAudioGraph() {
    const ctx = this.audioCtx;

    // 1. Master Gains & Transparent Dynamics Compressor (일정한 음량 유지)
    this.inputGain = ctx.createGain();
    this.outputGain = ctx.createGain();
    this.bypassGain = ctx.createGain();
    this.pitchGain = ctx.createGain();

    // 소프트 리미터 / 컴프레서 (키 변경 시 음량 튐 및 왜곡 방지)
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-6, ctx.currentTime);
    this.compressor.knee.setValueAtTime(12, ctx.currentTime);
    this.compressor.ratio.setValueAtTime(4, ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    this.compressor.release.setValueAtTime(0.15, ctx.currentTime);

    // Source -> Input Gain
    this.sourceNode.connect(this.inputGain);

    // 2. Vocal Cut (Center Cancellation) 서브그래프
    this.setupVocalCutGraph();

    // 3. Pitch Shifter (Jungle Engine) 서브그래프
    this.setupJungleGraph();

    // 4. Sum -> Compressor -> Master Output -> Destination
    this.bypassGain.connect(this.compressor);
    this.pitchGain.connect(this.compressor);
    this.compressor.connect(this.outputGain);
    this.outputGain.connect(ctx.destination);
  }

  /**
   * 보컬 제거 (가라오케 모드) 그래프 설정
   * 스테레오 채널 분리 후 위상 반전 및 저음(140Hz 이하) 보존 믹싱
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
    this.inverterNode.gain.value = -1; // 위상 반전

    // 저음 보존용 로우패스 필터 (베이스/드럼 보존)
    this.bassFilterNode = ctx.createBiquadFilter();
    this.bassFilterNode.type = 'lowpass';
    this.bassFilterNode.frequency.value = 140;

    const leftGain = ctx.createGain();

    this.inputGain.connect(this.vocalProcessingIn);
    this.vocalProcessingIn.connect(this.splitterNode);

    // (L - R) mono difference
    this.splitterNode.connect(leftGain, 0);
    this.splitterNode.connect(this.inverterNode, 1);
    this.inverterNode.connect(leftGain);

    // Feed to both L and R channels
    leftGain.connect(this.mergerNode, 0, 0);
    leftGain.connect(this.mergerNode, 0, 1);

    // Add bass back into merger
    this.vocalProcessingIn.connect(this.bassFilterNode);
    this.bassFilterNode.connect(this.mergerNode, 0, 0);
    this.bassFilterNode.connect(this.mergerNode, 0, 1);

    this.mergerNode.connect(this.vocalCutGain);
    this.vocalCutGain.connect(this.vocalProcessingOut);

    // 초기 상태: Direct 활성화, VocalCut 비활성화
    this.directPassGain.gain.value = 1.0;
    this.vocalCutGain.gain.value = 0.0;
    this.vocalProcessingIn.gain.value = 0.0;
  }

  /**
   * Jungle Time-domain Pitch Shifter 모듈
   * Hann 윈도우 기반 크로스페이드로 볼륨 균일 유지 (Equal Loudness)
   */
  setupJungleGraph() {
    const ctx = this.audioCtx;
    const bufferTime = this.bufferTime;

    // Delays (최대 1초까지 버퍼링)
    this.delay1 = ctx.createDelay(1.0);
    this.delay2 = ctx.createDelay(1.0);
    this.delayGain1 = ctx.createGain();
    this.delayGain2 = ctx.createGain();

    // Modulation LFO buffer creation
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(bufferTime * sampleRate);
    const modBuffer1 = ctx.createBuffer(1, length, sampleRate);
    const modBuffer2 = ctx.createBuffer(1, length, sampleRate);
    const fadeBuffer1 = ctx.createBuffer(1, length, sampleRate);
    const fadeBuffer2 = ctx.createBuffer(1, length, sampleRate);

    const channel1 = modBuffer1.getChannelData(0);
    const channel2 = modBuffer2.getChannelData(0);
    const fadeChan1 = fadeBuffer1.getChannelData(0);
    const fadeChan2 = fadeBuffer2.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / length; // 0 to 1
      channel1[i] = t * bufferTime;
      channel2[i] = ((t + 0.5) % 1.0) * bufferTime;

      // Hann Window: 0.5 * (1 - cos(2*pi*t))
      // Hann 윈도우는 두 페이즈의 합(fade1 + fade2)이 모든 구간에서 정확히 1.0으로 일정하게 유지됩니다!
      fadeChan1[i] = 0.5 * (1.0 - Math.cos(2.0 * Math.PI * t));
      fadeChan2[i] = 0.5 * (1.0 - Math.cos(2.0 * Math.PI * ((t + 0.5) % 1.0)));
    }

    // Modulators (AudioBufferSourceNode loop)
    this.mod1 = ctx.createBufferSource();
    this.mod2 = ctx.createBufferSource();
    this.fade1 = ctx.createBufferSource();
    this.fade2 = ctx.createBufferSource();

    this.mod1.buffer = modBuffer1;
    this.mod2.buffer = modBuffer2;
    this.fade1.buffer = fadeBuffer1;
    this.fade2.buffer = fadeBuffer2;

    this.mod1.loop = true;
    this.mod2.loop = true;
    this.fade1.loop = true;
    this.fade2.loop = true;

    this.modGain1 = ctx.createGain();
    this.modGain2 = ctx.createGain();

    this.mod1.connect(this.modGain1);
    this.mod2.connect(this.modGain2);

    this.modGain1.connect(this.delay1.delayTime);
    this.modGain2.connect(this.delay2.delayTime);

    this.fade1.connect(this.delayGain1.gain);
    this.fade2.connect(this.delayGain2.gain);

    // Wire audio input to delays
    this.vocalProcessingOut.connect(this.delay1);
    this.vocalProcessingOut.connect(this.delay2);

    this.delay1.connect(this.delayGain1);
    this.delay2.connect(this.delayGain2);

    // Sum delay outputs to pitchGain
    this.delayGain1.connect(this.pitchGain);
    this.delayGain2.connect(this.pitchGain);

    // Direct Bypass path
    this.vocalProcessingOut.connect(this.bypassGain);

    // Start modulators
    this.mod1.start(0);
    this.mod2.start(0);
    this.fade1.start(0);
    this.fade2.start(0);

    this.updatePitchInternal(1.0);
  }

  /**
   * 반음 단위 키(Pitch) 설정 (-12 ~ +12)
   * semitones: 0 = 원키, +1 = 반음 올림, -1 = 반음 내림
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
   * 피치 LFO 모듈레이터 내부 파라미터 갱신
   * 키 올리기(pitchRatio > 1) 및 키 내리기(pitchRatio < 1) 모두 음수 딜레이 없이 완벽 지원
   */
  updatePitchInternal(pitchRatio) {
    if (!this.isInitialized || !this.audioCtx) return;

    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const smoothTime = 0.03; // 30ms 빠른 반응성
    const bufferTime = this.bufferTime;

    if (this.semitones === 0) {
      // Bypass Mode: 100% 원음 직결 (음질 손실 0%)
      this.bypassGain.gain.cancelScheduledValues(now);
      this.pitchGain.gain.cancelScheduledValues(now);
      this.bypassGain.gain.setTargetAtTime(1.0, now, smoothTime);
      this.pitchGain.gain.setTargetAtTime(0.0, now, smoothTime);
    } else {
      // Pitch Shifting Mode
      this.bypassGain.gain.cancelScheduledValues(now);
      this.pitchGain.gain.cancelScheduledValues(now);
      this.bypassGain.gain.setTargetAtTime(0.0, now, smoothTime);
      this.pitchGain.gain.setTargetAtTime(1.0, now, smoothTime);

      if (pitchRatio > 1.0) {
        // [키 올리기 (Pitch Up)]
        // delayTime 오프셋을 양수로 두고, 모듈레이션 게인을 음수로 설정하여
        // 딜레이가 (bufferTime * (pitchRatio - 1.0)) 에서 0으로 하강하도록 처리 (음수 지연 클리핑 방지)
        const delayOffset = bufferTime * (pitchRatio - 1.0);
        const speed = -(pitchRatio - 1.0); // 1.0 - pitchRatio

        this.delay1.delayTime.cancelScheduledValues(now);
        this.delay2.delayTime.cancelScheduledValues(now);
        this.delay1.delayTime.setTargetAtTime(delayOffset, now, smoothTime);
        this.delay2.delayTime.setTargetAtTime(delayOffset, now, smoothTime);

        this.modGain1.gain.cancelScheduledValues(now);
        this.modGain2.gain.cancelScheduledValues(now);
        this.modGain1.gain.setTargetAtTime(speed, now, smoothTime);
        this.modGain2.gain.setTargetAtTime(speed, now, smoothTime);
      } else {
        // [키 내리기 (Pitch Down)]
        // delayTime 기본값 0, 모듈레이션 게인 (1.0 - pitchRatio)으로 0에서 위로 상승
        const speed = 1.0 - pitchRatio; // 양수

        this.delay1.delayTime.cancelScheduledValues(now);
        this.delay2.delayTime.cancelScheduledValues(now);
        this.delay1.delayTime.setTargetAtTime(0.0, now, smoothTime);
        this.delay2.delayTime.setTargetAtTime(0.0, now, smoothTime);

        this.modGain1.gain.cancelScheduledValues(now);
        this.modGain2.gain.cancelScheduledValues(now);
        this.modGain1.gain.setTargetAtTime(speed, now, smoothTime);
        this.modGain2.gain.setTargetAtTime(speed, now, smoothTime);
      }
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
