# Accessibility Conformance Report (WCAG 2.2 Level AA)

**Document Reference**: DOC-10  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**Standard**: W3C Web Content Accessibility Guidelines (WCAG) 2.2 Level AA  
**Evaluation Standard**: Voluntary Product Accessibility Template (VPAT / EN 301 549)  
**Evaluation Date**: 2026-09-02  
**Status**: Conforms to WCAG 2.2 Level AA  
**Classification**: Official-Sensitive / Governance Pack  

---

## 1. Executive Summary & Accessibility Commitment

Citizens Advice Wandsworth is committed to providing an inclusive, accessible tool for all advisers, including disabled advisers, neurodivergent staff, and volunteers using assistive technologies. Case Ace v2.0 has been designed and tested in compliance with **WCAG 2.2 Level AA**.

### Assistive Technologies Tested
* **Screen Readers**: Apple VoiceOver (macOS Sonoma / Safari), NVDA 2024.2 (Windows 11 / Chrome), JAWS 2024.
* **Keyboard-Only Navigation**: 100% operable without mouse/touch interaction.
* **Display Configurations**: Tested at 200% browser zoom, Windows High Contrast Mode, and macOS Reduced Motion mode.
* **Automated Tooling**: axe-core 4.9.1, Lighthouse Accessibility Audit (Score: 100/100).

---

## 2. WCAG 2.2 Level AA Conformance Matrix

| WCAG 2.2 Criterion | Level | Implementation in Case Ace v2.0 | Conformance Result |
| :--- | :---: | :--- | :--- |
| **1.1.1 Non-text Content** | A | All interactive icons, audio waveform visualisers, and status chips provide programmatic `aria-label` and `aria-hidden="true"` where purely decorative. | **Supports** |
| **1.3.1 Info and Relationships** | A | Semantic HTML5 structure (`<main>`, `<header>`, `<nav>`, `<section>`, `<h1>`-`<h3>`). Form controls explicitly associated with `<label>` elements. | **Supports** |
| **1.3.2 Meaningful Sequence** | A | DOM sequence strictly matches visual presentation sequence, ensuring logical reading order for screen readers. | **Supports** |
| **1.4.1 Use of Color** | A | Status indicators (e.g. Redaction confidence, Safeguarding flags, Gap alerts) use icons, bold text labels, and patterns in addition to color. | **Supports** |
| **1.4.3 Contrast (Minimum)** | AA | Text-to-background contrast ratio exceeds **4.5:1** (body text: 7.2:1, headings: 12.1:1). | **Supports** |
| **1.4.11 Non-text Contrast** | AA | UI component boundaries, focus rings, and interactive buttons exceed **3.0:1** contrast ratio against adjacent backgrounds. | **Supports** |
| **1.4.12 Text Spacing** | AA | Content adapts without clipping or horizontal scrolling when line height is increased to 1.5x and paragraph spacing to 2x. | **Supports** |
| **2.1.1 Keyboard Navigation** | A | All actions (Recording start/stop, transcript scrubbing, redaction entity toggle, gap acknowledgement, sign-off) are 100% keyboard operable. | **Supports** |
| **2.1.2 No Keyboard Trap** | A | Focus can be moved into and out of all dialogs, review modals, and transcript regions using standard `Tab` and `Shift+Tab` keys. | **Supports** |
| **2.4.3 Focus Order** | A | Logical tab order preserved through all stages: Intake &rarr; Recording &rarr; Review Gate &rarr; Sign-off. | **Supports** |
| **2.4.7 Focus Visible** | AA | High-visibility 3px focus rings (`outline: 3px solid #004b87; outline-offset: 2px`) present on all interactive elements. | **Supports** |
| **2.4.11 Focus Not Obscured** | AA | Sticky headers, review toolbars, and action drawers never obscure the currently focused interactive element. | **Supports** |
| **2.5.7 Dragging Movements** | AA | All timeline scrubber and redaction range adjustments support single-pointer click and arrow-key stepping alternatives. | **Supports** |
| **2.5.8 Target Size (Minimum)** | AA | All touch and click targets have a minimum dimension of **24 &times; 24 CSS pixels** with adequate spacing (default buttons $\ge 44 \times 44\text{px}$). | **Supports** |
| **3.2.1 On Focus** | A | Receiving focus does not initiate unexpected context changes or auto-submission. | **Supports** |
| **3.3.1 Error Identification** | A | Validation errors (e.g. Missing consent, unacknowledged gaps) are clearly identified in text and announced via `aria-live="assertive"`. | **Supports** |
| **3.3.7 Redundant Entry** | A | Client information entered during intake (e.g. intake route, topic) is automatically populated across subsequent drafting stages. | **Supports** |
| **3.3.8 Accessible Authentication** | AA | SSO login via Microsoft Entra ID supports passwordless FIDO2 security keys, TOTP authenticator apps, and standard WebAuthn. | **Supports** |
| **4.1.2 Name, Role, Value** | A | All custom UI widgets (Redaction Chips, Audio Review Gate, Safeguarding Drawer) use standard ARIA roles (`role="switch"`, `role="region"`, `aria-expanded`). | **Supports** |
| **4.1.3 Status Messages** | AA | Live transcription updates and verification results use `aria-live="polite"` regions so screen readers receive updates without interruption. | **Supports** |

---

## 3. Dedicated Keyboard Shortcuts for Advisers

To optimize workflow efficiency for advisers with motor disabilities, Case Ace v2.0 provides global, customizable keyboard shortcuts:

| Shortcut (macOS / Windows) | Action | Target Component |
| :--- | :--- | :--- |
| `Space` (when focused on audio) | Play / Pause Consultation Audio | Audio Player |
| `Left / Right Arrow` | Skip 5 Seconds Backward / Forward | Audio Player |
| `Alt + R` / `Option + R` | Toggle Redaction on Selected Word | Redaction Gate |
| `Alt + G` / `Option + G` | Jump to Next Unacknowledged Gap | Adviser Review |
| `Alt + S` / `Option + S` | Jump to Safeguarding Panel | Safeguarding Drawer |
| `Escape` | Dismiss Modal / Return Focus | Active Modal |
