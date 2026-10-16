# ClearPass

Accessible player sign-up and pattern-based AML monitoring for online gaming.
Built for the **OLG Gold track** at **ThunderHacks II**: *Intelligent Player Protection & Fraud Detection*.

## The idea

ClearPass has two sides that share one piece of data:

1. **Player sign-up.** Identity verification that works for blind and low-vision players: spoken camera guidance, filling the form by voice, or verifying through your bank. The bank chosen at sign-up becomes the player's **verified bank**.
2. **Analyst workbench.** AML monitoring that flags **combinations** of red flags, not single signals. One odd thing (like a VPN left on after work) doesn't get an innocent player alerted.

**How the two connect:** the verified bank is the baseline. Deposits from, or withdrawals to, a different bank are red flags.

## How to run it

No install and no build step. It's plain HTML and JavaScript.

1. Clone the repo and open the folder in VS Code.
2. Right-click `index.html` and choose **Open with Live Server**. The camera needs `localhost` or HTTPS.
3. Use Chrome or Edge, because voice form filling uses the browser's speech recognition.

The detection engine also runs on its own in Node:

```
node -e "const E=require('./engine.js'); const d=E.generate(2026); console.log(E.validate(E.assessAll(d.players,d.txs,d.asOf).results))"
```

## What you can try

| Tab | What it shows |
|---|---|
| **Player sign-up** | Accessible verification by camera, voice or bank. At the end you can simulate a behaviour (e.g. pass-through) and watch the new player appear in the analyst queue. |
| **Analyst workbench** | Case queue sorted by risk. Each case shows the evidence, a money in/out map, a linked-account graph, the recommended action, FINTRAC reporting duties and a draft STR narrative. |
| **Rule validation** | Pattern-based alerts compared with a naive "alert on any single red flag" rule, on the same synthetic data. |

## How scoring works

**Tier = number of red flags.** Weights only order cases inside a tier.

| Red flags | Tier | Score | Action |
|---|---|---|---|
| 0 | Clear | 0 | None |
| 1 | Low | 10–29 | Monitor quietly, no alert |
| 2 | Medium | 30–59 | Level 1 review |
| 3+ | High | 60–100 | Level 2 investigation, consider an STR |

- A single transaction under $10,000 never alerts on its own. It only counts inside a pattern, e.g. several deposits in 24 hours, each under $10,000, totalling $10,000 or more.
- **Reporting is separate from suspicion.** A payout of $10,000+ (single, or within 24 hours) needs a Casino Disbursement Report within 15 calendar days, even when nothing is suspicious.
- **Never scored:** assistive technology, session length, photo retries, keyboard-only use, verification method, age, gender, disability.
- **Player protection** (late-night rapid re-deposits) goes to a separate queue for the responsible gambling team, not into the AML score.

### The 11 red flags

Location (VPN or outside Ontario) · linked accounts (shared device or payout account) · deposits from another bank · third-party card · 3+ cards · withdrawals to another bank · minimal play before cash-out · spike against the player's own history and peers · dormant then sudden deposits · structuring under $10,000 in 24 hours · money in and out within 24 hours.

### Named patterns

Bank AML typologies rebuilt for gaming: **pass-through**, **structuring around the 24-hour rule**, **third-party funding**, **linked-account (mule) network**, **activity inconsistent with profile**.

Context comes from each player's own 9-month baseline and the 90th percentile of their peers.

## Results on synthetic data

182 players and about 32,700 transactions, with 20 planted suspicious cases and 162 normal or innocent-but-unusual players.

| | Alerts | False positives |
|---|---|---|
| Naive rule (any single red flag alerts) | 33 | 13 |
| **ClearPass (pattern-based)** | **22** | **2** |

All 20 planted cases reach Medium or High. Innocent look-alikes stay out of the alert queue: VPN at work and a second personal bank land in Low (monitored, not alerted), while high rollers and jackpot winners stay Clear. The 2 false positives are players funding with a spouse's card, which is a reasonable thing for a level 1 analyst to check.

## Files

| File | Purpose |
|---|---|
| `index.html` | Layout and styles |
| `engine.js` | Synthetic data, red flags, patterns, tiers, validation, FINTRAC reports, STR draft. Pure logic, no UI. |
| `app.js` | UI: sign-up flow, analyst workbench, rule validation tab |
| `voice-fill.js` | Fill the details form by voice (Chrome/Edge) |

## Known limits

- Synthetic data only. Because the suspicious cases are planted, recall looks perfect; real data would be harder.
- Card detection is a heuristic, the face check is motion only, and bank verification is mocked.
- Chrome's speech recognition sends audio to Google. Production would need on-device recognition.

## Author

Darsh, CS (Honours), Algoma University Brampton.
