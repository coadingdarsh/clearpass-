# ClearPass – project context

## What this is
ClearPass is one product for the OLG Gold track at ThunderHacks II ("Intelligent Player Protection & Fraud Detection"), with two sides:
1. **Player sign-up** – accessible identity verification for blind and low-vision players (spoken camera guidance, voice form filling, or verify through your bank). The bank chosen at sign-up becomes the player's **verified bank**.
2. **Analyst workbench** – pattern-based AML monitoring. It flags combinations of red flags instead of single signals, so innocent players aren't punished for one odd thing (like a VPN left on after work).

Link between the two: the verified bank from sign-up is the baseline. Deposits from or withdrawals to a different bank are red flags.

## Files
- `index.html` – layout and styles
- `engine.js` – synthetic data, red flags, patterns, tiers, validation, FINTRAC reports, STR draft. Pure logic, runs in Node too (`node -e "require('./engine.js')"`).
- `app.js` – UI: sign-up flow, analyst workbench, rule validation tab
- `voice-fill.js` – fill the details form by voice (Chrome/Edge)
Run with VS Code Live Server (camera needs localhost or HTTPS).

## Scoring rules (do not change without reason)
- Tier = number of red flags: 0 Clear, 1 Low (monitor quietly, no alert), 2 Medium (level 1 review), 3+ High (level 2 investigation, consider an STR).
- Score bands: Clear 0, Low 10–29, Medium 30–59, High 60–100. Weights only order cases inside a tier.
- A single transaction under $10,000 never alerts on its own. It only counts inside a pattern (e.g. several deposits in 24 hours, each under $10,000, totalling $10,000+).
- Reporting duties are separate from suspicion: a payout of $10,000+ (single, or within 24 hours) needs a Casino Disbursement Report within 15 calendar days, even when nothing is suspicious.
- Never scored: assistive technology, session length, photo retries, keyboard-only use, verification method, age, gender, disability.
- Player protection (late-night rapid re-deposits) goes to a separate queue for the responsible gambling team, not into the AML score.

## Red flags (11)
Location (VPN/outside Ontario), linked accounts (shared device or payout account), deposits from another bank, third-party card, 3+ cards, withdrawals to another bank, minimal play before cash-out, spike vs own history and peers, dormant then sudden deposits, structuring under $10,000 in 24 hours, money in and out within 24 hours.

## Named patterns (bank typologies rebuilt for gaming)
Pass-through, structuring around the 24-hour rule, third-party funding, linked-account (mule) network, activity inconsistent with profile.

## OLG rubric mapping
Detection (red flags) · Contextual risk (own 9-month baseline + peer 90th percentile) · Prioritization (tiered score, sorted queue) · Investigator experience (evidence, money in/out map, linked-account graph, recommended action, STR draft) · Demo (synthetic data, runs live) · Bonus: synthetic data, rule validation tab, recommendations, network analysis, unified dashboard.

## Known limits
Synthetic data only; planted cases make recall look perfect. Card detection is a heuristic; face check is motion only; bank verification is mocked. Chrome speech recognition sends audio to Google, so production would need on-device recognition.

## About me (Darsh)
CS (Honours), Algoma University Brampton. Strong in Python and data analysis, moderate in JS. Keep code readable and explain changes plainly so I can defend every part in judging Q&A. Submissions close noon Oct 16; judging 12:30–2:30 PM.
