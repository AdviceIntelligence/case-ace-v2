/**
 * LiveAudioCapture
 * 
 * Implements Phase 6.2 Route 1: Live capture in the app for Case Ace v2.0.
 * 
 * Key Features:
 * - Direct Web Audio API / AudioWorklet capture downmixed to 16kHz mono Float32 PCM.
 * - Streams audio chunks exclusively to volatile memory (Constraint C1).
 * - Pause, resume, and stop controls.
 * - Real-time running duration and memory pressure monitoring.
 * - Periodic dominant speaker detection to alert when client voice is under-captured.
 * - Tab title animation and visibility synchronization.
 */

import { dominantSpeakerDetector, type DominantSpeakerAnalysis } from './dominantSpeakerDetector.ts';

export type CaptureState = 'idle' | 'recording' | 'paused' | 'stopped';
export type MemoryPressureLevel = 'normal' | 'moderate' | 'high_pressure' | 'limit_exceeded';

export interface LiveCaptureOptions {
  sampleRate?: number;
  maxDurationMinutes?: number;
  onStateChange?: (state: CaptureState) => void;
  onDurationUpdate?: (elapsedSeconds: number, formatted: string) => void;
  onMemoryPressure?: (level: MemoryPressureLevel, currentMb: number, message: string | null) => void;
  onDominantSpeakerAnalysis?: (analysis: DominantSpeakerAnalysis) => void;
}

/** How long to wait for the first samples before telling the adviser nothing is arriving. */
const SILENT_CAPTURE_GRACE_MS = 3000;

export class LiveAudioCapture {
  private state: CaptureState = 'idle';
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | AudioWorkletNode | null = null;
  private silentCaptureTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by the UI so a silent microphone surfaces to the adviser, not the console. */
  public onSilentCapture: ((message: string) => void) | null = null;

  private pcmChunks: Float32Array[] = [];
  private totalSamplesCaptured = 0;
  private startTime = 0;
  private pausedDurationMs = 0;
  private pauseStartTime = 0;
  private durationTimerId: any = null;
  private speakerAnalysisTimerId: any = null;

  private readonly sampleRate = 16000;
  private readonly maxDurationMinutes = 90;
  private readonly options: LiveCaptureOptions;

  private originalDocTitle = typeof document !== 'undefined' ? document.title : 'Case Ace';

  constructor(options: LiveCaptureOptions = {}) {
    this.options = {
      sampleRate: this.sampleRate,
      maxDurationMinutes: this.maxDurationMinutes,
      ...options,
    };
  }

  public getState(): CaptureState {
    return this.state;
  }

  public getElapsedSeconds(): number {
    if (this.state === 'idle') return 0;
    const now = this.state === 'paused' ? this.pauseStartTime : Date.now();
    return Math.max(0, Math.floor((now - this.startTime - this.pausedDurationMs) / 1000));
  }

  public getMemoryConsumptionMb(): number {
    // 4 bytes per sample (Float32)
    return Math.round(((this.totalSamplesCaptured * 4) / (1024 * 1024)) * 100) / 100;
  }

