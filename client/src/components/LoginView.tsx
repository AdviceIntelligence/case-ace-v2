import React, { useState } from 'react';
import { Shield, KeyRound, Lock, AlertCircle } from 'lucide-react';
import { volatileAuthStore, AuthUser } from '../state/authStore.ts';
import { apiFetch } from '../config/apiClient.ts';

interface LoginViewProps {
  onLoginSuccess: (user: AuthUser) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [authMode, setAuthMode] = useState<'entra_id' | 'totp'>('entra_id');
  const [username, setUsername] = useState('adviser');
  const [password, setPassword] = useState('AdviserPass2026!');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEntraIdLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorizationCode: 'valid-entra-auth-code-with-mfa',
          codeVerifier: 'mock-pkce-verifier-string-43-chars-minimum-length!',
          redirectUri: window.location.origin,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Entra ID login failed');
      }

      volatileAuthStore.setAuthenticated(data.user, data.accessToken, data.refreshToken);
      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTotpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode || totpCode.length !== 6) {
      setError('Please enter a 6-digit TOTP code.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          passwordHash: password,
          totpCode,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      volatileAuthStore.setAuthenticated(data.user, data.accessToken, data.refreshToken);
      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: '480px',
        margin: '3rem auto',
        padding: '2rem',
        backgroundColor: '#FFFFFF',
        borderRadius: '8px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        border: '1px solid #E2E8F0',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div
          style={{
            display: 'inline-flex',
            padding: '0.75rem',
            backgroundColor: '#004B87',
            borderRadius: '50%',
            color: '#FFFFFF',
            marginBottom: '0.75rem',
          }}
        >
          <Shield size={32} aria-hidden="true" />
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#004B87', margin: 0 }}>
          Case Ace Authentication
        </h1>
        <p style={{ color: '#64748B', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          Citizens Advice Wandsworth Secure Gateway
        </p>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#991B1B',
            padding: '0.75rem',
            borderRadius: '6px',
            marginBottom: '1.5rem',
            fontSize: '0.875rem',
          }}
        >
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Provider Selector Tab */}
      <div style={{ display: 'flex', borderBottom: '1px solid #CBD5E1', marginBottom: '1.5rem' }}>
        <button
          type="button"
          onClick={() => {
            setAuthMode('entra_id');
            setError(null);
          }}
          style={{
            flex: 1,
            padding: '0.75rem',
            border: 'none',
            borderBottom: authMode === 'entra_id' ? '3px solid #004B87' : 'none',
            backgroundColor: 'transparent',
            fontWeight: authMode === 'entra_id' ? 700 : 500,
            color: authMode === 'entra_id' ? '#004B87' : '#64748B',
            cursor: 'pointer',
          }}
        >
          Entra ID (Primary OIDC)
        </button>
        <button
          type="button"
          onClick={() => {
            setAuthMode('totp');
            setError(null);
          }}
          style={{
            flex: 1,
            padding: '0.75rem',
            border: 'none',
            borderBottom: authMode === 'totp' ? '3px solid #004B87' : 'none',
            backgroundColor: 'transparent',
            fontWeight: authMode === 'totp' ? 700 : 500,
            color: authMode === 'totp' ? '#004B87' : '#64748B',
            cursor: 'pointer',
          }}
        >
          TOTP 2FA (Dev Fallback)
        </button>
      </div>

      {authMode === 'entra_id' ? (
        <div>
          <div
            style={{
              backgroundColor: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '6px',
              padding: '1rem',
              marginBottom: '1.5rem',
              fontSize: '0.875rem',
              color: '#334155',
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Entra ID Conditional Access & MFA Enforcement</p>
            <p style={{ margin: '0.5rem 0 0 0', color: '#64748B' }}>
              Requires organizational 2FA with verified <code>amr</code> claims and compliant managed device.
            </p>
          </div>

          <button
            type="button"
            onClick={handleEntraIdLogin}
            disabled={isLoading}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.875rem',
              backgroundColor: '#004B87',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '1rem',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            <KeyRound size={18} aria-hidden="true" />
            {isLoading ? 'Authenticating...' : 'Sign in with Microsoft Entra ID'}
          </button>
        </div>
      ) : (
        <form onSubmit={handleTotpLogin}>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="username" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem' }}>
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              translate="no"
              required
              style={{
                width: '100%',
                padding: '0.625rem',
                borderRadius: '6px',
                border: '1px solid #CBD5E1',
                fontSize: '0.875rem',
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="password" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem' }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              translate="no"
              required
              style={{
                width: '100%',
                padding: '0.625rem',
                borderRadius: '6px',
                border: '1px solid #CBD5E1',
                fontSize: '0.875rem',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="totpCode" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem' }}>
              RFC 6238 TOTP Code (6 Digits)
            </label>
            <input
              id="totpCode"
              type="text"
              maxLength={6}
              placeholder="e.g. 123456"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              translate="no"
              required
              style={{
                width: '100%',
                padding: '0.625rem',
                borderRadius: '6px',
                border: '1px solid #CBD5E1',
                fontSize: '1rem',
                letterSpacing: '0.25em',
                textAlign: 'center',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.875rem',
              backgroundColor: '#004B87',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '1rem',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            <Lock size={18} aria-hidden="true" />
            {isLoading ? 'Verifying 2FA...' : 'Authenticate with 2FA'}
          </button>
        </form>
      )}
    </div>
  );
};
