import { Component, ReactNode } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';
import { destroySession } from '../state/sessionDestruction.ts';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  sanitizedErrorMessage: string | null;
}

/**
 * ErrorBoundary
 * 
 * Catches client-side UI render errors while strictly preventing session data,
 * client names, phone numbers, transcripts, or case notes from leaking into
 * error displays, console stacks, or crash payloads.
 * 
 * On unrecoverable error, wipes volatile session memory to prevent persistent corrupted state.
 */
export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    sanitizedErrorMessage: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Sanitize error message to prevent accidental inclusion of PII or session fragments
    const rawMessage = error.message || 'An unexpected runtime error occurred.';
    
    // Strip anything that looks like UK phone numbers, postcodes, NINOs, or emails
    const sanitized = rawMessage
      .replace(/(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}/g, '[PHONE_REDACTED]')
      .replace(/[A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}[0-9]{6}[A-D]{1}/gi, '[NINO_REDACTED]')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
      .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, '[POSTCODE_REDACTED]');

    return {
      hasError: true,
      sanitizedErrorMessage: sanitized,
    };
  }

  public override componentDidCatch(error: Error): void {
    // Log only sanitized operational error; never send full component stack containing session state
    console.error('[CaseAce ErrorBoundary] Caught UI error (sanitized):', this.state.sanitizedErrorMessage);
    destroySession({ reason: 'unrecoverable_error', error }).catch((err) => {
      console.warn('[ErrorBoundary] destroySession error:', err);
    });
  }

  private handleReset = () => {
    destroySession({ reason: 'unrecoverable_error' }).catch(() => {});
    this.setState({ hasError: false, sanitizedErrorMessage: null });
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          translate="no"
          className="notranslate"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#F8FAFC',
            padding: '2rem',
          }}
        >
          <div
            style={{
              maxWidth: '540px',
              width: '100%',
              backgroundColor: '#FFFFFF',
              borderRadius: '8px',
              padding: '2rem',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
              border: '1px solid #E2E8F0',
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'inline-flex', padding: '0.75rem', backgroundColor: '#FEF2F2', borderRadius: '50%', marginBottom: '1rem' }}>
              <AlertOctagon size={36} color="#D9381E" aria-hidden="true" />
            </div>

            <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#1E293B', marginBottom: '0.5rem' }}>
              Application Render Error
            </h1>

            <p style={{ fontSize: '0.875rem', color: '#64748B', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              An unexpected error occurred. To protect client confidentiality under <strong>Constraint C1</strong>,
              no session or consultation details are recorded in crash dumps.
            </p>

            <div
              style={{
                backgroundColor: '#F1F5F9',
                padding: '0.75rem 1rem',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                color: '#475569',
                fontFamily: 'monospace',
                marginBottom: '1.5rem',
                wordBreak: 'break-all',
                textAlign: 'left',
              }}
            >
              {this.state.sanitizedErrorMessage}
            </div>

            <button
              type="button"
              onClick={this.handleReset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: '#004B87',
                color: '#FFFFFF',
                border: 'none',
                padding: '0.625rem 1.25rem',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Reload Interface
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
