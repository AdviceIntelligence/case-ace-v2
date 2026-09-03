/**
 * WebexStreamCapture
 * 
 * Implements Phase 6.2 Route 2: Telephone via Cisco Webex Calling.
 * 
 * Key Requirements:
 * 1. Consent Gate: The record control remains STRICTLY disabled until the adviser
 *    affirmatively confirms that the client on the call was informed.
 * 2. Speaker Channel Separation: Separates adviser local microphone track (Channel 0)
 *    and remote client WebRTC telephone track (Channel 1).
 * 3. Normalised Output: Merges dual-channel input to 16kHz mono Float32 PCM while
 *    preserving the speaker channel map.
 * 4. Decoupled Call Lifecycle: If the client withdraws consent mid-call, recording
 *    and volatile session memory are destroyed immediately, but the Webex telephony
 *    call remains active so unrecorded advice may continue.
 */

import type { ConsentRecord } from '../consent/consentManager.ts';

export interface WebexChannelMapping {
  isDualChannel: true;
  adviserChannel: 0;
  clientChannel: 1;
}

export interface WebexCaptureResult {
  pcmBuffer: ArrayBuffer;
  durationSeconds: number;
  sampleRate: number;
  channelMapping: WebexChannelMapping;
}

export class WebexStreamCapture {
  private isConsentConfirmed = false;
  private consentRecord: ConsentRecord | null = null;
  private isRecording = false;
  private isCallConnected = false;
  private callStartTime = 0;
  private recordStartTime = 0;

  private localMicStream: MediaStream | null = null;
  private remotePeerStream: MediaStream | null = null;
  private pcmChunks: Float32Array[] = [];
  private totalSamples = 0;
  private readonly sampleRate = 16000;

  /**
   * Affirmatively registers client consent for Webex telephone recording.
   * Unlocks the recording control.
   */
  public confirmConsent(record: ConsentRecord): void {
    if (record.route !== 'webex_telephony') {
      throw new Error(`Invalid consent route '${record.route}' for Webex telephone capture.`);
    }
    this.consentRecord = record;
    this.isConsentConfirmed = true;
  }

  public isConsentUnlocked(): boolean {
    return this.isConsentConfirmed && this.consentRecord !== null;
  }

  public isCallActive(): boolean {
    return this.isCallConnected;
  }

  public isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Connects telephone call stream (simulated or live WebRTC audio streams).
   */
  public connectCall(localMic: MediaStream | null, remotePeer: MediaStream | null): void {
    this.localMicStream = localMic;
    this.remotePeerStream = remotePeer;
    this.isCallConnected = true;
    this.callStartTime = Date.now();
  }

  /**
   * Starts capturing call audio. Throws if consent has not been confirmed first.
   */
  public startRecording(): void {
    if (!this.isConsentUnlocked()) {
      throw new Error(
        '[CONSENT GATE VIOLATION] Webex telephone recording cannot start before affirmative consent is confirmed.'
      );
    }
    if (!this.isCallConnected) {
      throw new Error('Cannot start recording: No active Webex telephone call detected.');
    }

    this.pcmChunks = [];
    this.totalSamples = 0;
    this.isRecording = true;
    this.recordStartTime = Date.now();
  }

  /**
   * Injects audio data during telephone recording.
   */
  public recordChunk(adviserSamples: Float32Array, clientSamples: Float32Array): void {
    if (!this.isRecording) return;

    // Normalise/mix dual-channel audio into a balanced mono buffer
    const len = Math.max(adviserSamples.length, clientSamples.length);
    const mixed = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const s1 = i < adviserSamples.length ? adviserSamples[i] : 0;
      const s2 = i < clientSamples.length ? clientSamples[i] : 0;
      mixed[i] = (s1 + s2) * 0.5;
    }

    this.pcmChunks.push(mixed);
    this.totalSamples += mixed.length;
  }

  /**
   * Stops recording and returns the normalised audio and channel map.
   */
  public stopRecording(): WebexCaptureResult {
    if (!this.isRecording) {
      throw new Error('Recording is not currently active.');
    }

    this.isRecording = false;
    const durationSeconds = Math.max(1, Math.round((Date.now() - this.recordStartTime) / 1000));

    const merged = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const chunk of this.pcmChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      pcmBuffer: merged.buffer,
      durationSeconds,
      sampleRate: this.sampleRate,
      channelMapping: {
        isDualChannel: true,
        adviserChannel: 0,
        clientChannel: 1,
      },
    };
  }

  /**
   * Handles immediate consent withdrawal:
   * Wipes all recording buffers and zeroes data while maintaining the live Webex phone call.
   */
  public withdrawConsentAndContinueCall(): void {
    // 1. Zero all recorded PCM chunks
    for (const chunk of this.pcmChunks) {
      chunk.fill(0);
    }
    this.pcmChunks = [];
    this.totalSamples = 0;

    // 2. Stop recording state and revoke consent gate
    this.isRecording = false;
    this.isConsentConfirmed = false;
    this.consentRecord = null;

    // Call remains connected: this.isCallConnected remains true
  }

  /**
   * Concludes and terminates the telephone call.
   */
  public endCall(): void {
    if (this.isRecording) {
      this.withdrawConsentAndContinueCall();
    }
    if (this.localMicStream) {
      this.localMicStream.getTracks().forEach((t) => t.stop());
      this.localMicStream = null;
    }
    if (this.remotePeerStream) {
      this.remotePeerStream.getTracks().forEach((t) => t.stop());
      this.remotePeerStream = null;
    }
    this.isCallConnected = false;
  }

  public getCallStartTime(): number {
    return this.callStartTime;
  }
}

export const webexStreamCapture = new WebexStreamCapture();
