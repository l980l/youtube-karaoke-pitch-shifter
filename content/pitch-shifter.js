/**
 * YouTube Karaoke Pitch Shifter Engine
 * SoundTouch (SOLA - Synchronized Overlap-Add) 초고음질 무잡음 피치 시프터
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
    
    // SoundTouch Processor
    this.soundTouch = null;
    this.processorNode = null;
    this.bufferSize = 2048; // 2048 samples (~46ms latency, perfect balance for real-time DSP)
    this.interleavedIn = null;
    this.interleavedOut = null;
    
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
    this.enabled = true; // 마스터 활성화 여부
    this.semitones = 0; // -12 to +12
    this.tempo = 1.0; // 0.5 to 1.5
    this.volume = 1.0; // 0.0 to 2.5
    this.isInitialized = false;
    this.isConnected = false;
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

      console.log('[Karaoke Shifter] High-Quality SoundTouch DSP Graph Initialized Successfully');
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

    // 1. Master Gains & Transparent Dynamics Compressor
    this.inputGain = ctx.createGain();
    this.outputGain = ctx.createGain();
    this.bypassGain = ctx.createGain();
    this.pitchGain = ctx.createGain();

    // 소프트 리미터 / 컴프레서 (볼륨 균일 유지)
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

    // 3. SoundTouch SOLA Pitch Shifter 서브그래프
    this.setupSoundTouchGraph();

    // 4. Sum -> Compressor -> Master Output -> Destination
    this.bypassGain.connect(this.compressor);
    this.pitchGain.connect(this.compressor);
    this.compressor.connect(this.outputGain);
    this.outputGain.connect(ctx.destination);
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
    this.inverterNode.gain.value = -1; // 위상 반전

    // 저음 보존용 로우패스 필터
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

    leftGain.connect(this.mergerNode, 0, 0);
    leftGain.connect(this.mergerNode, 0, 1);

    // Add bass back into merger
    this.vocalProcessingIn.connect(this.bassFilterNode);
    this.bassFilterNode.connect(this.mergerNode, 0, 0);
    this.bassFilterNode.connect(this.mergerNode, 0, 1);

    this.mergerNode.connect(this.vocalCutGain);
    this.vocalCutGain.connect(this.vocalProcessingOut);

    // 초기 상태
    this.directPassGain.gain.value = 1.0;
    this.vocalCutGain.gain.value = 0.0;
    this.vocalProcessingIn.gain.value = 0.0;
  }

  /**
   * SoundTouch SOLA 피치 시프터 모듈 설정
   * 글리치/클릭 잡음이 없는 초고음질 실시간 오버랩-애드 DSP
   */
  setupSoundTouchGraph() {
    const ctx = this.audioCtx;
    const SoundTouchClass = window.SoundTouch || globalThis.SoundTouch;

    if (!SoundTouchClass) {
      console.error('[Karaoke Shifter] SoundTouch class not found!');
      return;
    }

    this.soundTouch = new SoundTouchClass(2);
    this.soundTouch.setPitch(1.0);
    this.soundTouch.setTempo(1.0);

    const bufferSize = this.bufferSize;
    this.interleavedIn = new Float32Array(bufferSize * 2);
    this.interleavedOut = new Float32Array(bufferSize * 2);

    // Create ScriptProcessorNode
    this.processorNode = ctx.createScriptProcessor(bufferSize, 2, 2);

    this.processorNode.onaudioprocess = (e) => {
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.getChannelData(1);
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);

      // Bypass 모드(원키 0 or 비활성화)일 때는 빠른 복사
      if (this.semitones === 0 || !this.enabled) {
        outL.set(inL);
        outR.set(inR);
        return;
      }

      // Interleave input
      const inArr = this.interleavedIn;
      for (let i = 0; i < bufferSize; i++) {
        inArr[i * 2] = inL[i];
        inArr[i * 2 + 1] = inR[i];
      }

      // SoundTouch SOLA process
      this.soundTouch.putSamples(inArr, 0, bufferSize);
      const received = this.soundTouch.receiveSamples(this.interleavedOut, bufferSize);

      // De-interleave output
      const outArr = this.interleavedOut;
      for (let i = 0; i < received; i++) {
        outL[i] = outArr[i * 2];
        outR[i] = outArr[i * 2 + 1];
      }

      // Zero-fill remaining buffer
      for (let i = received; i < bufferSize; i++) {
        outL[i] = 0;
        outR[i] = 0;
      }
    };

    // Direct Bypass path
    this.vocalProcessingOut.connect(this.bypassGain);

    // SoundTouch Processing path
    this.vocalProcessingOut.connect(this.processorNode);
    this.processorNode.connect(this.pitchGain);

    this.updatePitchInternal(1.0);
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
   * 피치 내부 파라미터 갱신 (Bypass vs SoundTouch)
   */
  updatePitchInternal(pitchRatio) {
    if (!this.isInitialized || !this.audioCtx) return;

    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const smoothTime = 0.03;

    if (this.soundTouch) {
      this.soundTouch.setPitch(pitchRatio);
    }

    if (this.semitones === 0 || !this.enabled) {
      // Bypass Mode: 100% 원음 직결 (음질 손실 0%)
      this.bypassGain.gain.cancelScheduledValues(now);
      this.pitchGain.gain.cancelScheduledValues(now);
      this.bypassGain.gain.setTargetAtTime(1.0, now, smoothTime);
      this.pitchGain.gain.setTargetAtTime(0.0, now, smoothTime);
      if (this.soundTouch) {
        this.soundTouch.clear();
      }
    } else {
      // SoundTouch SOLA Pitch Shifting Mode
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
      // OFF: 완전 바이패스 모드 (원음 100% 직결 및 원래 속도 복구)
      this.bypassGain.gain.setTargetAtTime(1.0, now, smooth);
      this.pitchGain.gain.setTargetAtTime(0.0, now, smooth);
      this.directPassGain.gain.setTargetAtTime(1.0, now, smooth);
      this.vocalCutGain.gain.setTargetAtTime(0.0, now, smooth);
      if (this.videoElement) {
        this.videoElement.playbackRate = 1.0;
      }
    } else {
      // ON: 현재 피치, 템포, 보컬컷 설정 복구
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
