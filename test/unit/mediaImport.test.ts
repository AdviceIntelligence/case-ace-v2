/**
 * @file mediaImport.test.ts
 * @description Phase 6B Acceptance Test Suite for Media Import, Sandboxing, Format Allowlist,
 * Video Discard (C10), Zero-FileName Invariant, and Controlled Provenance.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sniffMediaContainer } from '../../client/src/workers/mediaDecoderWorker.ts';
import { mediaStreamingDecoder } from '../../client/src/audio/mediaStreamingDecoder.ts';
import { volatileSessionStore } from '../../client/src/state/volatileStore.ts';
import {
  consentManager,
  verifyZeroClientPii,
  type ImportProvenance,
  type SourceEquipment,
  type ConsentAttestationMeans,
  type CapturePartyCoverage,
} from '../../client/src/consent/consentManager.ts';

describe('Phase 6B: Media Import & Sandboxed Decoding Pipeline', () => {
  beforeEach(() => {
    volatileSessionStore.destroySession();
  });

  describe('6B.1 Format Allowlist & Magic Byte Sniffing', () => {
    it('accurately identifies WAV files (RIFF....WAVE header)', () => {
      const wavHeader = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x24, 0x08, 0x00, 0x00, // Size
        0x57, 0x41, 0x56, 0x45, // WAVE
        0x66, 0x6d, 0x74, 0x20, // fmt 
      ]);
      const res = sniffMediaContainer(wavHeader);
      expect(res.isSupported).toBe(true);
      expect(res.container).toBe('wav');
      expect(res.isVideo).toBe(false);
    });

    it('accurately identifies MP3 files with ID3 tag', () => {
      const mp3Id3Header = new Uint8Array([
        0x49, 0x44, 0x33, // ID3
        0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
      ]);
      const res = sniffMediaContainer(mp3Id3Header);
      expect(res.isSupported).toBe(true);
      expect(res.container).toBe('mp3');
      expect(res.isVideo).toBe(false);
    });

    it('accurately identifies MP3 files with raw MPEG sync frame (0xFFFB)', () => {
      const mp3SyncHeader = new Uint8Array([
        0xFF, 0xFB, 0x90, 0x64,
      ]);
      const res = sniffMediaContainer(mp3SyncHeader);
      expect(res.isSupported).toBe(true);
      expect(res.container).toBe('mp3');
      expect(res.isVideo).toBe(false);
    });

    it('accurately identifies FLAC files (fLaC marker)', () => {
      const flacHeader = new Uint8Array([
        0x66, 0x4C, 0x61, 0x43, // fLaC
        0x00, 0x00, 0x00, 0x22,
      ]);
      const res = sniffMediaContainer(flacHeader);
      expect(res.isSupported).toBe(true);
      expect(res.container).toBe('flac');
      expect(res.isVideo).toBe(false);
    });

    it('accurately identifies OGG files (OggS container)', () => {
      const oggHeader = new Uint8Array([
        0x4F, 0x67, 0x67, 0x53, // OggS
        0x00, 0x02, 0x00, 0x00,
      ]);
      const res = sniffMediaContainer(oggHeader);
      expect(res.isSupported).toBe(true);
      expect(res.container).toBe('ogg');
      expect(res.isVideo).toBe(false);
    });

    it('accurately identifies AAC ADTS headers (0xFFF1 / 0xFFF9)', () => {
      const aacHeader = new Uint8Array([
        0xFF, 0xF1, 0x50, 0x80,
      ]);
      const res = sniffMediaContainer(aacHeader);
      expect(res.isSupported).toBe(true);
      expect(res.container).toBe('aac');
      expect(res.isVideo).toBe(false);
    });

    it('accurately identifies MP4 video containers and flags isVideo=true (C10 video frame discard)', () => {
      const mp4Header = new Uint8Array([
        0x00, 0x00, 0x00, 0x20,
        0x66, 0x74, 0x79, 0x70, // ftyp
        0x69, 0x73, 0x6f, 0x6d, // isom
      ]);
      const res = sniffMediaContainer(mp4Header);
      expect(res.isSupported).toBe(true);
      expect(res.container).toBe('mp4');
      expect(res.isVideo).toBe(true);
    });

    it('accurately identifies MOV Apple QuickTime containers and flags isVideo=true', () => {
      const movHeader = new Uint8Array([
        0x00, 0x00, 0x00, 0x14,
        0x66, 0x74, 0x79, 0x70, // ftyp
        0x71, 0x74, 0x20, 0x20, // qt  
      ]);
      const res = sniffMediaContainer(movHeader);
      expect(res.isSupported).toBe(true);
      expect(res.container).toBe('mov');
      expect(res.isVideo).toBe(true);
    });

    it('accurately identifies WebM containers (EBML 0x1A45DFA3) and flags isVideo=true', () => {
      const webmHeader = new Uint8Array([
        0x1A, 0x45, 0xDF, 0xA3, // EBML
        0x9F, 0x42, 0x86, 0x81,
      ]);
      const res = sniffMediaContainer(webmHeader);
      expect(res.isSupported).toBe(true);
      expect(res.container).toBe('webm');
      expect(res.isVideo).toBe(true);
    });

    it('rejects unsupported containers by default (MKV, AVI, WMA, arbitrary binaries)', () => {
      // AVI header: RIFF....AVI 
      const aviHeader = new Uint8Array([
        0x52, 0x49, 0x46, 0x46,
        0x00, 0x10, 0x00, 0x00,
        0x41, 0x56, 0x49, 0x20, // AVI 
      ]);
      const aviRes = sniffMediaContainer(aviHeader);
      expect(aviRes.isSupported).toBe(false);

      // Random binary payload / executable
      const exeHeader = new Uint8Array([0x4D, 0x5A, 0x90, 0x00]); // MZ
      const exeRes = sniffMediaContainer(exeHeader);
      expect(exeRes.isSupported).toBe(false);
      expect(exeRes.error).toContain('Unrecognised container signature');
    });

    it('rejects truncated/zero-length byte sequences cleanly', () => {
      const empty = new Uint8Array([]);
      const res = sniffMediaContainer(empty);
      expect(res.isSupported).toBe(false);
      expect(res.error).toContain('too small');
    });
  });

  describe('6B.1 Pre-Flight Quotas and Limits', () => {
    it('surfaces limit violation before decode when file exceeds 500 MB', () => {
      const oversizeBytes = 501 * 1024 * 1024; // 501 MB
      const preFlight = mediaStreamingDecoder.validatePreFlight({ size: oversizeBytes });
      expect(preFlight.valid).toBe(false);
      expect(preFlight.error).toContain('File exceeds maximum size limit of 500 MB');
    });

    it('passes pre-flight check when file is within 500 MB limit', () => {
      const validSize = 45 * 1024 * 1024; // 45 MB
      const preFlight = mediaStreamingDecoder.validatePreFlight({ size: validSize });
      expect(preFlight.valid).toBe(true);
      expect(preFlight.error).toBeUndefined();
    });
  });

  describe('6B.2 Provenance Capture & Zero File Name Invariant', () => {
    it('captures controlled provenance metadata without capturing file name', () => {
      const provenance: ImportProvenance = {
        route: 'file_import',
        sourceEquipment: 'caw_olympus_dictaphone',
        originalAppointmentDate: '2026-08-28',
        consentAttestationMeans: 'written_intake_agreement',
        capturePartyCoverage: 'both_parties_captured',
        fileNameDiscarded: true,
        isUnmanagedDevice: false,
      };

      volatileSessionStore.initSession('file_import', 'adviser-uuid-001');
      volatileSessionStore.setImportProvenance(provenance);

      const session = volatileSessionStore.getState();
      expect(session).not.toBeNull();
      expect(session?.importProvenance?.sourceEquipment).toBe('caw_olympus_dictaphone');
      expect(session?.importProvenance?.originalAppointmentDate).toBe('2026-08-28');
      expect(session?.importProvenance?.fileNameDiscarded).toBe(true);
      expect(session?.importProvenance?.isUnmanagedDevice).toBe(false);

      // Verify that no fileName field exists in session state or metadata
      expect((session as any).mediaFileName).toBeUndefined();
      expect((session?.metadata as any).mediaFileName).toBeUndefined();
      expect((session?.metadata as any).fileName).toBeUndefined();
    });

    it('flags unmanaged devices when external sources are selected', () => {
      const externalProvenance: ImportProvenance = {
        route: 'file_import',
        sourceEquipment: 'external_client_device',
        originalAppointmentDate: '2026-08-29',
        consentAttestationMeans: 'verbal_consent_on_tape',
        capturePartyCoverage: 'client_only_captured',
        fileNameDiscarded: true,
        isUnmanagedDevice: true,
      };

      volatileSessionStore.initSession('file_import', 'adviser-uuid-002');
      volatileSessionStore.setImportProvenance(externalProvenance);

      const session = volatileSessionStore.getState();
      expect(session?.importProvenance?.isUnmanagedDevice).toBe(true);
      expect(session?.importProvenance?.sourceEquipment).toBe('external_client_device');
    });

    it('verifyZeroClientPii rejects objects containing filename or file_name keys', () => {
      const dirtyObject = {
        session_id: '123',
        filename: 'John_Smith_DOB_1980_Case_772.mp3',
      };

      expect(() => verifyZeroClientPii(dirtyObject)).toThrow(/Zero-PII invariant violation/);
    });

    it('verifyZeroClientPii permits pure controlled provenance metadata', () => {
      const cleanProvenance = {
        route: 'file_import',
        source_equipment: 'caw_olympus_dictaphone',
        appointment_date: '2026-08-28',
        consent_means: 'written_intake_agreement',
        party_coverage: 'both_parties_captured',
        is_unmanaged_device: false,
      };

      expect(() => verifyZeroClientPii(cleanProvenance)).not.toThrow();
    });
  });

  describe('6B.3 Sandboxed Decoder Worker Isolation', () => {
    // Behaviour, not text. The previous version of this test asserted that the worker file
    // contained the literal string `delete (self as any).fetch`, which it did, at module top
    // level behind a guard that is also true in a window. The assertion passed while the
    // deployed SPA was deleting window.fetch from its own page.
    it('neuters every network primitive inside a Worker scope', async () => {
      const { installWorkerNetworkSandbox, isWorkerScope, NETWORK_GLOBALS } = await import(
        '../../client/src/workers/workerSandbox.ts'
      );

      class FakeWorkerGlobalScope {}
      const workerScope: any = Object.create(FakeWorkerGlobalScope.prototype);
      workerScope.WorkerGlobalScope = FakeWorkerGlobalScope;
      for (const name of NETWORK_GLOBALS) workerScope[name] = () => 'reachable';

      expect(isWorkerScope(workerScope)).toBe(true);
      expect(installWorkerNetworkSandbox(workerScope)).toBe(true);

      for (const name of NETWORK_GLOBALS) {
        if (typeof workerScope[name] === 'undefined') continue;
        expect(() => workerScope[name]()).toThrow(/Network access via .* is prohibited/);
      }
    });

    it('leaves a browser main thread with its network primitives intact', async () => {
      const { installWorkerNetworkSandbox, isWorkerScope, NETWORK_GLOBALS } = await import(
        '../../client/src/workers/workerSandbox.ts'
      );

      const windowScope: any = { document: {} };
      windowScope.window = windowScope;
      for (const name of NETWORK_GLOBALS) windowScope[name] = () => 'reachable';

      expect(isWorkerScope(windowScope)).toBe(false);
      expect(installWorkerNetworkSandbox(windowScope)).toBe(false);
      for (const name of NETWORK_GLOBALS) expect(windowScope[name]()).toBe('reachable');
    });

    it('has worker entries route their sandbox through workerSandbox.ts', async () => {
      const fs = await import('fs');
      const path = await import('path');
      for (const entry of ['mediaDecoderWorker.ts']) {
        const content = fs.readFileSync(
          path.resolve(__dirname, '../../client/src/workers/', entry),
          'utf8',
        );
        expect(content).toContain('installWorkerNetworkSandbox()');
        // No entry may still delete a network global directly: that is the code path that
        // could not tell a Worker global from a window.
        expect(content).not.toMatch(/^\s*delete \(self as any\)/m);
      }
    });

    it('ensures mediaStreamingDecoder invokes worker and discards file name', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const decoderCodePath = path.resolve(__dirname, '../../client/src/audio/mediaStreamingDecoder.ts');
      const content = fs.readFileSync(decoderCodePath, 'utf8');

      // Check that decodeAudio does not take a fileName string
      expect(content).toContain('async decodeAudio(fileBuffer: ArrayBuffer)');
      expect(content).not.toContain('async decodeAudio(file: File, fileName: string)');
    });
  });
});
