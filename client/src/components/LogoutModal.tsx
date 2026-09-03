import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { volatileAuthStore } from '../state/authStore.ts';
import { destroySession } from '../state/sessionDestruction.ts';

interface LogoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoggedOut: () => void;
}

export const LogoutModal: React.FC<LogoutModalProps> = ({ isOpen, onClose, onLoggedOut }) => {
  if (!isOpen) return null;

  const handleConfirmLogout = async () => {
    await destroySession({ reason: 'logout' });
    volatileAuthStore.clearAuth();
    onLoggedOut();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '8px',
          maxWidth: '540px',
          width: '100%',
          padding: '2rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          border: '2px solid #D9381E',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <AlertTriangle size={28} color="#D9381E" aria-hidden="true" />
          <h2 id="logout-dialog-title" style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#1E293B', margin: 0 }}>
            Confirm Destructive Logout
          </h2>
        </div>

        <p style={{ color: '#334155', lineHeight: '1.5', marginBottom: '1.25rem' }}>
          <strong>Attention:</strong> Logging out will immediately and <strong>permanently erase</strong> all consultation audio,
          real-time transcript text, tokenisation mappings, and unsaved draft case notes currently in memory.
        </p>

        <div
          style={{
            backgroundColor: '#FEF2F2',
            borderLeft: '4px solid #D9381E',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            fontSize: '0.875rem',
            color: '#991B1B',
          }}
        >
          Per privacy constraint C1 & C3, no session recovery is possible. Any text not copied into Casebook will be irrecoverably destroyed.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '6px',
              border: '1px solid #CBD5E1',
              backgroundColor: '#F8FAFC',
              color: '#334155',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel & Return to Session
          </button>
          <button
            type="button"
            onClick={handleConfirmLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.625rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#D9381E',
              color: '#FFFFFF',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            Permanently Erase & Log Out
          </button>
        </div>
      </div>
    </div>
  );
};
