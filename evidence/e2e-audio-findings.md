# End-to-End Audio Pipeline Test: Findings

**Date**: 4 September 2026
**Scenario**: S01 Doris Campbell, Attendance Allowance. 42.6 minutes, full length.
**Corpus**: synthetic. Production notes confirm all clients, addresses, National Insurance
numbers, employers and telephone numbers are fictional, with numbers from the Ofcom drama range.
**Harness**: `scripts/e2e-audio-full.mjs`

---

## Headline

**A spoken National Insurance number, the client's full name and her date of birth were
transmitted to Google Cloud Speech-to-Text in the clear.**

The redaction pipeline ran, muted 60 seconds of audio across 49 ranges, and did not touch
any of them. This is the exact outcome DPIA-02 and Constraint C4 state cannot occur.

The mechanism is sound: a telephone number in the same recording was detected, muted and
confirmed absent from the redacted audio. The failure is in the identifier matchers, not in
the redaction or audio handling.

---

## Method

1. Transcribe the full consultation with word-level timings (pass one).
2. Run all three detection layers over that transcript.
3. Project detections onto audio time ranges and **zero those PCM samples**.
4. Transcribe the redacted audio (pass two). This is what the cloud actually receives.
5. Compare ground truth identifiers, taken from the scenario script, against pass two.

Only identifiers genuinely audible in pass one can be said to have been redacted or to have
survived. Anything not audible is reported as untested rather than as a pass.

> **Substitution.** In production, pass one runs in the adviser's browser using Whisper
> compiled to WebAssembly, so raw audio never leaves the device. That cannot run in Node, so
> pass one here was performed by Cloud Speech-to-Text. Unredacted audio was therefore sent to
> the cloud during this test, which is acceptable only because the corpus is synthetic. A
> browser-driven test is still required to show the local pass behaves the same way.

---

## Results

| Ground truth identifier | Audible in pass one | Present in redacted audio | Verdict |
| :--- | :--- | :--- | :--- |
| NINO `ZX 48 62 19 D` | yes | **yes** | **SURVIVED** |
| Phone `07700 900342` | yes | no | Redacted correctly |
| Postcode `SW9 8TR` | no | no | Untested, not spoken |

Pass one: 5,346 words. Pass two: 5,223 words. 50 identifiers detected (10 structured,
35 unstructured, 5 special category). 60s of 2,555s muted across 49 ranges.

What the cloud received, verbatim from the pass two transcript:

> "Can I take the clients full name date of birth and national insurance number? **Doris Mae
> Campbell. 14th of the second 1945.** And the National Insurance number... **z x-48 62 1 9 d**"

---

## Cause 1: dictated identifiers do not match written-form patterns

A National Insurance number read aloud is transcribed as `z x 48  62  19d`: letters
separated, digits grouped as the speaker paused, lower case. The Layer 1 structured matcher
expects the written form `ZX 48 62 19 D`. Run directly against the transcript it returns
**zero NINO matches**, and full detection found **nothing within 400 characters** of where
the number appears.

The same applies to the date of birth. The client says "14th of the second 1945". The
matcher expects `14 February 1945` or `14/02/1945`. Zero detections for `1945`.

This is not an edge case. Dictation is the normal way these are spoken in an advice
interview, because the adviser is reading them onto a form.

## Cause 2: the structured matcher fires on ordinary English words

Of 10 Layer 1 matches, 6 were false positives, all classified `home_office_reference`:

| Matched text | Times |
| :--- | :--- |
| "honestly" | 4 |
| "hospital" | 2 |
| "household" | 1 |

Two harms. It mutes ordinary speech, degrading the transcript the case note is drafted
from. And it fills the adviser review gate with obvious nonsense, which is how people learn
to click through a safety control without reading it. A gate that cries wolf is worse than
no gate, because it carries the same assurance in the DPIA.

## Cause 3: the client is classified as a third party

"Doris" and "Campbell" were detected, but as `third_party_name`. Whether that is intended
under the equal-priority rule should be confirmed, since it affects how the surrogate tokens
are grouped and how the note reads back.

---

## What this does not show

Only one scenario has been run, and only one of its three ground truth identifiers was
testable. The corpus has 43 recordings covering Scottish, Welsh, Scouse, Geordie, Polish,
Punjabi, Somali and Spanish speakers, dysarthria, background noise and interpreter relay.
The failure modes above will behave differently across those, and spoken-form failures are
likely to be worse where an interpreter repeats an identifier in another language.

This run also says nothing about the acoustic verification pass (Phase 10), which is
designed to re-transcribe muted audio and abort if a survivor is found. On this evidence it
would have had a survivor to catch. Whether it does is a separate test.

---

## Recommendation

The redaction machinery works. The matchers do not yet cover how people actually speak.

1. Extend Layer 1 to spoken forms: spaced and spelled letters, digits grouped arbitrarily,
   "double seven", "oh" for zero, and dates spoken as "the fourteenth of the second".
2. Fix the `home_office_reference` pattern, which is matching common words.
3. Re-run this harness across a representative spread of the corpus, including at least one
   interpreter-relay and one strong-accent scenario.
4. Confirm whether the Phase 10 acoustic verification pass catches what Layer 1 misses. If
   it does, it is doing more work than the design credits it with. If it does not, the
   fail-closed claim needs revisiting.

Until 1 and 2 are done and re-measured, the pilot should not process a real consultation.
