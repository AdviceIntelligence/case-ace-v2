/**
 * Tailwind was never installed, yet RedactionReviewGateModal.tsx and TranscriptProgressModal.tsx
 * were written entirely in Tailwind utility classes. Those classes compiled to nothing, so the
 * two screens rendered as unstyled HTML with default browser form controls. One of them is the
 * redaction review gate: the single screen where an adviser decides what is hidden.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Used by the review gate; not part of Tailwind's default scale.
        'slate-850': '#172033',
      },
    },
  },
  plugins: [],
};