  /**
   * Starts live audio capture from the workstation microphone.
   */
  public async start(): Promise<void> {
    if (this.state === 'recording') return;

    try {
      this.pcmChunks = [];
      this.totalSamplesCaptured = 0;
      this.pausedDurationMs = 0;
      this.startTime = Date.now();

      // Request mono 16kHz microphone stream
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: this.sampleRate,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioCtx({ sampleRate: this.sampleRate });

        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
        
        // 4096 buffer size @ 16kHz = ~256ms per buffer callback
        const scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
          if (this.state !== 'recording') return;
          const inputData = event.inputBuffer.getChannelData(0);
          const chunk = new Float32Array(inputData.length);
          chunk.set(inputData);
          this.pcmChunks.push(chunk);
          this.totalSamplesCaptured += chunk.length;
        };

        this.sourceNode.connect(scriptProcessor);
        // A zero-gain sink keeps the processor pulling audio without routing the microphone
        // to the speakers, which caused feedback when the adviser was not on a headset.
        const silentSink = this.audioContext.createGain();
        silentSink.gain.value = 0;
        scriptProcessor.connect(silentSink);
        silentSink.connect(this.audioContext.destination);
        this.processorNode = scriptProcessor;

        // An AudioContext created after an await has lost the user-activation chain, so the
        // browser may start it suspended. In that state onaudioprocess never fires: the
        // microphone light comes on, the on-screen counter runs from the wall clock, and not
        // one sample is captured. This is the defect that made recordings silently empty.
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }
        if (this.audioContext.state !== 'running') {
          throw new Error(
            `The browser did not start audio capture (state: ${this.audioContext.state}). ` +
              'Nothing would be recorded, so recording has not begun.',
          );
        }
      }

      this.setState('recording');
      this.startTimers();
      this.updateTitle(true);
      this.startSilentCaptureWatchdog();
    } catch (err: any) {
      this.cleanup();
      throw new Error(`Microphone initialization failed: ${err.message || err}`);
    }
  }

  /**
   * Reports whether audio is actually arriving, as opposed to the clock running.
   * The UI must show this: an adviser cannot otherwise tell a working recording from a
   * broken one, which is exactly how an empty consultation reached a live pilot.
   */
  public getCapturedSampleCount(): number {
    return this.totalSamplesCaptured;
  }

  public isReceivingAudio(): boolean {
    return this.totalSamplesCaptured > 0;
  }

  /**
   * Fails loudly if no samples have arrived shortly after recording begins, rather than
   * letting the adviser talk for forty minutes into nothing.
   */
  private startSilentCaptureWatchdog(): void {
    this.clearSilentCaptureWatchdog();
    this.silentCaptureTimer = setTimeout(() => {
      if (this.state === 'recording' && this.totalSamplesCaptured === 0) {
        this.onSilentCapture?.(
          'No sound is reaching Case Ace. Check that the right microphone is selected and ' +
            'that the browser has permission, then start again.',
        );
      }
    }, SILENT_CAPTURE_GRACE_MS);
  }

  private clearSilentCaptureWatchdog(): void {
    if (this.silentCaptureTimer) {
      clearTimeout(this.silentCaptureTimer);
      this.silentCaptureTimer = null;
    }
  }

  public pause(): void {
    if (this.state !== 'recording') return;
    this.pauseStartTime = Date.now();
    this.setState('paused');
    this.updateTitle(false);
  }

  public resume(): void {
    if (this.state !== 'paused') return;
    this.pausedDurationMs += Date.now() - this.pauseStartTime;
    this.setState('recording');
    this.updateTitle(true);
  }

  /**
   * Stops live capture and returns the combined 16kHz mono Float32 PCM ArrayBuffer.
   */
  public stop(): { pcmBuffer: ArrayBuffer; durationSeconds: number; sampleRate: number } {
    const elapsedSeconds = this.getElapsedSeconds();
    this.setState('stopped');
    this.stopTimers();
    this.updateTitle(false);

    // Merge PCM chunks into a single ArrayBuffer
    const merged = new Float32Array(this.totalSamplesCaptured);
    let offset = 0;
    for (const chunk of this.pcmChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const result = {
      pcmBuffer: merged.buffer,
      durationSeconds: elapsedSeconds,
      sampleRate: this.sampleRate,
    };

    this.cleanup();
    return result;
  }

  /**
   * Immediately aborts and zeroes all captured chunks.
   */
  public abort(): void {
    for (const chunk of this.pcmChunks) {
      chunk.fill(0);
    }
    this.pcmChunks = [];
    this.totalSamplesCaptured = 0;
    this.setState('idle');
    this.stopTimers();
    this.updateTitle(false);
    this.cleanup();
  }

  /**
   * Injects mock PCM chunk for automated test suites.
   */
  public injectTestChunk(chunk: Float32Array): void {
    this.pcmChunks.push(chunk);
    this.totalSamplesCaptured += chunk.length;
  }

  private setState(state: CaptureState): void {
    this.state = state;
    this.options.onStateChange?.(state);
  }

  private startTimers(): void {
    this.stopTimers();

    this.durationTimerId = setInterval(() => {
      const elapsed = this.getElapsedSeconds();
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      this.options.onDurationUpdate?.(elapsed, formatted);

      this.checkMemoryPressure(mins);
    }, 1000);

    // Evaluate dominant speaker every 15 seconds
    this.speakerAnalysisTimerId = setInterval(() => {
      if (this.state === 'recording' && this.pcmChunks.length > 0) {
        const currentBuffer = this.getInterimPcmBuffer();
        const analysis = dominantSpeakerDetector.analyzePcmBuffer(currentBuffer, this.sampleRate);
        this.options.onDominantSpeakerAnalysis?.(analysis);
      }
    }, 15000);
  }

  private stopTimers(): void {
    if (this.durationTimerId) {
      clearInterval(this.durationTimerId);
      this.durationTimerId = null;
    }
    if (this.speakerAnalysisTimerId) {
      clearInterval(this.speakerAnalysisTimerId);
      this.speakerAnalysisTimerId = null;
    }
  }

  public evaluatePressureForBytes(bytes: number, durationSeconds: number): { level: MemoryPressureLevel; currentMb: number; message: string | null } {
    const elapsedMinutes = Math.floor(durationSeconds / 60);
    const currentMb = Math.round((bytes / (1024 * 1024)) * 100) / 100;
    let level: MemoryPressureLevel = 'normal';
    let message: string | null = null;

    if (elapsedMinutes >= this.maxDurationMinutes) {
      level = 'limit_exceeded';
      message = `Maximum consultation duration limit (${this.maxDurationMinutes} minutes) reached. Recording must be concluded.`;
    } else if (elapsedMinutes >= 60) {
      level = 'high_pressure';
      message = `High memory pressure: Consultation has exceeded 60 minutes (${elapsedMinutes}m / ${currentMb}MB). Consider completing advice interview before reaching 90m limit.`;
    } else if (elapsedMinutes >= 45) {
      level = 'moderate';
      message = `Extended interview duration (${elapsedMinutes}m exceeds 45 minutes). Volatile memory consumption: ${currentMb}MB.`;
    }

    this.options.onMemoryPressure?.(level, currentMb, message);
    return { level, currentMb, message };
  }

  private checkMemoryPressure(elapsedMinutes: number): void {
    const currentMb = this.getMemoryConsumptionMb();
    let level: MemoryPressureLevel = 'normal';
    let message: string | null = null;

    if (elapsedMinutes >= this.maxDurationMinutes) {
      level = 'limit_exceeded';
      message = `Maximum consultation duration limit (${this.maxDurationMinutes} minutes) reached. Recording must be concluded.`;
    } else if (elapsedMinutes >= 60) {
      level = 'high_pressure';
      message = `High memory pressure: Consultation has exceeded 60 minutes (${elapsedMinutes}m / ${currentMb}MB). Consider completing advice interview before reaching 90m limit.`;
    } else if (elapsedMinutes >= 45) {
      level = 'moderate';
      message = `Extended interview duration (${elapsedMinutes}m exceeds 45 minutes). Volatile memory consumption: ${currentMb}MB.`;
    }

    this.options.onMemoryPressure?.(level, currentMb, message);
  }

  private getInterimPcmBuffer(): ArrayBuffer {
    const merged = new Float32Array(this.totalSamplesCaptured);
    let offset = 0;
    for (const chunk of this.pcmChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged.buffer;
  }

  private updateTitle(isRecording: boolean): void {
    if (typeof document !== 'undefined') {
      if (isRecording) {
        document.title = `[● REC] Case Ace - Live Consultation`;
      } else {
        document.title = this.originalDocTitle;
      }
    }
  }

  private cleanup(): void {
    this.clearSilentCaptureWatchdog();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
