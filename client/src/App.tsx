import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Mic,
  PhoneCall,
  Upload,
  FileText,
  CheckCircle2,
  LogOut,
  Settings,
  BarChart3,
  Trash2,
  Play,
  Pause,
  Square,
  AlertTriangle,
  Radio,
  HardDrive,
  Info,
  Cloud,
} from 'lucide-react';
import { environment } from './config/environments.ts';
import { volatileAuthStore, type AuthUser } from './state/authStore.ts';
import { volatileSessionStore, type SessionState } from './state/volatileStore.ts';
import { sessionRecoveryManager } from './state/sessionRecoveryManager.ts';
import { idleTimeoutManager } from './state/idleTimeout.ts';
import { mediaStreamingDecoder } from './audio/mediaStreamingDecoder.ts';
import {
  consentManager,
  CONTROLLED_SOURCE_EQUIPMENT_LABELS,
  CONTROLLED_CONSENT_MEANS_LABELS,
  CONTROLLED_PARTY_COVERAGE_LABELS,
  type IntakeRoute,
  type ConsentRecord,
} from './consent/consentManager.ts';
import {
  LiveAudioCapture,
  type CaptureState,
  type MemoryPressureLevel,
} from './audio/liveAudioCapture.ts';
import { webexStreamCapture } from './audio/webexStreamCapture.ts';
import { audioNormalizer } from './audio/audioNormalizer.ts';
import type { DominantSpeakerAnalysis } from './audio/dominantSpeakerDetector.ts';
import { LoginView } from './components/LoginView.tsx';
import { LogoutModal } from './components/LogoutModal.tsx';
import { ConsentGateModal } from './components/ConsentGateModal.tsx';
import { HardwareBenchmarkBanner } from './components/HardwareBenchmarkBanner.tsx';
import { LocalAsrProgressModal } from './components/LocalAsrProgressModal.tsx';
import { localAsrEngine } from './asr/localAsrEngine.ts';
import type { WorkerAsrProgress } from './workers/localAsrWorker.ts';
import { IdentifierReviewPanel } from './components/IdentifierReviewPanel.tsx';
import { identifierEngine } from './redaction/identifierEngine.ts';
import { RedactionReviewGateModal } from './components/RedactionReviewGateModal.tsx';
import { AudioRedactionVerificationModal } from './components/AudioRedactionVerificationModal.tsx';
import { CloudSttModal } from './components/CloudSttModal.tsx';
import { CloudSttFailureModal } from './components/CloudSttFailureModal.tsx';
import { TranscriptReviewPanel } from './components/TranscriptReviewPanel.tsx';
import { CaseNoteReviewPanel } from './components/CaseNoteReviewPanel.tsx';
import { caseNoteEngine } from './casenote/caseNoteEngine.ts';
import { tokenisationEngine } from './tokenisation/tokenisationEngine.ts';
import { destroySession } from './state/sessionDestruction.ts';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'consultation' | 'monitoring' | 'admin'>('consultation');
  const [session, setSession] = useState<Readonly<SessionState> | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isProcessingMedia, setIsProcessingMedia] = useState(false);
  const [fileImportNotice, setFileImportNotice] = useState<string | null>(null);

  // Phase 13 Case Note Generation State
  const [isGeneratingCaseNote, setIsGeneratingCaseNote] = useState(false);

  // Phase 7 Local ASR State
  const [isAsrRunning, setIsAsrRunning] = useState(false);
  const [asrProgress, setAsrProgress] = useState<WorkerAsrProgress | null>(null);
  const [asrHardwareBackend, setAsrHardwareBackend] = useState<'webgpu' | 'wasm'>('wasm');

  // Phase 9 Redaction Review Gate State
  const [isRedactionGateOpen, setIsRedactionGateOpen] = useState(false);

  // Phase 10 Audio Redaction Verification Modal State
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);

  // Phase 11 Cloud Speech-to-Text v2 Modal States
  const [isCloudSttModalOpen, setIsCloudSttModalOpen] = useState(false);
  const [isCloudSttFailureModalOpen, setIsCloudSttFailureModalOpen] = useState(false);
  const [cloudSttError, setCloudSttError] = useState<string | null>(null);

  // Phase 6 State
  const [selectedRoute, setSelectedRoute] = useState<IntakeRoute | null>(null);
  const [isConsentModalOpen, setIsConsentModalOpen] = useState(false);
  const [activeConsentRecord, setActiveConsentRecord] = useState<ConsentRecord | null>(null);

  // Live Capture State
  const [captureState, setCaptureState] = useState<CaptureState>('idle');
  const [recordingDuration, setRecordingDuration] = useState('00:00');
  const [memoryPressure, setMemoryPressure] = useState<{
    level: MemoryPressureLevel;
    currentMb: number;
    message: string | null;
  }>({ level: 'normal', currentMb: 0, message: null });
  const [dominantSpeakerWarning, setDominantSpeakerWarning] = useState<string | null>(null);

  // Webex State
  const [isWebexCallActive, setIsWebexCallActive] = useState(false);
  const [isWebexRecording, setIsWebexRecording] = useState(false);

  const liveCaptureRef = useRef<LiveAudioCapture | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleTabClose = () => {
      destroySession({ reason: 'tab_close' }).catch(() => {});
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleTabClose);
      window.addEventListener('pagehide', handleTabClose);
    }

    const unsubAuth = volatileAuthStore.subscribe((state) => {
      setCurrentUser(state.user);
      if (state.isAuthenticated) {
        idleTimeoutManager.start();
        sessionRecoveryManager.requestRestore().then((restored) => {
          if (restored) {
            setSession(volatileSessionStore.getState());
          }
        });
      } else {
        idleTimeoutManager.stop();
        destroySession({ reason: 'logout' }).catch(() => {});
      }
    });

    const unsubSession = volatileSessionStore.subscribe((state) => {
      setSession(state);
      if (state?.consentRecord) {
        setActiveConsentRecord(state.consentRecord as ConsentRecord);
      }
    });

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleTabClose);
        window.removeEventListener('pagehide', handleTabClose);
      }
      unsubAuth();
      unsubSession();
      idleTimeoutManager.stop();
      if (liveCaptureRef.current) {
        liveCaptureRef.current.abort();
      }
    };
  }, []);

  if (!currentUser) {
    return (
      <main
        translate="no"
        className="notranslate"
        style={{ minHeight: '100vh', backgroundColor: '#F8FAFC', padding: '2rem' }}
      >
        <LoginView onLoginSuccess={(user) => setCurrentUser(user)} />
      </main>
    );
  }

  const isAdviserOrSupervisor = currentUser.role === 'adviser' || currentUser.role === 'supervisor';
  const isSupervisorOrAuditor = currentUser.role === 'supervisor' || currentUser.role === 'auditor';
  const isAdmin = currentUser.role === 'administrator';

  // --- Consent Gate Handlers ---

  const handleRouteSelection = (route: IntakeRoute) => {
    setMediaError(null);
    setSelectedRoute(route);
    setIsConsentModalOpen(true);
  };

  const handleConsentConfirmed = async (record: ConsentRecord) => {
    setIsConsentModalOpen(false);
    setActiveConsentRecord(record);

    if (record.route === 'live_in_person') {
      startLiveRecording(record);
    } else if (record.route === 'webex_telephony') {
      webexStreamCapture.confirmConsent(record);
      webexStreamCapture.connectCall(null, null);
      setIsWebexCallActive(true);
    } else if (record.route === 'file_import') {
      // Trigger file selector once attestation is complete
      fileInputRef.current?.click();
    }
  };

  // --- Live Capture Methods ---

  const startLiveRecording = async (consent: ConsentRecord) => {
    const capture = new LiveAudioCapture({
      onStateChange: (st) => setCaptureState(st),
      onDurationUpdate: (_, formatted) => setRecordingDuration(formatted),
      onMemoryPressure: (level, currentMb, message) => setMemoryPressure({ level, currentMb, message }),
      onDominantSpeakerAnalysis: (analysis: DominantSpeakerAnalysis) => {
        setDominantSpeakerWarning(analysis.warningMessage);
      },
    });

    liveCaptureRef.current = capture;
    volatileSessionStore.initSession('live_microphone', currentUser.id);
    volatileSessionStore.setConsentRecord(consent);

    try {
      await capture.start();
    } catch (err: any) {
      setMediaError(err.message || 'Microphone access failed.');
      setCaptureState('idle');
    }
  };

  const handlePauseLive = () => {
    liveCaptureRef.current?.pause();
  };

  const handleResumeLive = () => {
    liveCaptureRef.current?.resume();
  };

  // --- Pass One Local ASR Runner ---

  const runPassOneAsr = async () => {
    const rawAudio = volatileSessionStore.getRawAudio();
    const currentSession = volatileSessionStore.getState();
    if (!rawAudio || !currentSession) return;

    setIsAsrRunning(true);
    setAsrProgress(null);

    try {
      const benchmark = await localAsrEngine.assessHardwareCapabilities();
      setAsrHardwareBackend(benchmark.recommendedBackend);

      await localAsrEngine.transcribeAudio(
        rawAudio,
        currentSession.metadata.audioDurationSeconds || 0,
        currentSession.speakerMap,
        (progress) => {
          setAsrProgress(progress);
        }
      );

      // Phase 8 & 9: Automatically run 3-Layer Identifier Detection & open Redaction Review Gate
      const updatedSession = volatileSessionStore.getState();
      if (updatedSession?.localDraftTranscript) {
        const detectionResult = identifierEngine.detectIdentifiers(
          updatedSession.localDraftTranscript,
          updatedSession.localAsrResult
        );
        volatileSessionStore.setDetectedIdentifiers(detectionResult.identifiers);
        volatileSessionStore.setTokenMap(detectionResult.tokenMap);
        volatileSessionStore.setTokenisedTranscript(detectionResult.tokenisedTranscript);
        volatileSessionStore.openRedactionGate();
        setIsRedactionGateOpen(true);
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Pass One speech recognition encountered an error.');
    } finally {
      setIsAsrRunning(false);
    }
  };

  const handleRunIdentifierDetection = () => {
    const current = volatileSessionStore.getState();
    if (!current || !current.localDraftTranscript) return;
    const res = identifierEngine.detectIdentifiers(current.localDraftTranscript, current.localAsrResult);
    volatileSessionStore.setDetectedIdentifiers(res.identifiers);
    volatileSessionStore.setTokenMap(res.tokenMap);
    volatileSessionStore.setTokenisedTranscript(res.tokenisedTranscript);
    volatileSessionStore.openRedactionGate();
    setIsRedactionGateOpen(true);
  };

  const handleStopLive = async () => {
    if (!liveCaptureRef.current || !activeConsentRecord) return;
    const result = liveCaptureRef.current.stop();
    audioNormalizer.normalizeLiveCapture(result, activeConsentRecord);
    setCaptureState('stopped');
    await runPassOneAsr();
  };

  // --- Webex Stream Handlers ---

  const handleStartWebexRecording = () => {
    if (!webexStreamCapture.isConsentUnlocked()) {
      setMediaError('Consent must be affirmatively confirmed before recording can begin.');
      return;
    }
    webexStreamCapture.startRecording();
    setIsWebexRecording(true);
  };

  const handleStopWebexRecording = async () => {
    if (!activeConsentRecord) return;
    const result = webexStreamCapture.stopRecording();
    audioNormalizer.normalizeWebexCapture(result, activeConsentRecord);
    setIsWebexRecording(false);
    await runPassOneAsr();
  };

  // --- File Import Handler (Phase 6B) ---

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!activeConsentRecord || activeConsentRecord.route !== 'file_import') {
      setMediaError('[CONSENT GATE VIOLATION] Professional consent attestation required before importing recordings.');
      e.target.value = '';
      return;
    }

    setMediaError(null);
    setFileImportNotice(null);
    setIsProcessingMedia(true);

    try {
      // 1. Instant pre-flight check on file size before allocating memory
      const preFlight = mediaStreamingDecoder.validatePreFlight({ size: file.size });
      if (!preFlight.valid) {
        setMediaError(preFlight.error!);
        setIsProcessingMedia(false);
        e.target.value = '';
        return;
      }

      // 2. Read raw bytes directly into volatile RAM; immediately discard File object and file.name
      const arrayBuffer = await file.arrayBuffer();

      // 3. Initialize volatile store session and commit provenance record
      volatileSessionStore.initSession('file_import', currentUser.id);
      volatileSessionStore.setConsentRecord(activeConsentRecord);

      // 4. Sandboxed Web Worker decode (video frames discarded immediately, 16kHz mono Float32 PCM extracted)
      const decoded = await mediaStreamingDecoder.decodeAudio(arrayBuffer);

      // 5. Converge onto universal audio normalizer
      audioNormalizer.normalizeFileImport(
        {
          pcmBuffer: decoded.pcmBuffer,
          durationSeconds: decoded.durationSeconds,
          sampleRate: decoded.sampleRate,
        },
        activeConsentRecord
      );

      setFileImportNotice('File contents loaded into volatile memory. File name discarded for client confidentiality.');
      await runPassOneAsr();
    } catch (err: any) {
      setMediaError(err.message || 'Failed to decode media file.');
    } finally {
      setIsProcessingMedia(false);
      e.target.value = '';
    }
  };

  // --- Instant One-Action Consent Withdrawal ---

  const handleWithdrawConsent = () => {
    // Phase 6.1: Immediate single-tap destruction without confirmation dialogues
    if (liveCaptureRef.current) {
      liveCaptureRef.current.abort();
      liveCaptureRef.current = null;
    }

    const currentRoute = activeConsentRecord?.route;
    consentManager.withdrawConsent(currentRoute, () => {
      // On Webex: Stop recording and wipe memory, but keep telephone call alive
      webexStreamCapture.withdrawConsentAndContinueCall();
      setIsWebexRecording(false);
    });

    setActiveConsentRecord(null);
    setCaptureState('idle');
    setRecordingDuration('00:00');
    setDominantSpeakerWarning(null);
    setSession(null);
  };

  const handleDestroySession = async () => {
    if (liveCaptureRef.current) {
      liveCaptureRef.current.abort();
      liveCaptureRef.current = null;
    }
    await destroySession({ reason: 'explicit_end' });
    setActiveConsentRecord(null);
    setCaptureState('idle');
    setRecordingDuration('00:00');
    setDominantSpeakerWarning(null);
    setSession(null);
  };

  const handleGenerateCaseNote = async () => {
    if (!session) return;
    if (!session.isGatePassed) {
      volatileSessionStore.openRedactionGate();
      setIsRedactionGateOpen(true);
      setMediaError('Adviser Redaction Review Gate (Phase 9) must be completed before generating case notes.');
      return;
    }

    const tokenisedTranscript =
      session.tokenisedWorkingTranscript ||
      session.tokenisedTranscript ||
      session.localDraftTranscript ||
      '';

    if (!tokenisedTranscript.trim()) {
      setMediaError('Working transcript is empty. Please transcribe audio before generating case notes.');
      return;
    }

    setIsGeneratingCaseNote(true);
    setMediaError(null);

    try {
      await caseNoteEngine.generateCaseNote({
        tokenisedTranscript,
        adviserName: currentUser.name,
        intakeRoute: session.consentRecord?.route || 'In-Person Consultation',
      });
    } catch (err: any) {
      setMediaError(err.message || 'Failed to generate AQS Level 3 case note.');
    } finally {
      setIsGeneratingCaseNote(false);
    }
  };

  const isRecordingActive = captureState === 'recording' || isWebexRecording;

  return (
    <div
      translate="no"
      className="notranslate"
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#F8FAFC' }}
    >
      {/* Sticky Persistent Recording Indicator (Phase 6.2) */}
      {isRecordingActive && (
        <aside
          role="region"
          aria-label="Recording Status and Controls"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            backgroundColor: '#0F172A',
            color: '#FFFFFF',
            padding: '0.625rem 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: '#EF4444',
                  animation: 'pulse 1.5s infinite',
                }}
              />
              <span style={{ fontWeight: 700, fontSize: '0.875rem', letterSpacing: '0.05em', color: '#F87171' }}>
                ● REC
              </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.9375rem', marginLeft: '0.5rem' }}>
                {recordingDuration}
              </span>
            </div>

            <div style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>
              Volatile RAM: <strong>{memoryPressure.currentMb} MB</strong> (16kHz Mono Float32)
            </div>

            {memoryPressure.level !== 'normal' && (
              <span
                style={{
                  backgroundColor: memoryPressure.level === 'limit_exceeded' ? '#EF4444' : '#F59E0B',
                  color: '#FFFFFF',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                {memoryPressure.message}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {captureState === 'recording' && (
              <button
                type="button"
                onClick={handlePauseLive}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  backgroundColor: '#334155',
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '0.375rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Pause size={14} /> Pause
              </button>
            )}

            {captureState === 'paused' && (
              <button
                type="button"
                onClick={handleResumeLive}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  backgroundColor: '#16A34A',
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '0.375rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Play size={14} /> Resume
              </button>
            )}

            {captureState === 'recording' && (
              <button
                type="button"
                onClick={handleStopLive}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  backgroundColor: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '0.375rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Square size={14} /> Finish Recording
              </button>
            )}

            {isWebexRecording && (
              <button
                type="button"
                onClick={handleStopWebexRecording}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  backgroundColor: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '0.375rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Square size={14} /> Stop Webex Recording
              </button>
            )}

            {/* Instant Withdraw Consent Button (Phase 6.1) */}
            <button
              type="button"
              id="withdraw-consent-button-header"
              onClick={handleWithdrawConsent}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                backgroundColor: '#DC2626',
                color: '#FFFFFF',
                border: 'none',
                padding: '0.375rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Trash2 size={14} /> Withdraw Consent (Instant Destroy)
            </button>
          </div>
        </aside>
      )}

      {/* Top Header & Auth Bar */}
      <header
        style={{
          backgroundColor: '#004B87',
          color: '#FFFFFF',
          padding: '1rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Shield size={28} aria-hidden="true" />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold' }}>Case Ace v2.0</h1>
            <span style={{ fontSize: '0.8125rem', opacity: 0.9 }}>
              Citizens Advice Wandsworth • Environment: <strong>{environment.name}</strong> ({environment.gcpRegion})
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{currentUser.name}</span>
              <span
                style={{
                  backgroundColor: '#002B49',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  fontWeight: 'bold',
                  letterSpacing: '0.05em',
                }}
              >
                {currentUser.role}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', opacity: 0.85, justifyContent: 'flex-end' }}>
              <CheckCircle2 size={12} color="#4ADE80" aria-hidden="true" />
              <span>MFA Verified ({currentUser.provider})</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsLogoutModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              backgroundColor: '#D9381E',
              color: '#FFFFFF',
              border: 'none',
              padding: '0.5rem 0.875rem',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            Log Out
          </button>
        </div>
      </header>

      {/* Role-Based Nav */}
      <nav
        style={{
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          padding: '0.5rem 2rem',
          display: 'flex',
          gap: '1rem',
        }}
      >
        {isAdviserOrSupervisor && (
          <button
            type="button"
            onClick={() => setActiveTab('consultation')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              border: 'none',
              borderRadius: '6px',
              backgroundColor: activeTab === 'consultation' ? '#EFF6FF' : 'transparent',
              color: activeTab === 'consultation' ? '#004B87' : '#64748B',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <FileText size={18} aria-hidden="true" />
            Advice Consultation
          </button>
        )}

        {isSupervisorOrAuditor && (
          <button
            type="button"
            onClick={() => setActiveTab('monitoring')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              border: 'none',
              borderRadius: '6px',
              backgroundColor: activeTab === 'monitoring' ? '#EFF6FF' : 'transparent',
              color: activeTab === 'monitoring' ? '#004B87' : '#64748B',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <BarChart3 size={18} aria-hidden="true" />
            Aggregate Monitoring
          </button>
        )}

        {isAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab('admin')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              border: 'none',
              borderRadius: '6px',
              backgroundColor: activeTab === 'admin' ? '#EFF6FF' : 'transparent',
              color: activeTab === 'admin' ? '#004B87' : '#64748B',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Settings size={18} aria-hidden="true" />
            System Administration
          </button>
        )}
      </nav>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '2rem', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        {activeTab === 'consultation' && isAdviserOrSupervisor && (
          <div>
            {/* Pre-session Hardware Benchmark (Phase 7) */}
            <HardwareBenchmarkBanner />

            {/* Local ASR Progress Modal (Phase 7) */}
            <LocalAsrProgressModal
              isOpen={isAsrRunning}
              progress={asrProgress}
              hardwareBackend={asrHardwareBackend}
              lowConfidenceCount={session?.localAsrResult?.lowConfidenceWordsCount}
            />

            {/* Dominant Speaker Warning Banner (Phase 6.2) */}
            {dominantSpeakerWarning && (
              <div
                role="alert"
                style={{
                  backgroundColor: '#FFFBEB',
                  borderLeft: '4px solid #F59E0B',
                  padding: '1rem',
                  borderRadius: '4px',
                  marginBottom: '1.5rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                }}
              >
                <AlertTriangle size={20} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: '#92400E' }}>
                    Single Dominant Speaker Detected
                  </h4>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#B45309', lineHeight: 1.4 }}>
                    {dominantSpeakerWarning}
                  </p>
                </div>
              </div>
            )}

            {/* Volatile Banner */}
            <div
              style={{
                backgroundColor: '#EFF6FF',
                borderLeft: '4px solid #004B87',
                padding: '1rem',
                borderRadius: '4px',
                marginBottom: '1.5rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 'bold', color: '#004B87', margin: '0 0 0.25rem 0' }}>
                  Volatile Memory Mode (Constraint C1)
                </h2>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#1E293B' }}>
                  All session data exists solely in volatile RAM. Storage APIs are blocked. Closing browser destroys session.
                </p>
              </div>

              {(session || isRecordingActive || isWebexCallActive) && (
                <button
                  type="button"
                  id="withdraw-consent-button-main"
                  onClick={handleWithdrawConsent}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    backgroundColor: '#FEF2F2',
                    color: '#D9381E',
                    border: '1px solid #FCA5A5',
                    padding: '0.5rem 0.875rem',
                    borderRadius: '6px',
                    fontSize: '0.8125rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Withdraw Consent (Instant Destroy)
                </button>
              )}
            </div>

            {mediaError && (
              <div
                style={{
                  backgroundColor: '#FEF2F2',
                  borderLeft: '4px solid #D9381E',
                  padding: '1rem',
                  borderRadius: '4px',
                  marginBottom: '1.5rem',
                  color: '#991B1B',
                  fontSize: '0.875rem',
                }}
              >
                <strong>Intake / Privacy Error:</strong> {mediaError}
              </div>
            )}

            {/* Stage: Route Intake Selection */}
            {!session && !isWebexCallActive && captureState === 'idle' && (
              <div>
                <h3 style={{ fontSize: '1.125rem', color: '#1E293B', marginBottom: '1rem' }}>
                  Select Advice Intake Route
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                  {/* Route 1: Live In Person */}
                  <div
                    id="route-live-in-person"
                    style={{
                      backgroundColor: '#FFFFFF',
                      padding: '1.5rem',
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                    onClick={() => handleRouteSelection('live_in_person')}
                  >
                    <Mic size={32} color="#004B87" aria-hidden="true" />
                    <h4 style={{ margin: '1rem 0 0.5rem 0', color: '#004B87' }}>Live In-Person Interview</h4>
                    <p style={{ color: '#64748B', fontSize: '0.875rem', margin: 0, lineHeight: 1.5 }}>
                      Record face-to-face consultation via microphone with mandatory in-person consent gating and dominant speaker detection.
                    </p>
                  </div>

                  {/* Route 2: Webex Telephony */}
                  <div
                    id="route-webex-telephony"
                    style={{
                      backgroundColor: '#FFFFFF',
                      padding: '1.5rem',
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                    onClick={() => handleRouteSelection('webex_telephony')}
                  >
                    <PhoneCall size={32} color="#004B87" aria-hidden="true" />
                    <h4 style={{ margin: '1rem 0 0.5rem 0', color: '#004B87' }}>Telephone Call (Cisco Webex)</h4>
                    <p style={{ color: '#64748B', fontSize: '0.875rem', margin: 0, lineHeight: 1.5 }}>
                      Dial-out or receive client call via Webex Calling. Telephony consent gate unlocks recording; withdrawal keeps call active.
                    </p>
                  </div>

                  {/* Route 3: File Import */}
                  <div
                    id="route-file-import"
                    style={{
                      backgroundColor: '#FFFFFF',
                      padding: '1.5rem',
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                    onClick={() => handleRouteSelection('file_import')}
                  >
                    <div>
                      <Upload size={32} color="#004B87" aria-hidden="true" />
                      <h4 style={{ margin: '1rem 0 0.5rem 0', color: '#004B87' }}>
                        {isProcessingMedia ? 'Extracting Audio Track...' : 'Import Recorded Consultation'}
                      </h4>
                      <p style={{ color: '#64748B', fontSize: '0.8125rem', margin: '0 0 0.75rem 0', lineHeight: 1.5 }}>
                        Import externally captured audio or video interviews with mandatory consent and provenance attestation.
                      </p>
                    </div>

                    <div style={{ backgroundColor: '#F8FAFC', padding: '0.625rem', borderRadius: '4px', border: '1px solid #E2E8F0', fontSize: '0.75rem', color: '#475569' }}>
                      <div style={{ fontWeight: 600, color: '#004B87', marginBottom: '0.25rem' }}>Limits & Formats:</div>
                      <div>• Max Size: <strong>500 MB</strong> | Max Duration: <strong>90 mins</strong></div>
                      <div>• Audio: <strong>WAV, MP3, M4A, AAC, FLAC, OGG</strong></div>
                      <div>• Video: <strong>MP4, MOV, WebM</strong> (Audio extracted, video frames discarded)</div>
                    </div>
                  </div>
                </div>

                {/* Hidden File Input for Attested Import */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/*,.mp4,.wav,.mp3,.m4a,.aac,.webm,.mov,.flac,.ogg"
                  style={{ display: 'none' }}
                  onChange={handleFileImport}
                  disabled={isProcessingMedia}
                />
              </div>
            )}

            {/* Webex Telephony Active Console */}
            {isWebexCallActive && (
              <div
                style={{
                  backgroundColor: '#FFFFFF',
                  padding: '1.5rem',
                  borderRadius: '8px',
                  border: '1px solid #E2E8F0',
                  marginBottom: '1.5rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Radio size={24} color="#16A34A" />
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.125rem', color: '#004B87' }}>
                        Webex Telephony Call Active
                      </h3>
                      <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>
                        Connected • Channel 0: Adviser Mic | Channel 1: Remote Client Audio
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    {!isWebexRecording ? (
                      <button
                        type="button"
                        id="webex-start-recording-button"
                        onClick={handleStartWebexRecording}
                        disabled={!webexStreamCapture.isConsentUnlocked()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.375rem',
                          backgroundColor: webexStreamCapture.isConsentUnlocked() ? '#DC2626' : '#94A3B8',
                          color: '#FFFFFF',
                          border: 'none',
                          padding: '0.5rem 1rem',
                          borderRadius: '6px',
                          fontWeight: 600,
                          fontSize: '0.875rem',
                          cursor: webexStreamCapture.isConsentUnlocked() ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <Radio size={16} /> Start Recording Call
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStopWebexRecording}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.375rem',
                          backgroundColor: '#2563EB',
                          color: '#FFFFFF',
                          border: 'none',
                          padding: '0.5rem 1rem',
                          borderRadius: '6px',
                          fontWeight: 600,
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                        }}
                      >
                        <Square size={16} /> Finish Recording Call
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        webexStreamCapture.endCall();
                        setIsWebexCallActive(false);
                        setIsWebexRecording(false);
                      }}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        backgroundColor: '#FFFFFF',
                        color: '#64748B',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      End Telephone Call
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Post-Intake Consultation Workflow */}
            {session && (
              <div>
                {/* File Import Discard Notice */}
                {fileImportNotice && (
                  <div
                    style={{
                      backgroundColor: '#EFF6FF',
                      borderLeft: '4px solid #004B87',
                      padding: '0.75rem 1rem',
                      borderRadius: '4px',
                      marginBottom: '1.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <Info size={18} color="#004B87" aria-hidden="true" />
                    <span style={{ fontSize: '0.8125rem', color: '#1E293B', fontWeight: 500 }}>
                      {fileImportNotice}
                    </span>
                  </div>
                )}

                {/* Import Provenance Metadata Box */}
                {session.importProvenance && (
                  <div
                    style={{
                      backgroundColor: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      padding: '0.75rem 1rem',
                      borderRadius: '6px',
                      marginBottom: '1.25rem',
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
                      <div style={{ fontSize: '0.75rem', color: '#334155' }}>
                        <span style={{ fontWeight: 600 }}>Source Equipment:</span>{' '}
                        {CONTROLLED_SOURCE_EQUIPMENT_LABELS[session.importProvenance.sourceEquipment]?.label || session.importProvenance.sourceEquipment}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#334155' }}>
                        <span style={{ fontWeight: 600 }}>Original Date:</span> {session.importProvenance.originalAppointmentDate}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#334155' }}>
                        <span style={{ fontWeight: 600 }}>Consent Means:</span>{' '}
                        {CONTROLLED_CONSENT_MEANS_LABELS[session.importProvenance.consentAttestationMeans] || session.importProvenance.consentAttestationMeans}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#334155' }}>
                        <span style={{ fontWeight: 600 }}>Party Coverage:</span>{' '}
                        {CONTROLLED_PARTY_COVERAGE_LABELS[session.importProvenance.capturePartyCoverage] || session.importProvenance.capturePartyCoverage}
                      </div>
                    </div>
                    {session.importProvenance.isUnmanagedDevice && (
                      <div style={{ marginTop: '0.5rem', color: '#92400E', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <AlertTriangle size={14} color="#D97706" />
                        <span>Unmanaged Source Device: Ensure the external recording is deleted per SOP-REC-01 and DPIA procedures.</span>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  {/* Left Column: Pass One Local ASR & Redaction Controls */}
                  <div style={{ backgroundColor: '#FFFFFF', padding: '1.5rem', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#004B87' }}>Pass One: Local Acoustic Analysis</h3>
                        <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                          Route: {session.consentRecord?.route || 'in-memory'} • 16kHz Float32 PCM
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', backgroundColor: '#EFF6FF', color: '#004B87', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                        Stage: {session.stage}
                      </span>
                    </div>

                    {/* Transcript Header & Privacy Invariant Banner */}
                    {session.cloudAccurateTranscript ? (
                      <div
                        style={{
                          backgroundColor: session.isFallbackToLocalTranscript ? '#FFFBEB' : '#EFF6FF',
                          border: `1px solid ${session.isFallbackToLocalTranscript ? '#FDE68A' : '#BFDBFE'}`,
                          borderRadius: '6px',
                          padding: '0.75rem',
                          marginBottom: '1rem',
                          fontSize: '0.8125rem',
                          color: session.isFallbackToLocalTranscript ? '#92400E' : '#1E40AF',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <Shield size={14} />
                            {session.isFallbackToLocalTranscript
                              ? 'Pass 1 Local Transcript (Fallback Mode - Review Needed)'
                              : 'Pass 2 Cloud Working Transcript (High Accuracy • Diarised)'}
                          </span>
                          <span style={{ fontSize: '0.6875rem', backgroundColor: session.isFallbackToLocalTranscript ? '#FEF3C7' : '#DBEAFE', padding: '0.125rem 0.375rem', borderRadius: '4px', fontWeight: 600 }}>
                            {session.isFallbackToLocalTranscript ? 'LOCAL FALLBACK' : 'EUROPE-WEST2'}
                          </span>
                        </div>
                        {session.isFallbackToLocalTranscript
                          ? 'This transcript was retained after Cloud STT error. Extra care is required when verifying dates, welfare rates, and names in the case note.'
                          : 'Generated via Google Cloud Speech-to-Text v2 from verified redacted audio with Advice Sector phrase adaptation.'}
                      </div>
                    ) : (
                      <div
                        style={{
                          backgroundColor: '#FEF3C7',
                          border: '1px solid #FCD34D',
                          borderRadius: '6px',
                          padding: '0.75rem',
                          marginBottom: '1rem',
                          fontSize: '0.8125rem',
                          color: '#92400E',
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <Shield size={14} /> Internal Redaction Pass Only
                        </div>
                        This transcript exists solely to locate identifiers for local acoustic redaction. It is never displayed as the working case note and never leaves this workstation.
                      </div>
                    )}

                    {/* Speech Recognition Results Summary */}
                    {session.cloudAsrResult ? (
                      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>Cloud STT v2 Output:</span>
                          <span style={{ fontSize: '0.6875rem', padding: '0.125rem 0.375rem', borderRadius: '4px', backgroundColor: '#DCFCE7', color: '#166534', fontWeight: 600 }}>
                            en-GB • {(session.cloudAsrResult.avgConfidence * 100).toFixed(1)}% Confidence
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', textAlign: 'center', fontSize: '0.75rem', color: '#475569' }}>
                          <div style={{ backgroundColor: '#FFFFFF', padding: '0.375rem', borderRadius: '4px', border: '1px solid #CBD5E1' }}>
                            <div style={{ fontWeight: 700, color: '#0F172A' }}>{session.cloudAsrResult.totalWords}</div>
                            <div style={{ fontSize: '0.6875rem' }}>Words</div>
                          </div>
                          <div style={{ backgroundColor: '#FFFFFF', padding: '0.375rem', borderRadius: '4px', border: '1px solid #CBD5E1' }}>
                            <div style={{ fontWeight: 700, color: '#0F172A' }}>{session.cloudAsrResult.segments.length}</div>
                            <div style={{ fontSize: '0.6875rem' }}>Speaker Turns</div>
                          </div>
                          <div style={{ backgroundColor: '#FFFFFF', padding: '0.375rem', borderRadius: '4px', border: '1px solid #CBD5E1' }}>
                            <div style={{ fontWeight: 700, color: '#166534' }}>v{session.cloudAsrResult.phraseSetVersion}</div>
                            <div style={{ fontSize: '0.6875rem' }}>Phrase Set</div>
                          </div>
                        </div>
                      </div>
                    ) : session.localAsrResult ? (
                      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>Acoustic Segmentation Status:</span>
                          <span style={{ fontSize: '0.6875rem', padding: '0.125rem 0.375rem', borderRadius: '4px', backgroundColor: session.localAsrResult.hardwareBackend === 'webgpu' ? '#DCFCE7' : '#FEF3C7', color: session.localAsrResult.hardwareBackend === 'webgpu' ? '#166534' : '#92400E', fontWeight: 600 }}>
                            {session.localAsrResult.hardwareBackend.toUpperCase()} ({session.localAsrResult.executionDurationMs}ms)
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', textAlign: 'center', fontSize: '0.75rem', color: '#475569' }}>
                          <div style={{ backgroundColor: '#FFFFFF', padding: '0.375rem', borderRadius: '4px', border: '1px solid #CBD5E1' }}>
                            <div style={{ fontWeight: 700, color: '#0F172A' }}>{session.localAsrResult.totalWords}</div>
                            <div style={{ fontSize: '0.6875rem' }}>Words</div>
                          </div>
                          <div style={{ backgroundColor: '#FFFFFF', padding: '0.375rem', borderRadius: '4px', border: '1px solid #CBD5E1' }}>
                            <div style={{ fontWeight: 700, color: '#0F172A' }}>{session.localAsrResult.segments.length}</div>
                            <div style={{ fontSize: '0.6875rem' }}>Turns/Segments</div>
                          </div>
                          <div style={{ backgroundColor: '#FFFFFF', padding: '0.375rem', borderRadius: '4px', border: '1px solid #CBD5E1' }}>
                            <div style={{ fontWeight: 700, color: session.localAsrResult.lowConfidenceWordsCount > 0 ? '#B45309' : '#166534' }}>
                              {session.localAsrResult.lowConfidenceWordsCount}
                            </div>
                            <div style={{ fontSize: '0.6875rem' }}>Low Conf (&lt;0.70)</div>
                          </div>
                        </div>
                        {session.localAsrResult.lowConfidenceWordsCount > 0 && (
                          <div style={{ marginTop: '0.5rem', fontSize: '0.6875rem', color: '#92400E', backgroundColor: '#FFFBEB', padding: '0.375rem', borderRadius: '4px', border: '1px solid #FDE68A' }}>
                            ⚠️ {session.localAsrResult.lowConfidenceWordsCount} mumbled/low-confidence tokens escalated to Phase 9 Redaction Gate.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ backgroundColor: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: '6px', padding: '1rem', textAlign: 'center', marginBottom: '1rem', fontSize: '0.8125rem', color: '#64748B' }}>
                        Local Speech Recognition not yet executed for this audio.
                      </div>
                    )}
                  </div>

                  {/* Right Column: Transcript & Tokenisation Controls (Phase 12) */}
                  <div style={{ backgroundColor: '#FFFFFF', padding: '1.25rem', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', color: '#004B87' }}>Acoustic Processing & Redaction Actions</h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={handleRunIdentifierDetection}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.375rem',
                            backgroundColor: '#0284C7',
                            color: '#FFFFFF',
                            border: 'none',
                            padding: '0.4rem 0.875rem',
                            borderRadius: '6px',
                            fontWeight: 600,
                            fontSize: '0.8125rem',
                            cursor: 'pointer',
                          }}
                        >
                          <Shield size={14} aria-hidden="true" />
                          Re-Scan Identifiers (Phase 8)
                        </button>

                        <button
                          type="button"
                          id="open-redaction-gate-btn"
                          onClick={() => {
                            volatileSessionStore.openRedactionGate();
                            setIsRedactionGateOpen(true);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.375rem',
                            backgroundColor: session.isGatePassed ? '#059669' : '#D97706',
                            color: '#FFFFFF',
                            border: 'none',
                            padding: '0.4rem 0.875rem',
                            borderRadius: '6px',
                            fontWeight: 700,
                            fontSize: '0.8125rem',
                            cursor: 'pointer',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                          }}
                        >
                          <Shield size={14} aria-hidden="true" />
                          {session.isGatePassed ? (
                            <span>Redaction Gate Passed ✓</span>
                          ) : (
                            <span>Review Redactions Gate (Phase 9)</span>
                          )}
                        </button>

                        {session.isAudioRedactedAndVerified && !session.cloudAccurateTranscript && (
                          <button
                            type="button"
                            id="trigger-cloud-stt-btn"
                            onClick={() => {
                              setIsCloudSttModalOpen(true);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.375rem',
                              backgroundColor: '#004B87',
                              color: '#FFFFFF',
                              border: 'none',
                              padding: '0.4rem 0.875rem',
                              borderRadius: '6px',
                              fontWeight: 700,
                              fontSize: '0.8125rem',
                              cursor: 'pointer',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            }}
                          >
                            <Cloud size={14} aria-hidden="true" />
                            Transcribe via Cloud STT v2
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Phase 12 Interactive Working Transcript Review Panel */}
                    <TranscriptReviewPanel
                      session={session}
                      onProceedToDrafting={handleGenerateCaseNote}
                    />
                  </div>
                </div>

                {/* Phase 13 Canonical Master Template Case Note Review Panel */}
                <div style={{ marginTop: '1.5rem' }}>
                  <CaseNoteReviewPanel
                    session={session}
                    onGenerateCaseNote={handleGenerateCaseNote}
                    isGenerating={isGeneratingCaseNote}
                    onDestroySession={handleDestroySession}
                  />
                </div>

                {/* Phase 8: 3-Layer Identifier Detection & Review Panel */}
                {session.localDraftTranscript && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <IdentifierReviewPanel
                      identifiers={session.detectedIdentifiers || []}
                      tokenMap={session.tokenMap || {}}
                    />
                  </div>
                )}

                {/* Source File Retention & Responsibility Notice at Session Conclusion */}
                {session.consentRecord?.route === 'file_import' && (
                  <div
                    style={{
                      marginTop: '1.5rem',
                      backgroundColor: '#F1F5F9',
                      border: '1px solid #CBD5E1',
                      padding: '1rem 1.25rem',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                    }}
                  >
                    <HardDrive size={20} color="#475569" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <h5 style={{ margin: '0 0 0.25rem 0', fontSize: '0.8125rem', color: '#1E293B', fontWeight: 600 }}>
                        Source File Retention & Timely Deletion Reminder (CAW SOP-REC-01)
                      </h5>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
                        The original recording file remains stored on your local workstation/device. Case Ace operates solely in volatile RAM and cannot delete local files.
                        In accordance with CAW Information Governance Policy, you must securely delete the original source recording once the case note is finalized in Casebook.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'monitoring' && isSupervisorOrAuditor && (
          <div style={{ backgroundColor: '#FFFFFF', padding: '2rem', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
            <h2 style={{ fontSize: '1.25rem', color: '#004B87', marginBottom: '1rem' }}>Aggregate Quality & Operational Telemetry</h2>
            <div
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                padding: '1rem',
                borderRadius: '6px',
                marginBottom: '1.5rem',
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: '#1E293B' }}>ISO/IEC 27018 & 27701 Privacy Guarantee:</p>
              <p style={{ margin: '0.25rem 0 0 0', color: '#64748B', fontSize: '0.875rem' }}>
                No session data exists to view. This dashboard provides only anonymized aggregate counts, intake route distributions, and operational throughput.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
              <div style={{ padding: '1rem', backgroundColor: '#EFF6FF', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748B' }}>Total Sessions Processed</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#004B87' }}>42</div>
              </div>
              <div style={{ padding: '1rem', backgroundColor: '#EFF6FF', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748B' }}>In-Person Live Capture</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#004B87' }}>24</div>
              </div>
              <div style={{ padding: '1rem', backgroundColor: '#EFF6FF', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748B' }}>Webex Telephony Intake</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#004B87' }}>15</div>
              </div>
              <div style={{ padding: '1rem', backgroundColor: '#EFF6FF', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748B' }}>Attested File Imports</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#004B87' }}>3</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'admin' && isAdmin && (
          <div style={{ backgroundColor: '#FFFFFF', padding: '2rem', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
            <h2 style={{ fontSize: '1.25rem', color: '#004B87', marginBottom: '1rem' }}>System Administration & Policies</h2>
            <div
              style={{
                backgroundColor: '#FEF2F2',
                borderLeft: '4px solid #D9381E',
                padding: '1rem',
                marginBottom: '1.5rem',
                fontSize: '0.875rem',
                color: '#991B1B',
              }}
            >
              <strong>Zero Session Access Guarantee:</strong> Administrators have no access to consultation sessions, audio, or case notes.
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
              <dt style={{ fontWeight: 600, color: '#64748B' }}>Environment:</dt>
              <dd style={{ margin: 0, fontWeight: 'bold' }}>{environment.name}</dd>
              <dt style={{ fontWeight: 600, color: '#64748B' }}>GCP Region:</dt>
              <dd style={{ margin: 0, fontWeight: 'bold' }}>{environment.gcpRegion} (London)</dd>
              <dt style={{ fontWeight: 600, color: '#64748B' }}>Active Auth Provider:</dt>
              <dd style={{ margin: 0, fontWeight: 'bold' }}>Microsoft Entra ID (OIDC + PKCE)</dd>
              <dt style={{ fontWeight: 600, color: '#64748B' }}>Session Idle Timeout:</dt>
              <dd style={{ margin: 0, fontWeight: 'bold' }}>15 Minutes</dd>
            </dl>
          </div>
        )}
      </main>

      {/* Consent Gate Modal (Phase 6.1) */}
      {selectedRoute && (
        <ConsentGateModal
          isOpen={isConsentModalOpen}
          route={selectedRoute}
          adviserId={currentUser.id}
          onClose={() => {
            setIsConsentModalOpen(false);
            setSelectedRoute(null);
          }}
          onConsentConfirmed={handleConsentConfirmed}
        />
      )}

      {/* Redaction Review Gate Modal (Phase 9) */}
      <RedactionReviewGateModal
        isOpen={isRedactionGateOpen}
        onClose={() => setIsRedactionGateOpen(false)}
        onProceedSuccess={() => {
          setIsRedactionGateOpen(false);
          setIsVerificationModalOpen(true);
        }}
      />

      {/* Audio Redaction & Verification Modal (Phase 10) */}
      <AudioRedactionVerificationModal
        isOpen={isVerificationModalOpen}
        onClose={() => setIsVerificationModalOpen(false)}
        onVerificationComplete={() => {
          setIsVerificationModalOpen(false);
          setIsCloudSttModalOpen(true);
        }}
        onReturnToGateWithSurvivors={(_survivors) => {
          setIsVerificationModalOpen(false);
          setIsRedactionGateOpen(true);
        }}
      />

      {/* Cloud Speech-to-Text v2 Modal (Phase 11) */}
      <CloudSttModal
        isOpen={isCloudSttModalOpen}
        onClose={() => setIsCloudSttModalOpen(false)}
        onSuccess={(result) => {
          setIsCloudSttModalOpen(false);
          if (session) {
            const alignResult = tokenisationEngine.alignAndTokeniseTranscript(
              result.fullTranscript,
              session.detectedIdentifiers || [],
              session.redactedIntervals || [],
              session.tokenMap || {}
            );
            volatileSessionStore.setWorkingTranscripts(
              alignResult.tokenisedTranscript,
              alignResult.detokenisedTranscript,
              session.tokenMap || {}
            );
          }
        }}
        onFailure={(error) => {
          setIsCloudSttModalOpen(false);
          setCloudSttError(error.message);
          setIsCloudSttFailureModalOpen(true);
        }}
      />

      {/* Cloud STT Failure Choice Modal (Phase 11 - No Silent Fallback) */}
      <CloudSttFailureModal
        isOpen={isCloudSttFailureModalOpen}
        errorMessage={cloudSttError}
        onRetry={() => {
          setIsCloudSttFailureModalOpen(false);
          setIsCloudSttModalOpen(true);
        }}
        onProceedWithLocalTranscript={() => {
          volatileSessionStore.setFallbackToLocalTranscript(
            cloudSttError || 'Adviser chose Pass 1 local transcript after Cloud STT error.'
          );
          if (session) {
            const rawLocal = session.localDraftTranscript || '';
            const alignResult = tokenisationEngine.alignAndTokeniseTranscript(
              rawLocal,
              session.detectedIdentifiers || [],
              session.redactedIntervals || [],
              session.tokenMap || {}
            );
            volatileSessionStore.setWorkingTranscripts(
              alignResult.tokenisedTranscript,
              alignResult.detokenisedTranscript,
              session.tokenMap || {}
            );
          }
          setIsCloudSttFailureModalOpen(false);
        }}
        onCancel={() => {
          setIsCloudSttFailureModalOpen(false);
        }}
      />

      {/* Destructive Logout Modal */}
      <LogoutModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onLoggedOut={() => {
          setIsLogoutModalOpen(false);
          setCurrentUser(null);
          handleWithdrawConsent();
        }}
      />
    </div>
  );
};
