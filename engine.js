/*
  engine.js — ClearPass pattern-based AML engine (synthetic data only)

  Core idea: one red flag is not suspicion. People use VPNs for work and
  have accounts at two banks. Risk comes from red flags that corroborate
  each other, the way bank AML teams read typologies.

    0 red flags  -> Clear
    1 red flag   -> Low     (monitor quietly, no alert, no customer friction)
    2 red flags  -> Medium  (level 1 analyst review)
    3+ red flags -> High    (level 2 investigation, consider a suspicious transaction report)

  A single transaction under $10,000 never raises an alert by itself.
  It only counts when it is part of a pattern (for example, several
  deposits under $10,000 inside 24 hours that add up to more).

  Reporting duties (FINTRAC) are tracked separately from suspicion.
  A $25,000 jackpot payout must be reported, but it is not suspicious.
*/
(function (root) {
  "use strict";

  const DAY = 86400000;
  const HOUR = 3600000;
  const NOW = Date.UTC(2026, 9, 15, 16, 0, 0); // fixed "as of" time so the demo is repeatable
  const WINDOW_DAYS = 90;
  const BANKS = ["RBC", "TD", "Scotiabank", "BMO", "CIBC", "Desjardins", "Tangerine"];
  const REPORT_THRESHOLD = 10000;

  // ---------------------------------------------------------------
  // Red flags. Each one is a single observable fact. None of them
  // means "launderer" alone.
  // ---------------------------------------------------------------
  const FLAGS = {
    LOCATION:      { family: "Location",        weight: 3,  label: "VPN, proxy, or location outside Ontario" },
    LINKED:        { family: "Linked accounts", weight: 9,  label: "Shares a device or payout account with other players" },
    NEW_BANK:      { family: "Funding source",  weight: 5,  label: "Deposits from a bank other than the verified bank" },
    THIRD_PARTY:   { family: "Funding source",  weight: 9,  label: "Deposits from a card in someone else's name" },
    MANY_CARDS:    { family: "Funding source",  weight: 6,  label: "Three or more different cards used to deposit" },
    CASHOUT_OTHER: { family: "Cash-out route",  weight: 7,  label: "Withdrawals sent to a different bank than the verified bank" },
    MINIMAL_PLAY:  { family: "Play behaviour",  weight: 9,  label: "Deposits, barely plays, then cashes out" },
    SPIKE:         { family: "Play behaviour",  weight: 6,  label: "Deposits far above own history and other players" },
    DORMANT:       { family: "Play behaviour",  weight: 5,  label: "Inactive for months, then sudden large deposits" },
    STRUCTURING:   { family: "Amount & timing", weight: 10, label: "Deposits split under $10,000 inside 24 hours" },
    RAPID_IN_OUT:  { family: "Amount & timing", weight: 7,  label: "Money in and back out within 24 hours" }
  };

  // ---------------------------------------------------------------
  // Named patterns (bank typologies rebuilt for gaming). These label
  // what the combination of flags most likely means.
  // ---------------------------------------------------------------
  const PATTERNS = [
    { id: "PASS_THROUGH", name: "Pass-through: deposit, barely play, cash out",
      test: (f) => f.MINIMAL_PLAY && (f.CASHOUT_OTHER || f.RAPID_IN_OUT),
      why: "Money goes in and comes back out as 'winnings' with almost no gambling. Gaming's version of a bank pass-through account.",
      next: "Request source of funds. Hold further withdrawals to new banks until reviewed. Compare payout account ownership." },
    { id: "STRUCTURING", name: "Structuring around the 24-hour rule",
      test: (f) => f.STRUCTURING && (f.MANY_CARDS || f.NEW_BANK || f.THIRD_PARTY),
      why: "Several deposits each under $10,000, from different sources, that add up to more within 24 hours.",
      next: "Review all funding sources in the 24-hour window. Strong candidate for a suspicious transaction report if no explanation." },
    { id: "THIRD_PARTY", name: "Third-party funding",
      test: (f) => f.THIRD_PARTY && (f.NEW_BANK || f.MANY_CARDS || f.LINKED || f.CASHOUT_OTHER),
      why: "Someone other than the verified player is putting money into the account. The real source of funds is hidden.",
      next: "Contact the player to confirm card ownership. If they cannot explain it, restrict deposits from that card." },
    { id: "MULE_NETWORK", name: "Linked-account (mule) network",
      test: (f) => f.LINKED && (f.CASHOUT_OTHER || f.MINIMAL_PLAY || f.THIRD_PARTY),
      why: "Several accounts share a device or payout account and move money the same way. One person may control them all.",
      next: "Review every linked account together as one case. Check whether payouts converge on one bank account." },
    { id: "PROFILE_MISMATCH", name: "Activity inconsistent with profile",
      test: (f) => f.SPIKE && (f.DORMANT || f.NEW_BANK || f.RAPID_IN_OUT || f.THIRD_PARTY),
      why: "Spending changed sharply against the player's own history and peers, alongside another change in behaviour.",
      next: "Request source of funds or wealth. Note any explanation (inheritance, bonus, sale of property) in the case file." }
  ];

  // Signals we see but never score. Using assistive technology, being slow,
  // retrying a photo, or verifying through a bank is not suspicious.
  const EXCLUDED_SIGNALS = [
    "Screen reader or other assistive technology",
    "Slow sign-up or long sessions",
    "Photo capture retries",
    "Keyboard-only navigation",
    "Verification method (camera or bank)",
    "Age, gender, or disability"
  ];

  const TIERS = {
    clear:  { label: "Clear",  min: 0,  max: 9,   action: "No action." },
    low:    { label: "Low",    min: 10, max: 29,  action: "Monitor quietly. No alert, no contact with the player." },
    medium: { label: "Medium", min: 30, max: 59,  action: "Level 1 review: check the evidence and clear or escalate." },
    high:   { label: "High",   min: 60, max: 100, action: "Level 2 investigation. If there are reasonable grounds to suspect, file a suspicious transaction report with FINTRAC as soon as practicable." }
  };

  // ---------------------------------------------------------------
  // Synthetic data
  // ---------------------------------------------------------------
  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FIRST = ["Aiden","Amara","Arjun","Beatriz","Chen","Chloe","Daniel","Devon","Elena","Emeka","Farah","Gabriel","Grace","Hamza","Hannah","Isabelle","Jamal","Jasmine","Jordan","Kai","Kavya","Liam","Lucia","Malik","Maya","Mei","Nadia","Noah","Olivia","Omar","Priya","Rafael","Riya","Samuel","Sana","Sofia","Tariq","Thomas","Valentina","Wei","Yusuf","Zara","Ethan","Leah","Marcus","Nina","Owen","Rohan","Simone","Victor"];
  const LAST = ["Ahmed","Bell","Campbell","Chen","Costa","Desai","Dubois","Evans","Fernandes","Gill","Gordon","Hassan","Ito","Johnson","Khan","Kowalski","Lam","Lee","MacDonald","Martin","Mehta","Nguyen","Okafor","Osei","Patel","Rahman","Reyes","Roy","Santos","Shah","Singh","Smith","Tremblay","Walker","Wilson","Wong","Yeung","Zhang","Brown","Clarke"];

  function generate(seed) {
    const r = rng(seed || 2026);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const between = (a, b) => a + r() * (b - a);
    const money = (a, b) => Math.round(between(a, b) / 5) * 5;
    const players = [];
    const txs = [];
    const names = new Set();
    let pid = 1000, tid = 1, did = 1, cid = 1;

    function uniqueName() {
      for (;;) { const n = pick(FIRST) + " " + pick(LAST); if (!names.has(n)) { names.add(n); return n; } }
    }
    function otherBank(not) { let b; do { b = pick(BANKS); } while (b === not); return b; }
    // Times are UTC; Toronto is UTC-4 in October. 21:00-27:30 UTC = 5:00-11:30 PM Toronto.
    function midnight(ts) { return Math.floor(ts / DAY) * DAY; }
    function eveningTs(dayTs) { let t = midnight(dayTs) + between(21, 27.5) * HOUR; if (t > NOW) t -= DAY; return t; }

    function newPlayer(kind) {
      const name = uniqueName();
      const bank = pick(BANKS.slice(0, 6));
      const p = {
        id: "P" + (pid++), name, age: Math.floor(between(19, 76)), registeredBank: bank,
        verifiedBy: r() < 0.35 ? "Bank" : "Photo ID + face",
        signupTs: NOW - Math.floor(between(380, 1100)) * DAY,
        devices: ["D" + (did++)],
        cards: [{ id: "C" + (cid++), bank, holder: name }],
        payout: "ACC-" + pid,
        a11y: r() < 0.12
          ? { assistiveTech: "Screen reader", avgSessionMin: Math.round(between(35, 70)), photoRetries: Math.floor(between(3, 9)), keyboardOnly: true }
          : { assistiveTech: "None", avgSessionMin: Math.round(between(8, 30)), photoRetries: Math.floor(between(0, 2)), keyboardOnly: false },
        kind, suspicious: false
      };
      players.push(p);
      return p;
    }
    function addCard(p, bank, holder) { const c = { id: "C" + (cid++), bank, holder }; p.cards.push(c); return c; }

    function tx(p, type, ts, amount, extra) {
      const base = { id: "T" + (tid++), playerId: p.id, type, ts: Math.round(ts), amount: Math.round(amount * 100) / 100,
        bank: p.registeredBank, cardId: p.cards[0].id, holder: p.name, vpn: false, geo: "ON", device: p.devices[0], dest: null };
      if (type === "withdrawal") base.dest = p.payout;
      const t = Object.assign(base, extra || {});
      txs.push(t);
      return t;
    }

    // A night of ordinary play: deposit, wager, win some back, sometimes withdraw.
    function session(p, ts, depAmt, opts) {
      opts = opts || {};
      const card = opts.card || p.cards[0];
      tx(p, "deposit", ts, depAmt, { bank: card.bank, cardId: card.id, holder: card.holder, vpn: !!opts.vpn });
      const wager = depAmt * between(1.3, 3.2);
      tx(p, "wager", ts + 20 * 60000, wager, { vpn: !!opts.vpn });
      const win = wager * between(0.78, 0.97);
      tx(p, "win", ts + 80 * 60000, win, { vpn: !!opts.vpn });
      const balance = depAmt - wager + win;
      if (balance > 60 && r() < 0.35) tx(p, "withdrawal", ts + 2 * HOUR, balance * 0.9, { vpn: !!opts.vpn });
    }

    function normalHistory(p, fromDays, toDays, lo, hi, opts) {
      let d = NOW - fromDays * DAY;
      const end = NOW - toDays * DAY;
      while (d < end) {
        session(p, eveningTs(d), money(lo, hi), opts && opts(d));
        d += Math.floor(between(3, 11)) * DAY;
      }
    }

    // ---- ordinary players (most of the population)
    for (let i = 0; i < 140; i++) {
      const p = newPlayer("Normal");
      normalHistory(p, 365, 0, 20, 320);
    }

    // ---- legitimate high rollers: big numbers, but consistent with their own history
    for (let i = 0; i < 4; i++) {
      const p = newPlayer("High roller (legitimate)");
      normalHistory(p, 365, 0, 2500, 8500);
    }

    // ---- false-positive traps: exactly one red flag each, all innocent
    for (let i = 0; i < 6; i++) {
      const p = newPlayer("VPN at work (innocent)");
      normalHistory(p, 365, 0, 20, 250, () => ({ vpn: r() < 0.6 }));
    }
    for (let i = 0; i < 5; i++) {
      const p = newPlayer("Second personal bank (innocent)");
      normalHistory(p, 365, 0, 20, 250);
      const c = addCard(p, otherBank(p.registeredBank), p.name);
      session(p, eveningTs(NOW - Math.floor(between(5, 60)) * DAY), money(80, 300), { card: c });
    }
    // Two red flags, still innocent: a spouse's card from another bank.
    // These land in Medium on purpose. Medium means "a person checks", not "guilty".
    for (let i = 0; i < 2; i++) {
      const p = newPlayer("Spouse's card (innocent)");
      normalHistory(p, 365, 0, 20, 220);
      const c = addCard(p, otherBank(p.registeredBank), pick(FIRST) + " " + p.name.split(" ")[1]);
      session(p, eveningTs(NOW - Math.floor(between(5, 50)) * DAY), money(60, 200), { card: c });
    }
    for (let i = 0; i < 2; i++) {
      const p = newPlayer("Jackpot winner (innocent)");
      normalHistory(p, 365, 0, 20, 200);
      const ts = eveningTs(NOW - Math.floor(between(6, 40)) * DAY);
      tx(p, "deposit", ts, 100);
      tx(p, "wager", ts + 10 * 60000, 100);
      tx(p, "win", ts + 30 * 60000, money(18000, 32000));
      tx(p, "withdrawal", ts + 26 * HOUR, money(15000, 17500));
    }

    // ---- planted suspicious players (ground truth for validation)
    // Pass-through: big deposits, tiny wagering, fast cash-out to a different bank
    for (let i = 0; i < 4; i++) {
      const p = newPlayer("Pass-through"); p.suspicious = true;
      normalHistory(p, 365, 40, 20, 150);
      const outBank = otherBank(p.registeredBank);
      for (let k = 0; k < 2; k++) {
        const ts = eveningTs(NOW - Math.floor(between(3, 30)) * DAY);
        const dep = money(7000, 9600);
        tx(p, "deposit", ts, dep);
        const w = dep * between(0.03, 0.08);
        tx(p, "wager", ts + 30 * 60000, w);
        tx(p, "win", ts + 60 * 60000, w * between(0.8, 1.0));
        tx(p, "withdrawal", ts + between(6, 20) * HOUR, dep * between(0.9, 0.97), { bank: outBank, dest: "EXT-" + p.id });
      }
    }
    // Structuring: same-day deposits from several cards, each under $10,000, adding up to more
    for (let i = 0; i < 4; i++) {
      const p = newPlayer("Structuring"); p.suspicious = true;
      normalHistory(p, 365, 30, 20, 200);
      const cards = [addCard(p, otherBank(p.registeredBank), p.name), addCard(p, otherBank(p.registeredBank), p.name), p.cards[0]];
      for (let k = 0; k < 2; k++) {
        const day = midnight(NOW - Math.floor(between(2, 25)) * DAY) + 13 * HOUR; // 9 AM Toronto
        let total = 0;
        cards.forEach((c, j) => {
          const amt = money(3400, 4600); total += amt;
          tx(p, "deposit", day + j * between(2, 4) * HOUR, amt, { bank: c.bank, cardId: c.id, holder: c.holder });
        });
        tx(p, "wager", day + 12 * HOUR, total * between(0.35, 0.6));
        tx(p, "win", day + 13 * HOUR, total * between(0.3, 0.5));
      }
    }
    // Third-party funding: someone else's card, from another bank
    for (let i = 0; i < 4; i++) {
      const p = newPlayer("Third-party funding"); p.suspicious = true;
      normalHistory(p, 365, 0, 20, 220);
      const funder = uniqueName();
      const c = addCard(p, otherBank(p.registeredBank), funder);
      for (let k = 0; k < 4; k++) session(p, eveningTs(NOW - Math.floor(between(2, 60)) * DAY), money(600, 2400), { card: c });
    }
    // Mule network: five accounts on one device, money funnels to one payout account
    const ringDevice = "D-RING-7";
    const ringPayout = "EXT-RING-7";
    for (let i = 0; i < 5; i++) {
      const p = newPlayer("Mule network"); p.suspicious = true;
      p.devices = [ringDevice];
      p.signupTs = NOW - Math.floor(between(60, 120)) * DAY;
      for (let k = 0; k < 3; k++) {
        const ts = eveningTs(NOW - Math.floor(between(2, 50)) * DAY);
        const dep = money(1800, 4200);
        tx(p, "deposit", ts, dep, { device: ringDevice });
        const w = dep * between(0.08, 0.15);
        tx(p, "wager", ts + HOUR, w, { device: ringDevice });
        tx(p, "win", ts + 2 * HOUR, w * 0.9, { device: ringDevice });
        tx(p, "withdrawal", ts + between(30, 70) * HOUR, dep * 0.88, { device: ringDevice, bank: "Tangerine", dest: ringPayout });
      }
    }
    // Dormant then sudden spike
    for (let i = 0; i < 3; i++) {
      const p = newPlayer("Dormant then spike"); p.suspicious = true;
      normalHistory(p, 400, 250, 20, 120);
      const c = addCard(p, otherBank(p.registeredBank), p.name);
      for (let k = 0; k < 3; k++) session(p, eveningTs(NOW - Math.floor(between(1, 11)) * DAY), money(2600, 3800), { card: c });
    }

    // ---- player protection cases (not laundering): rapid late-night re-deposits
    for (let i = 0; i < 3; i++) {
      const p = newPlayer("Player protection");
      normalHistory(p, 365, 30, 20, 120);
      for (let k = 0; k < 6; k++) {
        const night = midnight(NOW - Math.floor(between(1, 28)) * DAY) + between(5, 7) * HOUR; // 1-3 AM Toronto
        for (let j = 0; j < 5; j++) {
          const dep = money(40, 150);
          tx(p, "deposit", night + j * 25 * 60000, dep);
          tx(p, "wager", night + j * 25 * 60000 + 60000, dep * 1.1);
          tx(p, "win", night + j * 25 * 60000 + 120000, dep * 0.15);
        }
      }
    }

    txs.sort((a, b) => a.ts - b.ts);
    return { players, txs, asOf: NOW };
  }

  // Thirty days of made-up activity for a player who signed up through ClearPass.
  function simulateFor(player, scenario, seed) {
    const r = rng(seed || 7);
    const between = (a, b) => a + r() * (b - a);
    const money = (a, b) => Math.round(between(a, b) / 5) * 5;
    const out = [];
    let n = 1;
    const mk = (type, ts, amount, extra) => out.push(Object.assign({ id: player.id + "-T" + (n++), playerId: player.id, type, ts: Math.round(ts), amount: Math.round(amount * 100) / 100,
      bank: player.registeredBank, cardId: player.cards[0].id, holder: player.name, vpn: false, geo: "ON", device: player.devices[0], dest: type === "withdrawal" ? player.payout : null }, extra || {}));
    const other = BANKS.find((b) => b !== player.registeredBank && b !== "Tangerine");
    for (let k = 0; k < 6; k++) {
      const ts = Math.floor((NOW - (28 - k * 4) * DAY) / DAY) * DAY + 23 * HOUR; // 7 PM Toronto
      const dep = money(30, 200);
      const vpn = scenario === "vpn" && k % 2 === 0;
      mk("deposit", ts, dep, { vpn });
      mk("wager", ts + HOUR, dep * 2, { vpn });
      mk("win", ts + 2 * HOUR, dep * 1.8, { vpn });
    }
    if (scenario === "passthrough") {
      for (let k = 0; k < 2; k++) {
        const ts = Math.floor((NOW - (6 - k * 3) * DAY) / DAY) * DAY + 24 * HOUR; // 8 PM Toronto
        const dep = money(7500, 9500);
        mk("deposit", ts, dep, { vpn: true });
        mk("wager", ts + HOUR, dep * 0.05, { vpn: true });
        mk("win", ts + 2 * HOUR, dep * 0.04, { vpn: true });
        mk("withdrawal", ts + 10 * HOUR, dep * 0.95, { vpn: true, bank: other, dest: "EXT-" + player.id });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------
  // Context shared across players (needed for peer comparison and links)
  // ---------------------------------------------------------------
  function buildContext(players, txs, asOf) {
    const byPlayer = new Map(players.map((p) => [p.id, []]));
    txs.forEach((t) => { if (byPlayer.has(t.playerId)) byPlayer.get(t.playerId).push(t); });
    byPlayer.forEach((list) => list.sort((a, b) => a.ts - b.ts));

    const deviceIndex = new Map();
    const payoutIndex = new Map();
    players.forEach((p) => p.devices.forEach((d) => add(deviceIndex, d, p.id)));
    txs.forEach((t) => {
      if (t.device) add(deviceIndex, t.device, t.playerId);
      if (t.type === "withdrawal" && t.dest) add(payoutIndex, t.dest, t.playerId);
    });

    // Peer group: everyone's deposits over the last 30 days. The 90th percentile is the bar.
    const d30 = players.map((p) => sum((byPlayer.get(p.id) || []).filter((t) => t.type === "deposit" && t.ts > asOf - 30 * DAY)));
    const sorted = d30.slice().sort((a, b) => a - b);
    const peerP90 = sorted[Math.floor(sorted.length * 0.9)] || 0;

    return { byPlayer, deviceIndex, payoutIndex, peerP90, asOf };
  }
  function add(map, key, val) { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(val); }
  function sum(list) { return list.reduce((s, t) => s + t.amount, 0); }
  const fmt = (n) => "$" + Math.round(n).toLocaleString("en-CA");
  const dstr = (ts) => new Date(ts).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Toronto" });

  // ---------------------------------------------------------------
  // Red-flag detection for one player
  // ---------------------------------------------------------------
  function detectFlags(p, ctx) {
    const all = ctx.byPlayer.get(p.id) || [];
    const since = ctx.asOf - WINDOW_DAYS * DAY;
    const win = all.filter((t) => t.ts > since);
    const deps = win.filter((t) => t.type === "deposit");
    const wds = win.filter((t) => t.type === "withdrawal");
    const wagered = sum(win.filter((t) => t.type === "wager"));
    const found = [];
    const flag = (code, evidence, txIds) => found.push(Object.assign({ code, evidence, txIds: txIds || [] }, FLAGS[code]));

    // Location
    const sessionsVpn = win.filter((t) => t.type === "deposit" && (t.vpn || t.geo !== "ON"));
    if (sessionsVpn.length) flag("LOCATION", `${sessionsVpn.length} of ${deps.length} deposits made through a VPN or from outside Ontario.`, sessionsVpn.map((t) => t.id));

    // Linked accounts (entity resolution: same device or same payout account)
    const linked = new Set();
    const devs = new Set(p.devices.concat(all.map((t) => t.device).filter(Boolean)));
    devs.forEach((d) => (ctx.deviceIndex.get(d) || new Set()).forEach((id) => id !== p.id && linked.add(id)));
    const payouts = new Set(wds.map((t) => t.dest).filter(Boolean));
    payouts.forEach((d) => (ctx.payoutIndex.get(d) || new Set()).forEach((id) => id !== p.id && linked.add(id)));
    if (linked.size) flag("LINKED", `Linked to ${linked.size} other account${linked.size > 1 ? "s" : ""} by shared device or payout account: ${Array.from(linked).join(", ")}.`);

    // Funding source
    const newBank = deps.filter((t) => t.bank !== p.registeredBank);
    if (newBank.length) {
      const banks = Array.from(new Set(newBank.map((t) => t.bank))).join(", ");
      flag("NEW_BANK", `Verified bank is ${p.registeredBank}. ${newBank.length} deposit${newBank.length > 1 ? "s" : ""} (${fmt(sum(newBank))}) came from ${banks}.`, newBank.map((t) => t.id));
    }
    const third = deps.filter((t) => t.holder !== p.name);
    if (third.length) {
      const holders = Array.from(new Set(third.map((t) => t.holder))).join(", ");
      flag("THIRD_PARTY", `${third.length} deposit${third.length > 1 ? "s" : ""} (${fmt(sum(third))}) from a card held by ${holders}.`, third.map((t) => t.id));
    }
    const cards = new Set(deps.map((t) => t.cardId));
    if (cards.size >= 3) flag("MANY_CARDS", `${cards.size} different cards used to deposit in the last ${WINDOW_DAYS} days.`);

    // Cash-out route
    const outOther = wds.filter((t) => t.bank !== p.registeredBank);
    if (outOther.length) {
      const banks = Array.from(new Set(outOther.map((t) => t.bank))).join(", ");
      flag("CASHOUT_OTHER", `Verified bank is ${p.registeredBank}. ${fmt(sum(outOther))} withdrawn to ${banks}.`, outOther.map((t) => t.id));
    }

    // Play behaviour
    const depTotal = sum(deps), wdTotal = sum(wds);
    if (depTotal >= 1000 && wagered < 0.25 * depTotal && wdTotal >= 0.5 * depTotal) {
      flag("MINIMAL_PLAY", `Deposited ${fmt(depTotal)}, wagered only ${fmt(wagered)} (${Math.round((wagered / depTotal) * 100)}%), withdrew ${fmt(wdTotal)}.`);
    }
    const d30 = sum(all.filter((t) => t.type === "deposit" && t.ts > ctx.asOf - 30 * DAY));
    const base = all.filter((t) => t.type === "deposit" && t.ts <= ctx.asOf - 90 * DAY && t.ts > ctx.asOf - 365 * DAY);
    const baselineMonthly = sum(base) / 9;
    if (d30 > Math.max(3 * baselineMonthly, 1500) && d30 > ctx.peerP90) {
      flag("SPIKE", `${fmt(d30)} deposited in the last 30 days. Own monthly average before: ${fmt(baselineMonthly)}. Peer 90th percentile: ${fmt(ctx.peerP90)}.`);
    }
    for (let i = 1; i < all.length; i++) {
      const gap = all[i].ts - all[i - 1].ts;
      if (gap >= 120 * DAY) {
        const burst = all.filter((t) => t.type === "deposit" && t.ts >= all[i].ts && t.ts < all[i].ts + 14 * DAY);
        if (sum(burst) >= 5000) { flag("DORMANT", `No activity for ${Math.round(gap / DAY)} days, then ${fmt(sum(burst))} deposited within two weeks.`, burst.map((t) => t.id)); break; }
      }
    }

    // Amount & timing. A single deposit under $10,000 never counts on its own.
    for (let i = 0; i < deps.length; i++) {
      const group = deps.filter((t) => t.ts >= deps[i].ts && t.ts < deps[i].ts + 24 * HOUR);
      const total = sum(group);
      if (group.length >= 2 && group.every((t) => t.amount < REPORT_THRESHOLD) && total >= REPORT_THRESHOLD) {
        flag("STRUCTURING", `${group.length} deposits on ${dstr(deps[i].ts)}, each under $10,000, totalling ${fmt(total)} within 24 hours.`, group.map((t) => t.id));
        break;
      }
    }
    for (const d of deps) {
      const w = wds.find((t) => t.ts > d.ts && t.ts <= d.ts + 24 * HOUR && t.amount >= 0.8 * d.amount);
      if (w) {
        const played = sum(win.filter((t) => t.type === "wager" && t.ts >= d.ts && t.ts <= w.ts));
        if (played < 0.3 * d.amount) {
          flag("RAPID_IN_OUT", `${fmt(d.amount)} deposited ${dstr(d.ts)}, ${fmt(w.amount)} withdrawn ${Math.round((w.ts - d.ts) / HOUR)} hours later after wagering ${fmt(played)}.`, [d.id, w.id]);
          break;
        }
      }
    }
    return { flags: found, linked: Array.from(linked), window: win };
  }

  // ---------------------------------------------------------------
  // Patterns -> tier -> score
  // ---------------------------------------------------------------
  function assess(p, ctx) {
    const { flags, linked, window } = detectFlags(p, ctx);
    const has = {};
    flags.forEach((f) => { has[f.code] = true; });
    const n = flags.length;
    const tier = n === 0 ? "clear" : n === 1 ? "low" : n === 2 ? "medium" : "high";
    const weight = flags.reduce((s, f) => s + f.weight, 0);
    const t = TIERS[tier];
    const score = tier === "clear" ? 0 : Math.min(t.max, t.min + Math.round(weight * (tier === "low" ? 2 : tier === "medium" ? 1.2 : 0.9)));
    const patterns = PATTERNS.filter((pt) => pt.test(has));
    return { player: p, flags, patterns, tier, score, linked, window, reports: reportsDue(p, ctx), protection: protectionFlags(p, ctx) };
  }

  // FINTRAC reporting duties, separate from suspicion.
  function reportsDue(p, ctx) {
    const wds = (ctx.byPlayer.get(p.id) || []).filter((t) => t.type === "withdrawal" && t.ts > ctx.asOf - WINDOW_DAYS * DAY);
    const out = [];
    for (let i = 0; i < wds.length; i++) {
      const group = wds.filter((t) => t.ts >= wds[i].ts && t.ts < wds[i].ts + 24 * HOUR);
      const total = sum(group);
      if (total >= REPORT_THRESHOLD) {
        out.push({ type: "Casino Disbursement Report", detail: `${fmt(total)} paid out on ${dstr(wds[i].ts)}${group.length > 1 ? ` across ${group.length} withdrawals (24-hour rule)` : ""}. Due within 15 calendar days of the payout.` });
        break;
      }
    }
    return out;
  }

  // Responsible gambling, routed to a different team. Not part of the AML score.
  function protectionFlags(p, ctx) {
    const deps = (ctx.byPlayer.get(p.id) || []).filter((t) => t.type === "deposit" && t.ts > ctx.asOf - 30 * DAY);
    const byDay = new Map();
    deps.forEach((t) => { const k = Math.floor((t.ts - 5 * HOUR) / DAY); byDay.set(k, (byDay.get(k) || 0) + 1); });
    const heavyDays = Array.from(byDay.values()).filter((c) => c >= 5).length;
    const late = deps.filter((t) => { const h = new Date(t.ts - 4 * HOUR).getUTCHours(); return h >= 0 && h < 5; }).length;
    const out = [];
    if (heavyDays >= 2) out.push(`Five or more deposits in a single day on ${heavyDays} days this month (possible chasing losses).`);
    if (deps.length >= 6 && late / deps.length >= 0.4) out.push(`${Math.round((late / deps.length) * 100)}% of deposits made between midnight and 5 AM.`);
    return out;
  }

  function assessAll(players, txs, asOf) {
    const ctx = buildContext(players, txs, asOf || NOW);
    return { ctx, results: players.map((p) => assess(p, ctx)).sort((a, b) => b.score - a.score) };
  }

  // ---------------------------------------------------------------
  // Rule validation against the planted ground truth
  // ---------------------------------------------------------------
  function validate(results) {
    const planted = results.filter((r) => r.player.suspicious);
    const innocent = results.filter((r) => !r.player.suspicious);
    const alerted = (r) => r.tier === "medium" || r.tier === "high";
    const tp = planted.filter(alerted).length;
    const fp = innocent.filter(alerted).length;
    const kinds = {};
    results.forEach((r) => {
      const k = r.player.kind;
      if (!kinds[k]) kinds[k] = { kind: k, suspicious: r.player.suspicious, count: 0, clear: 0, low: 0, medium: 0, high: 0 };
      kinds[k].count++; kinds[k][r.tier]++;
    });
    // Comparison: what a "one red flag = alert" system would do with the same data
    const singleAlerts = results.filter((r) => r.flags.length >= 1);
    const singleFp = singleAlerts.filter((r) => !r.player.suspicious).length;
    return {
      total: results.length, plantedCount: planted.length, tp, fp,
      recall: planted.length ? tp / planted.length : 0,
      precision: tp + fp ? tp / (tp + fp) : 0,
      byKind: Object.values(kinds).sort((a, b) => (b.suspicious - a.suspicious) || b.count - a.count),
      singleRule: { alerts: singleAlerts.length, falsePositives: singleFp },
      patternRule: { alerts: tp + fp, falsePositives: fp }
    };
  }

  // ---------------------------------------------------------------
  // Draft narrative for a suspicious transaction report (who, what, when, where, why)
  // ---------------------------------------------------------------
  function strNarrative(a) {
    const p = a.player;
    const dates = a.window.filter((t) => t.type === "deposit" || t.type === "withdrawal").map((t) => t.ts);
    const from = dates.length ? dstr(Math.min.apply(null, dates)) : "";
    const to = dates.length ? dstr(Math.max.apply(null, dates)) : "";
    return [
      `DRAFT — for analyst review. Synthetic data.`,
      ``,
      `Subject: ${p.name}, player ID ${p.id}, age ${p.age}, verified through ${p.verifiedBy.toLowerCase()} with ${p.registeredBank} as the verified bank.`,
      `Period reviewed: ${from} to ${to}, 2026.`,
      `Assessment: ${TIERS[a.tier].label} risk, score ${a.score}/100, based on ${a.flags.length} corroborating red flags.`,
      a.patterns.length ? `Pattern${a.patterns.length > 1 ? "s" : ""} identified: ${a.patterns.map((x) => x.name).join("; ")}.` : ``,
      ``,
      `Grounds for suspicion:`,
      ...a.flags.map((f, i) => `${i + 1}. ${f.label}. ${f.evidence}`),
      ``,
      a.patterns.length ? `Why this matters: ${a.patterns[0].why}` : ``,
      ``,
      `Not considered: assistive technology use, session length, photo retries, and verification method. These are not indicators of suspicion.`,
      `Reminder: do not tell the player that a report is being considered or has been filed.`
    ].filter((l, i, arr) => !(l === `` && arr[i - 1] === ``)).join("\n");
  }

  const api = { DAY, HOUR, NOW, BANKS, FLAGS, PATTERNS, TIERS, EXCLUDED_SIGNALS, REPORT_THRESHOLD,
    generate, simulateFor, assessAll, validate, strNarrative, fmt, dstr };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== "undefined" ? window : globalThis);
