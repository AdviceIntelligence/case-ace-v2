import React, { useState, useEffect } from 'react';
import {
  volatileSessionStore,
  type SessionState,
  type DetectedIdentifier,
  type IdentifierCategory,
} from '../state/volatileStore.ts';
import { executeAffirmativeProceed } from '../redaction/redactionGateManager.ts';

/**
 * Check what gets hidden.
 *
 * This screen used to run to six hundred lines across four tabs: low-confidence regions to
 * audition one by one, categorised redactions, manual entry with an audio time range, and an
 * outbound disclosure payload. An adviser could not get past it without acknowledging every
 * word the recogniser was unsure about, and there was nowhere to correct any of them.
 *
 * It now does one thing. Here is what we are about to hide; keep it or don't; add anything we
 * missed. Everything else in the consultation goes through untouched.
 */

interface RedactionReviewGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProceedSuccess: (tokenisedPayload: string) => void;
}

/** What each category is called on screen. No category codes, no layer numbers. */
const CATEGORY_LABELS: Partial<Record<IdentifierCategory, string>> = {
  client_name: 'Name',
  third_party_name: 'Name',
  child_name: 'Child',
  partner_name: 'Partner',
  ex_partner_name: 'Ex-partner',
  landlord_name: 'Landlord',
  employer_name: 'Employer',
  support_worker_name: 'Support worker',
  official_name: 'Official',
  date_of_birth: 'Date of birth',
  street_address: 'Address',
  uk_postcode: 'Postcode',
  phone_number: 'Phone',
  email_address: 'Email',
  national_insurance: 'NI number',
};

const ADD_CATEGORIES: IdentifierCategory[] = [
  'third_party_name',
  'date_of_birth',
  'street_address',
  'phone_number',
  'email_address',
  'national_insurance',
];

export const RedactionReviewGateModal: React.FC<RedactionReviewGateModalProps> = ({
  isOpen,
  onClose,
  onProceedSuccess,
}) => {
  const [session, setSession] = useState<SessionState | null>(volatileSessionStore.getState());
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<IdentifierCategory>('third_party_name');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => volatileSessionStore.subscribe((s) => setSession(s ? { ...s } : null)), []);

  useEffect(() => {
    if (isOpen) volatileSessionStore.openRedactionGate();
  }, [isOpen]);

  if (!isOpen || !session) return null;

  const identifiers = session.detectedIdentifiers || [];
  const hiding = identifiers.filter((i) => i.adviserDecision !== 'rejected');

  const toggle = (item: DetectedIdentifier) => {
    item.adviserDecision = item.adviserDecision === 'rejected' ? 'accepted' : 'rejected';
    volatileSessionStore.updateState({ detectedIdentifiers: [...identifiers] });
  };

  const addOwn = () => {
    const text = newText.trim();
    if (!text) return;

    const transcript = session.transcript?.fullTranscript || '';
    const start = transcript.indexOf(text);

    volatileSessionStore.addManualRedaction({
      id: `own_${Date.now()}`,
      text,
      charOffset: { start: Math.max(0, start), end: start === -1 ? 0 : start + text.length },
      audioTimeRange: { startSec: 0, endSec: 0 },
      category: newCategory,
      detectionLayer: 2,
      confidence: 1,
      proposedAction: 'redact',
      adviserDecision: 'accepted',
      surrogateToken: `[${(CATEGORY_LABELS[newCategory] || 'HIDDEN').toUpperCase().replace(/\s+/g, '_')}_${Date.now().toString().slice(-4)}]`,
    });
    setNewText('');
  };

  const proceed = () => {
    setErrorMessage(null);
    const result = executeAffirmativeProceed(true);
    if (result.success) {
      onProceedSuccess(result.tokenisedPayload);
      onClose();
    } else {
      setErrorMessage(result.error || 'Could not continue.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Check what gets hidden</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {hiding.length === 0
              ? 'Nothing personal was found. Nothing will be hidden.'
              : `${hiding.length} ${hiding.length === 1 ? 'thing' : 'things'} will be replaced before the note is written. Everything else goes through as it is.`}
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {identifiers.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              No names, dates of birth, addresses, phone numbers, emails or NI numbers were found.
            </p>
          ) : (
            <ul className="space-y-2">
              {identifiers.map((item) => {
                const kept = item.adviserDecision === 'rejected';
                return (
                  <li
                    key={item.id}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                      kept ? 'border-slate-200 bg-slate-50' : 'border-blue-200 bg-blue-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-slate-900 break-words">{item.text}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {CATEGORY_LABELS[item.category] || 'Personal detail'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(item)}
                      className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${
                        kept
                          ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {kept ? 'Keeping' : 'Hiding'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-5 pt-4 border-t border-slate-200">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Missed something?
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addOwn()}
                placeholder="Type it exactly as it appears"
                spellCheck={false}
                autoComplete="off"
                className="flex-1 min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as IdentifierCategory)}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                {ADD_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addOwn}
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="px-6 py-2 text-sm text-red-700 bg-red-50 border-t border-red-200">
            {errorMessage}
          </div>
        )}

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Back
          </button>
          <button
            type="button"
            onClick={proceed}
            className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Write the note
          </button>
        </div>
      </div>
    </div>
  );
};
