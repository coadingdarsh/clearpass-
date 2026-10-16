Paste this into Claude Code after opening the clearpass folder in VS Code:

---

Read CLAUDE.md, engine.js, app.js, index.html and voice-fill.js in this folder. This is ClearPass, my submission for the OLG Gold track at ThunderHacks II. It's already working end to end. I present tomorrow at 12:30 PM and submissions close at noon, so don't restructure anything. Help me make it demo-ready.

Do these in order, and tell me after each one what changed and why, in plain language:

1. Run `node -e "const E=require('./engine.js'); const d=E.generate(2026); const v=E.validate(E.assessAll(d.players,d.txs,d.asOf).results); console.log(v.tp, v.fp, v.singleRule)"` and confirm the output is `20 2 { alerts: 33, falsePositives: 13 }`. If it isn't, find out why before touching anything else.
2. Start Live Server, walk through the bank sign-up path, choose the "Pass-through" simulation, and check the new player appears at the top of the analyst queue as High. Fix any console errors.
3. Check keyboard-only use: Tab through the sign-up and the analyst workbench. Every control must be reachable, have a visible focus ring, and make sense when read by NVDA. Fix anything that doesn't.
4. Do not change the scoring rules in CLAUDE.md (tiers by number of red flags, no alert for a single transaction under $10,000, accessibility signals never scored) unless I ask.
5. Finish by giving me a 60-second list of the exact clicks for my demo, in this order: accessible sign-up → simulate pass-through → analyst case → a Low "VPN at work" case to show it's not an alert → linked-account (mule) case with the graph → Rule validation tab.
