/**
 * SoundTouchJS - High-Quality Audio Pitch Shifting and Time Stretching Engine
 * Synchronized Overlap-Add (SOLA) algorithm for artifact-free, clean audio processing.
 */

(function (global) {
  'use strict';

  // --- FifoSampleBuffer ---
  function FifoSampleBuffer(numChannels) {
    this.numChannels = numChannels || 2;
    this.capacity = 0;
    this.sampleBuffer = new Float32Array(0);
    this.bufferStartIndex = 0;
    this.bufferEndIndex = 0;
    this.ensureCapacity(1024);
  }

  FifoSampleBuffer.prototype.ensureCapacity = function (capacityRequirement) {
    if (this.capacity < capacityRequirement) {
      var newCapacity = Math.max(capacityRequirement, this.capacity * 2 || 1024);
      var newBuffer = new Float32Array(newCapacity * this.numChannels);
      if (this.sampleBuffer && this.sampleBuffer.length > 0) {
        newBuffer.set(this.sampleBuffer.subarray(0, this.bufferEndIndex * this.numChannels));
      }
      this.sampleBuffer = newBuffer;
      this.capacity = newCapacity;
    }
  };

  FifoSampleBuffer.prototype.putSamples = function (samples, position, numSamples) {
    if (!numSamples) return;
    var start = position || 0;
    var count = numSamples;
    this.ensureCapacity(this.bufferEndIndex + count);
    var offset = this.bufferEndIndex * this.numChannels;
    var length = count * this.numChannels;
    this.sampleBuffer.set(samples.subarray(start * this.numChannels, (start + count) * this.numChannels), offset);
    this.bufferEndIndex += count;
  };

  FifoSampleBuffer.prototype.receiveSamples = function (outputBuffer, maxSamples) {
    var available = this.frameCount;
    var count = Math.min(available, maxSamples);
    if (count <= 0) return 0;
    var total = count * this.numChannels;
    outputBuffer.set(this.sampleBuffer.subarray(0, total));
    this.bufferEndIndex -= count;
    if (this.bufferEndIndex > 0) {
      this.sampleBuffer.copyWithin(0, total, (this.bufferEndIndex + count) * this.numChannels);
    }
    return count;
  };

  FifoSampleBuffer.prototype.clear = function () {
    this.bufferEndIndex = 0;
  };

  Object.defineProperty(FifoSampleBuffer.prototype, 'frameCount', {
    get: function () {
      return this.bufferEndIndex;
    }
  });

  // --- RateTransposer ---
  function RateTransposer(numChannels) {
    this.numChannels = numChannels || 2;
    this.rate = 1.0;
    this.outputBuffer = new FifoSampleBuffer(this.numChannels);
    this.slopeCount = 0;
    this.prevSample = new Float32Array(this.numChannels);
  }

  RateTransposer.prototype.setRate = function (r) {
    this.rate = Math.max(0.2, Math.min(5.0, r));
  };

  RateTransposer.prototype.process = function (inputBuffer) {
    var count = inputBuffer.frameCount;
    if (count <= 0) return;

    var numChannels = this.numChannels;
    var inSamples = inputBuffer.sampleBuffer;
    var rate = this.rate;

    if (Math.abs(rate - 1.0) < 1e-4) {
      // 1.0x rate pass-through
      this.outputBuffer.putSamples(inSamples, 0, count);
      inputBuffer.receiveSamples(new Float32Array(count * numChannels), count);
      return;
    }

    var maxOut = Math.ceil(count / rate) + 4;
    var outTemp = new Float32Array(maxOut * numChannels);
    var outIdx = 0;
    var inIdx = 0;
    var slope = this.slopeCount;

    while (inIdx < count) {
      while (slope >= 1.0) {
        slope -= 1.0;
        inIdx++;
        if (inIdx >= count) break;
      }
      if (inIdx >= count) break;

      var i0 = (inIdx === 0) ? this.prevSample : inSamples.subarray((inIdx - 1) * numChannels, inIdx * numChannels);
      var i1 = inSamples.subarray(inIdx * numChannels, (inIdx + 1) * numChannels);

      for (var c = 0; c < numChannels; c++) {
        var s0 = (inIdx === 0) ? this.prevSample[c] : inSamples[(inIdx - 1) * numChannels + c];
        var s1 = inSamples[inIdx * numChannels + c];
        outTemp[outIdx * numChannels + c] = s0 + (s1 - s0) * slope;
      }
      outIdx++;
      slope += rate;
    }

    if (count > 0) {
      for (var c = 0; c < numChannels; c++) {
        this.prevSample[c] = inSamples[(count - 1) * numChannels + c];
      }
    }

    this.slopeCount = slope;
    this.outputBuffer.putSamples(outTemp, 0, outIdx);
    inputBuffer.receiveSamples(new Float32Array(count * numChannels), count);
  };

  // --- TDStretch (Time Domain Stretch - SOLA) ---
  function TDStretch(numChannels) {
    this.numChannels = numChannels || 2;
    this.inputBuffer = new FifoSampleBuffer(this.numChannels);
    this.outputBuffer = new FifoSampleBuffer(this.numChannels);
    this.tempo = 1.0;
    this.sampleRate = 44100;
    this.overlapLength = 128; // ~3ms
    this.seekWindowLength = 512; // ~12ms
    this.seekLength = 0;
    this.overlapBuffer = new Float32Array(this.overlapLength * this.numChannels);
    this.bMidBuffer = false;
    this.setParameters(44100, 20, 8, 30);
  }

  TDStretch.prototype.setParameters = function (sampleRate, sequenceMs, seekWindowMs, overlapMs) {
    this.sampleRate = sampleRate || 44100;
    this.overlapLength = Math.floor(this.sampleRate * (overlapMs || 8) / 1000);
    this.seekWindowLength = Math.floor(this.sampleRate * (seekWindowMs || 15) / 1000);
    this.seekLength = Math.floor(this.sampleRate * (sequenceMs || 25) / 1000);
    this.overlapBuffer = new Float32Array(this.overlapLength * this.numChannels);
  };

  TDStretch.prototype.setTempo = function (t) {
    this.tempo = Math.max(0.2, Math.min(5.0, t));
  };

  TDStretch.prototype.overlap = function (outBuffer, outOffset, inBuffer, inOffset) {
    var numChannels = this.numChannels;
    var len = this.overlapLength;
    var overlapBuf = this.overlapBuffer;

    for (var i = 0; i < len; i++) {
      var fi = i / len; // 0 to 1
      var fOut = 1.0 - fi;
      var fIn = fi;

      for (var c = 0; c < numChannels; c++) {
        var sOut = overlapBuf[i * numChannels + c];
        var sIn = inBuffer[(inOffset + i) * numChannels + c];
        outBuffer[(outOffset + i) * numChannels + c] = sOut * fOut + sIn * fIn;
      }
    }
  };

  TDStretch.prototype.calculateCrossCorrelation = function (samples, offset) {
    var numChannels = this.numChannels;
    var len = this.overlapLength;
    var overlapBuf = this.overlapBuffer;
    var corr = 0;

    for (var i = 0; i < len; i += 2) {
      for (var c = 0; c < numChannels; c++) {
        corr += overlapBuf[i * numChannels + c] * samples[(offset + i) * numChannels + c];
      }
    }
    return corr;
  };

  TDStretch.prototype.seekBestOverlapPosition = function (samples) {
    var bestPos = 0;
    var bestCorr = -Infinity;
    var maxSeek = Math.min(this.seekWindowLength, this.inputBuffer.frameCount - this.overlapLength);

    for (var i = 0; i < maxSeek; i += 4) {
      var corr = this.calculateCrossCorrelation(samples, i);
      if (corr > bestCorr) {
        bestCorr = corr;
        bestPos = i;
      }
    }
    return bestPos;
  };

  TDStretch.prototype.process = function () {
    var reqSamples = this.overlapLength + this.seekWindowLength + this.seekLength;
    var numChannels = this.numChannels;

    while (this.inputBuffer.frameCount >= reqSamples) {
      var inSamples = this.inputBuffer.sampleBuffer;
      var bestOffset = 0;

      if (this.bMidBuffer) {
        bestOffset = this.seekBestOverlapPosition(inSamples);
      }

      // Overlap-add
      var tempOut = new Float32Array((this.overlapLength + this.seekLength) * numChannels);
      if (this.bMidBuffer) {
        this.overlap(tempOut, 0, inSamples, bestOffset);
      } else {
        tempOut.set(inSamples.subarray(bestOffset * numChannels, (bestOffset + this.overlapLength) * numChannels), 0);
      }

      // Copy non-overlapped body
      var bodyLen = this.seekLength;
      var bodyStart = bestOffset + this.overlapLength;
      tempOut.set(inSamples.subarray(bodyStart * numChannels, (bodyStart + bodyLen) * numChannels), this.overlapLength * numChannels);

      // Save tail for next overlap
      var tailStart = bodyStart + bodyLen;
      this.overlapBuffer.set(inSamples.subarray(tailStart * numChannels, (tailStart + this.overlapLength) * numChannels), 0);
      this.bMidBuffer = true;

      this.outputBuffer.putSamples(tempOut, 0, this.overlapLength + bodyLen);

      // Step forward by (seekLength * tempo)
      var skip = Math.floor(bodyLen * this.tempo) + bestOffset;
      var dummy = new Float32Array(skip * numChannels);
      this.inputBuffer.receiveSamples(dummy, skip);
    }
  };

  // --- SoundTouch Master Wrapper ---
  function SoundTouch(numChannels) {
    this.numChannels = numChannels || 2;
    this.rateTransposer = new RateTransposer(this.numChannels);
    this.tdStretch = new TDStretch(this.numChannels);
    this.pitch = 1.0;
    this.tempo = 1.0;
    this.rate = 1.0;
  }

  SoundTouch.prototype.setPitch = function (p) {
    this.pitch = Math.max(0.2, Math.min(5.0, p));
    this.updateRates();
  };

  SoundTouch.prototype.setTempo = function (t) {
    this.tempo = Math.max(0.2, Math.min(5.0, t));
    this.updateRates();
  };

  SoundTouch.prototype.setRate = function (r) {
    this.rate = Math.max(0.2, Math.min(5.0, r));
    this.updateRates();
  };

  SoundTouch.prototype.updateRates = function () {
    // SoundTouch pitch shift principle:
    // Pitch shift by p = RateTranspose by p + TDStretch by (1 / p)
    this.rateTransposer.setRate(this.rate * this.pitch);
    this.tdStretch.setTempo(this.tempo / this.pitch);
  };

  SoundTouch.prototype.putSamples = function (samples, position, numSamples) {
    this.tdStretch.inputBuffer.putSamples(samples, position, numSamples);
    this.tdStretch.process();
    this.rateTransposer.process(this.tdStretch.outputBuffer);
  };

  SoundTouch.prototype.receiveSamples = function (outputBuffer, maxSamples) {
    return this.rateTransposer.outputBuffer.receiveSamples(outputBuffer, maxSamples);
  };

  SoundTouch.prototype.clear = function () {
    this.rateTransposer.outputBuffer.clear();
    this.tdStretch.inputBuffer.clear();
    this.tdStretch.outputBuffer.clear();
    this.tdStretch.bMidBuffer = false;
  };

  // Export to global
  global.SoundTouch = SoundTouch;
  global.FifoSampleBuffer = FifoSampleBuffer;

})(typeof window !== 'undefined' ? window : this);
