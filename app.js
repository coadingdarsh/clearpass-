/*
  app.js — ClearPass UI
  1. Player sign-up: accessible verification for blind and low-vision players.
     The verified bank chosen here becomes the baseline the AML engine checks against.
  2. Analyst workbench: pattern-based cases, evidence, funding map, linked accounts, actions.
  3. Rule validation: how the patterns perform on planted cases, and how many false alerts
     a "one red flag = alert" system would have raised instead.
*/
(function () {
  "use strict";
  const E = window.Engine;

  // ---------- storage (wrapped so the page still works if storage is blocked)
  function load(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  // ---------- speech and screen reader announcements
  const voiceBox = document.getElementById("voice");
  const live = document.getElementById("live");
  const polite = document.getElementById("polite");
  let lastSaid = "", lastSaidAt = 0;
  function say(msg, opts) {
    opts = opts || {};
    const now = Date.now();
    if (!opts.force && msg === lastSaid && now - lastSaidAt < 4000) return;
    if (!opts.force && msg !== lastSaid && now - lastSaidAt < 1300) return;
    lastSaid = msg; lastSaidAt = now;
    live.textContent = ""; setTimeout(() => { live.textContent = msg; }, 30);
    if (voiceBox.checked && "speechSynthesis" in window) {
      try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(msg); u.lang = "en-CA"; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) {}
    }
  }
  function announce(msg) { polite.textContent = ""; setTimeout(() => { polite.textContent = msg; }, 30); }
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
  voiceBox.addEventListener("change", () => { if (!voiceBox.checked) try { speechSynthesis.cancel(); } catch (e) {} });

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; }

  // ---------- data: synthetic population + players who signed up in this browser
  const base = E.generate(2026);
  function dataset() {
    const mine = load("cp2_players", []);
    const myTx = load("cp2_txs", []);
    return { players: base.players.concat(mine), txs: base.txs.concat(myTx) };
  }
  let assessed = null;
  function reassess() { const d = dataset(); assessed = E.assessAll(d.players, d.txs, base.asOf); return assessed; }

  // ---------- tabs
  const tabs = ["player", "analyst", "validation"].map((k) => ({ k, btn: document.getElementById("tab-" + k), view: document.getElementById("view-" + k) }));
  function showView(k) {
    tabs.forEach((t) => { t.btn.setAttribute("aria-selected", t.k === k ? "true" : "false"); t.view.hidden = t.k !== k; });
    if (k !== "player") stopCamera();
    if (k === "analyst") renderWorkbench();
    if (k === "validation") renderValidation();
  }
  tabs.forEach((t) => { t.btn.onclick = () => showView(t.k); });
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex((t) => t.btn.getAttribute("aria-selected") === "true");
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    n.btn.focus(); showView(n.k);
  });

  // =================================================================
  // 1. PLAYER SIGN-UP (ClearPass)
  // =================================================================
  const session = { method: null, details: {}, bank: "", startedAt: Date.now(), retries: 0, prompts: 0, keyboardOnly: true };
  document.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" || e.pointerType === "touch") session.keyboardOnly = false; });
  const STEPS_CAMERA = ["Start", "Your details", "Photo ID", "Face check", "Your bank", "Done"];
  const STEPS_BANK = ["Start", "Your details", "Bank check", "Done"];
  const stage = document.getElementById("stage");
  const stepper = document.getElementById("stepper");
  let stepIndex = 0;
  const steps = () => (session.method === "bank" ? STEPS_BANK : STEPS_CAMERA);

  function go(i) {
    stopCamera();
    stepIndex = i;
    stepper.innerHTML = steps().map((n, j) => `<li${j === i ? ' aria-current="step"' : ""}${j < i ? ' class="done"' : ""}>${n}</li>`).join("");
    const name = steps()[i];
    ({ "Start": viewStart, "Your details": viewDetails, "Photo ID": viewIdCapture, "Face check": viewSelfie, "Your bank": viewBankPick, "Bank check": viewBankCheck, "Done": viewDone })[name]();
    const h = stage.querySelector("h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
    announce("Step " + (i + 1) + " of " + steps().length + ": " + name);
  }

  function viewStart() {
    stage.innerHTML = "";
    const p = el(`<div class="panel">
      <h2>Verify your identity</h2>
      <p>Before you can play, OLG needs to confirm who you are. Every step works with a screen reader, a keyboard, or voice. Pick the way that works best for you.</p>
      <div class="choices">
        <button class="choice" id="pick-bank">Verify through my bank<small>No photos. Sign in to your online banking. Fastest if you use a screen reader.</small></button>
        <button class="choice" id="pick-camera">Use my camera<small>The app talks you through each photo. You don't need to see the screen.</small></button>
      </div>
      <p class="hint">If you use a screen reader, turn off "App voice" at the top so you don't hear things twice. Guidance still reaches your screen reader.</p>
    </div>`);
    stage.appendChild(p);
    p.querySelector("#pick-camera").onclick = () => { session.method = "camera"; go(1); };
    p.querySelector("#pick-bank").onclick = () => { session.method = "bank"; go(1); };
  }

  function viewDetails() {
    const d = session.details;
    stage.innerHTML = "";
    const voiceOk = window.VoiceFill && window.VoiceFill.supported;
    const p = el(`<form class="panel" novalidate>
      <h2>Your details</h2>
      <p>Enter them as they appear on your ID. Use made-up details for this prototype.</p>
      <button type="button" id="vf">${voiceOk ? "Fill this form by voice" : "Voice filling needs Chrome or Edge. You can also press Windows key + H to dictate."}</button>
      <div id="err-summary" hidden tabindex="-1" class="note" style="background:var(--bad-bg);color:var(--bad)"></div>
      <div class="form-grid">
        <div><label for="f-first">First name</label><input type="text" id="f-first" autocomplete="given-name" value="${esc(d.first)}"></div>
        <div><label for="f-last">Last name</label><input type="text" id="f-last" autocomplete="family-name" value="${esc(d.last)}"></div>
        <div><label for="f-dob">Date of birth</label><input type="date" id="f-dob" autocomplete="bday" value="${esc(d.dob)}" aria-describedby="h-dob"><p class="hint" id="h-dob">You must be 19 or older to play in Ontario.</p></div>
        <div><label for="f-postal">Postal code</label><input type="text" id="f-postal" autocomplete="postal-code" value="${esc(d.postal)}" aria-describedby="h-postal"><p class="hint" id="h-postal">Example: L6T 4M2</p></div>
        <div><label for="f-email">Email</label><input type="email" id="f-email" autocomplete="email" value="${esc(d.email)}"></div>
      </div>
      <div class="row"><button type="button" id="back">Back</button><button class="primary" type="submit">Continue</button></div>
    </form>`);
    stage.appendChild(p);
    const vf = p.querySelector("#vf");
    if (voiceOk) vf.onclick = () => window.VoiceFill.run(p); else vf.disabled = true;
    p.querySelector("#back").onclick = () => go(0);
    p.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = (id) => p.querySelector(id).value.trim();
      const vals = { first: v("#f-first"), last: v("#f-last"), dob: v("#f-dob"), postal: v("#f-postal").toUpperCase(), email: v("#f-email") };
      const errs = [];
      if (!vals.first) errs.push(["#f-first", "Enter your first name."]);
      if (!vals.last) errs.push(["#f-last", "Enter your last name."]);
      if (!vals.dob) errs.push(["#f-dob", "Enter your date of birth."]);
      else if (ageOf(vals.dob) < 19) errs.push(["#f-dob", "You must be 19 or older. Your date of birth shows you are " + ageOf(vals.dob) + "."]);
      if (!/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/.test(vals.postal)) errs.push(["#f-postal", "Enter a Canadian postal code, like L6T 4M2."]);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(vals.email)) errs.push(["#f-email", "Enter an email address, like name@example.com."]);
      p.querySelectorAll(".err").forEach((x) => x.remove());
      p.querySelectorAll("input").forEach((x) => { x.removeAttribute("aria-invalid"); x.removeAttribute("aria-describedby-err"); });
      const sum = p.querySelector("#err-summary");
      if (errs.length) {
        errs.forEach(([sel, msg], i) => {
          const input = p.querySelector(sel);
          const m = document.createElement("p"); m.className = "err"; m.id = "e" + i; m.textContent = msg;
          input.parentNode.appendChild(m);
          input.setAttribute("aria-invalid", "true");
          input.setAttribute("aria-describedby", ((input.getAttribute("aria-describedby") || "").replace(/\be\d+\b/g, "") + " " + m.id).trim());
        });
        sum.hidden = false;
        sum.textContent = (errs.length === 1 ? "1 thing needs fixing: " : errs.length + " things need fixing: ") + errs.map((x) => x[1]).join(" ");
        sum.focus(); say(sum.textContent, { force: true });
        return;
      }
      session.details = vals;
      go(2);
    });
  }
  function ageOf(dob) { const b = new Date(dob), n = new Date(); let a = n.getFullYear() - b.getFullYear(); const m = n.getMonth() - b.getMonth(); if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--; return a; }

  // ---------- camera
  let stream = null, loopTimer = null, facing = "environment";
  function stopCamera() {
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }
  async function startCamera(video, mode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no-camera");
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    video.srcObject = stream; await video.play();
    const s = stream.getVideoTracks()[0].getSettings();
    facing = s.facingMode || (mode === "environment" && /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "environment" : "user");
  }
  const W = 160, H = 120;
  const work = document.createElement("canvas"); work.width = W; work.height = H;
  const wctx = work.getContext("2d", { willReadFrequently: true });
  function grayFrom(src) {
    wctx.drawImage(src, 0, 0, W, H);
    const d = wctx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return g;
  }
  // Measures light, glare, sharpness, and where the card sits in the frame.
  function analyzeCard(src) {
    const g = grayFrom(src);
    let total = 0, glare = 0;
    for (let i = 0; i < g.length; i++) { total += g[i]; if (g[i] > 245) glare++; }
    let lapSum = 0, lapSq = 0, n = 0, edges = 0;
    const col = new Float32Array(W), row = new Float32Array(H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
      lapSum += lap; lapSq += lap * lap; n++;
      if (Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + W] - g[i - W]) > 70) { edges++; col[x]++; row[y]++; }
    }
    const span = (arr) => { let c = 0, lo = 0, hi = arr.length - 1; for (let i = 0; i < arr.length; i++) { c += arr[i]; if (c >= edges * 0.05) { lo = i; break; } } c = 0; for (let i = arr.length - 1; i >= 0; i--) { c += arr[i]; if (c >= edges * 0.05) { hi = i; break; } } return [lo, hi]; };
    const [x0, x1] = span(col), [y0, y1] = span(row);
    return { mean: total / g.length, glareFrac: glare / g.length, sharp: lapSq / n - (lapSum / n) ** 2, edgeFrac: edges / n,
      cover: ((x1 - x0) * (y1 - y0)) / (W * H), cx: (x0 + x1) / 2 / W - 0.5, cy: (y0 + y1) / 2 / H - 0.5 };
  }
  // Turns measurements into one spoken instruction, from the person's point of view.
  function guidanceFor(m) {
    if (m.mean < 55) return { msg: "Too dark. Move closer to a light.", good: false };
    if (m.edgeFrac < 0.015) return { msg: "Card not found. Hold your card in front of the camera.", good: false };
    if (m.cover < 0.22) return { msg: "Move the card closer.", good: false };
    if (m.cover > 0.85) return { msg: "Move the card a little farther away.", good: false };
    if (Math.abs(m.cx) > 0.14) { const imgLeft = m.cx < 0; const userLeft = facing === "user" ? !imgLeft : imgLeft; return { msg: userLeft ? "Move the card right." : "Move the card left.", good: false }; }
    if (Math.abs(m.cy) > 0.14) return { msg: m.cy < 0 ? "Move the card down." : "Move the card up.", good: false };
    if (m.glareFrac > 0.08) return { msg: "There's glare. Tilt the card slightly.", good: false };
    if (m.sharp < 45) return { msg: "Blurry. Hold still.", good: false };
    return { msg: "Good. Hold still.", good: true };
  }

  function viewIdCapture() {
    stage.innerHTML = "";
    const p = el(`<div class="panel">
      <h2>Photo of your ID</h2>
      <p>Use your driver's licence, Ontario Photo Card, or passport. Hold the front toward the camera. The app tells you where to move it and takes the photo itself.</p>
      <div class="guide" id="guide" role="status">Press Start camera when you're ready.</div>
      <div class="cam" id="cam" hidden><video id="video" playsinline muted aria-hidden="true"></video><div class="frame" id="frame"></div></div>
      <div id="shot"></div>
      <div class="row">
        <button class="primary" id="start">Start camera</button>
        <button id="demo">Run guided demo</button>
        <label class="btn" for="upload" style="display:inline-flex;align-items:center;margin:0">Upload a photo instead</label>
        <input type="file" id="upload" accept="image/*" class="sr">
      </div>
      <div class="row"><button id="back">Back</button><button class="primary" id="next" disabled>Continue</button></div>
    </div>`);
    stage.appendChild(p);
    const guide = p.querySelector("#guide"), video = p.querySelector("#video"), frame = p.querySelector("#frame"), cam = p.querySelector("#cam");
    let good = 0, lastMsg = "";
    function show(msg, ok) { guide.textContent = msg; frame.classList.toggle("good", !!ok); if (msg !== lastMsg) { session.prompts++; lastMsg = msg; say(msg); } }
    function captured(src) {
      const c = document.createElement("canvas"); c.width = 480; c.height = 360; c.getContext("2d").drawImage(src, 0, 0, 480, 360);
      stopCamera(); cam.hidden = true;
      p.querySelector("#shot").innerHTML = `<img class="shot" alt="Captured photo of your ID" src="${c.toDataURL("image/jpeg", 0.7)}">`;
      guide.textContent = "Photo taken. Your ID is clear and readable.";
      buzz([80, 60, 80]); say("Got it. Photo taken. Press Continue.", { force: true });
      const next = p.querySelector("#next"); next.disabled = false; next.focus();
    }
    p.querySelector("#start").onclick = async () => {
      try {
        say("Starting camera. A plain dark surface behind the card helps.", { force: true });
        await startCamera(video, "environment"); cam.hidden = false;
        loopTimer = setInterval(() => {
          if (!video.videoWidth) return;
          const gd = guidanceFor(analyzeCard(video));
          if (gd.good) { good++; if (good === 1) buzz(40); } else { if (good) session.retries++; good = 0; }
          show(gd.msg, gd.good);
          if (good >= 4) captured(video);
        }, 250);
      } catch (e) { show("The camera isn't available here. Use Upload a photo instead, or Run guided demo.", false); }
    };
    p.querySelector("#demo").onclick = () => {
      stopCamera(); cam.hidden = false; video.hidden = true;
      const cv = document.createElement("canvas"); cv.width = 640; cv.height = 480; cam.insertBefore(cv, cam.firstChild);
      const script = ["Card not found. Hold your card in front of the camera.", "Move the card closer.", "Move the card left.", "There's glare. Tilt the card slightly.", "Good. Hold still."];
      const pos = [null, [380, 220, 0.45], [420, 210, 0.75], [320, 240, 0.75], [320, 240, 0.75]];
      let i = 0;
      const tick = () => {
        drawSample(cv, pos[i], i === 3); lastMsg = ""; lastSaidAt = 0; show(script[i], i === 4); i++;
        if (i < script.length) setTimeout(tick, 2600);
        else setTimeout(() => { session.retries += 3; captured(cv); cv.remove(); video.hidden = false; }, 2000);
      };
      tick();
    };
    p.querySelector("#upload").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const img = new Image();
      img.onload = () => { const m = analyzeCard(img); if (m.edgeFrac >= 0.015 && m.sharp >= 45 && m.mean >= 55) captured(img); else { session.retries++; show("That photo didn't work. " + guidanceFor(m).msg.replace(" Hold still.", "") + " Try another.", false); } };
      img.src = URL.createObjectURL(f);
    };
    p.querySelector("#back").onclick = () => go(1);
    p.querySelector("#next").onclick = () => go(3);
  }
  function drawSample(cv, pos, glare) {
    const c = cv.getContext("2d");
    c.fillStyle = "#1b1b1f"; c.fillRect(0, 0, cv.width, cv.height);
    if (!pos) return;
    const [x, y, s] = pos, w = 480 * s, h = 302 * s;
    c.save(); c.translate(x - w / 2, y - h / 2);
    c.fillStyle = "#e9eef7"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#2c4ad6"; c.fillRect(0, 0, w, 46 * s);
    c.fillStyle = "#fff"; c.font = `700 ${22 * s}px sans-serif`; c.fillText("SAMPLE ID — NOT REAL", 16 * s, 31 * s);
    c.fillStyle = "#b9c3d9"; c.fillRect(18 * s, 64 * s, 110 * s, 140 * s);
    c.fillStyle = "#1b2440"; c.font = `${18 * s}px sans-serif`;
    ["DOE, ALEX", "DOB 1998-04-12", "L6T 4M2"].forEach((t, i) => c.fillText(t, 150 * s, (92 + i * 34) * s));
    if (glare) { const gr = c.createRadialGradient(w * 0.6, h * 0.4, 5, w * 0.6, h * 0.4, 120 * s); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, w, h); }
    c.restore();
  }

  function viewSelfie() {
    stage.innerHTML = "";
    const p = el(`<div class="panel">
      <h2>Quick face check</h2>
      <p>This confirms a real person is present. No lining anything up. Face the camera and follow the spoken prompts.</p>
      <div class="guide" id="guide" role="status">Press Start face check when you're ready.</div>
      <div class="cam" id="cam" hidden><video id="video" playsinline muted aria-hidden="true"></video></div>
      <div class="row"><button class="primary" id="start">Start face check</button><button id="demo">Run guided demo</button></div>
      <div class="row"><button id="back">Back</button><button class="primary" id="next" disabled>Continue</button></div>
    </div>`);
    stage.appendChild(p);
    const guide = p.querySelector("#guide"), video = p.querySelector("#video");
    const prompts = [{ msg: "Face the camera and hold still.", want: "still" }, { msg: "Slowly turn your head to the left.", want: "move" }, { msg: "Now face the camera again.", want: "still" }];
    const setPrompt = (i) => { guide.textContent = prompts[i].msg; session.prompts++; say(prompts[i].msg, { force: true }); };
    function finish() { stopCamera(); p.querySelector("#cam").hidden = true; guide.textContent = "Face check complete."; buzz([80, 60, 80]); say("Face check complete. Press Continue.", { force: true }); const n = p.querySelector("#next"); n.disabled = false; n.focus(); }
    p.querySelector("#start").onclick = async () => {
      try {
        await startCamera(video, "user"); p.querySelector("#cam").hidden = false;
        let i = 0, prev = null, count = 0, warm = 6; setPrompt(0);
        loopTimer = setInterval(() => {
          if (!video.videoWidth) return;
          const g = grayFrom(video);
          if (prev) {
            let diff = 0, n = 0;
            for (let y = 20; y < 100; y += 2) for (let x = 40; x < 120; x += 2) { diff += Math.abs(g[y * W + x] - prev[y * W + x]); n++; }
            const motion = diff / n;
            if (warm > 0) warm--;
            else {
              count = (prompts[i].want === "still" ? motion < 4 : motion > 9) ? count + 1 : 0;
              if (count >= (prompts[i].want === "still" ? 6 : 2)) { i++; count = 0; warm = 4; if (i >= prompts.length) return finish(); setPrompt(i); }
            }
          }
          prev = g;
        }, 200);
      } catch (e) { guide.textContent = "The camera isn't available here. Use Run guided demo, or go back and verify through your bank."; say(guide.textContent, { force: true }); }
    };
    p.querySelector("#demo").onclick = () => { let i = 0; const step = () => { if (i >= prompts.length) return finish(); setPrompt(i++); setTimeout(step, 2600); }; step(); };
    p.querySelector("#back").onclick = () => go(2);
    p.querySelector("#next").onclick = () => go(4);
  }

  function bankSelect(id) {
    return `<select id="${id}"><option value="">Choose your bank</option>${E.BANKS.map((b) => `<option${session.bank === b ? " selected" : ""}>${b}</option>`).join("")}</select>`;
  }
  // Camera path: the player still names the bank they will deposit from. That bank becomes the AML baseline.
  function viewBankPick() {
    stage.innerHTML = "";
    const p = el(`<div class="panel">
      <h2>Your bank</h2>
      <p>Which bank will you deposit from and withdraw to? Using the same bank keeps your account simple and secure.</p>
      <div><label for="bank">Your bank</label>${bankSelect("bank")}</div>
      <div class="guide" id="guide" role="status">Choose your bank to finish.</div>
      <div class="row"><button id="back">Back</button><button class="primary" id="go">Finish sign-up</button></div>
    </div>`);
    stage.appendChild(p);
    p.querySelector("#back").onclick = () => go(3);
    p.querySelector("#go").onclick = () => {
      const b = p.querySelector("#bank").value;
      if (!b) { p.querySelector("#guide").textContent = "Choose your bank first."; say("Choose your bank first.", { force: true }); p.querySelector("#bank").focus(); return; }
      session.bank = b; go(5);
    };
  }
  function viewBankCheck() {
    stage.innerHTML = "";
    const p = el(`<div class="panel">
      <h2>Verify through your bank</h2>
      <p>You sign in on your bank's own page. Your bank shares only your verified name, date of birth, and address. OLG never sees your banking password.</p>
      <div><label for="bank">Your bank</label>${bankSelect("bank")}<p class="hint">Prototype: no real sign-in happens.</p></div>
      <label class="check" for="consent"><input type="checkbox" id="consent"> I agree to share my verified name, date of birth, and address.</label>
      <div class="guide" id="guide" role="status">Choose your bank to continue.</div>
      <div class="row"><button id="back">Back</button><button class="primary" id="go">Verify with my bank</button></div>
    </div>`);
    stage.appendChild(p);
    const guide = p.querySelector("#guide");
    p.querySelector("#back").onclick = () => go(1);
    p.querySelector("#go").onclick = () => {
      const b = p.querySelector("#bank").value;
      if (!b) { guide.textContent = "Choose your bank first."; say(guide.textContent, { force: true }); p.querySelector("#bank").focus(); return; }
      if (!p.querySelector("#consent").checked) { guide.textContent = "Check the box to agree to sharing first."; say(guide.textContent, { force: true }); p.querySelector("#consent").focus(); return; }
      session.bank = b;
      guide.textContent = "Connecting to " + b + "…"; say(guide.textContent, { force: true });
      setTimeout(() => { guide.textContent = b + " confirmed your name, date of birth, and address."; say(guide.textContent, { force: true }); setTimeout(() => go(3), 1500); }, 1600);
    };
  }

  function viewDone() {
    const d = session.details;
    const mine = load("cp2_players", []);
    const id = "N" + (100 + mine.length + 1);
    const name = d.first + " " + d.last;
    const player = {
      id, name, age: ageOf(d.dob), registeredBank: session.bank, verifiedBy: session.method === "bank" ? "Bank" : "Photo ID + face",
      signupTs: base.asOf - 30 * E.DAY, devices: ["D-" + id], cards: [{ id: "C-" + id, bank: session.bank, holder: name }], payout: "ACC-" + id,
      a11y: { assistiveTech: session.keyboardOnly ? "Keyboard / screen reader" : "Not detected", avgSessionMin: Math.max(1, Math.round((Date.now() - session.startedAt) / 60000)), photoRetries: session.retries, keyboardOnly: session.keyboardOnly },
      kind: "Signed up in this browser", suspicious: false, fromClearPass: true
    };
    mine.push(player); save("cp2_players", mine);
    stage.innerHTML = "";
    const p = el(`<div class="panel">
      <h2>You're verified</h2>
      <div class="result" tabindex="-1"><p><b>Welcome, ${esc(d.first)}.</b> You can start playing. Your verified bank is ${esc(session.bank)}. Reference ${id}.</p></div>
      <div class="note">
        <span class="tag">Demo: what happens next on the analyst side</span>
        <p>Give this new player 30 days of made-up activity, then see how the analyst workbench treats it.</p>
        <div><label for="scenario">Activity to simulate</label>
          <select id="scenario">
            <option value="normal">Normal play</option>
            <option value="vpn">Normal play, VPN on (one red flag)</option>
            <option value="passthrough">Pass-through: big deposits, little play, cash-out to another bank</option>
          </select></div>
        <div class="row"><button class="primary" id="sim">Simulate and open in workbench</button><button id="again">Start a new sign-up</button></div>
      </div>
    </div>`);
    stage.appendChild(p);
    p.querySelector(".result").focus();
    say("You're verified. Welcome, " + d.first + ".", { force: true });
    p.querySelector("#sim").onclick = () => {
      const txs = load("cp2_txs", []).filter((t) => t.playerId !== id).concat(E.simulateFor(player, p.querySelector("#scenario").value, mine.length + 3));
      save("cp2_txs", txs);
      selectedId = id; filter = "all";
      showView("analyst"); tabs[1].btn.focus();
    };
    p.querySelector("#again").onclick = () => { Object.assign(session, { method: null, details: {}, bank: "", startedAt: Date.now(), retries: 0, prompts: 0, keyboardOnly: true }); go(0); };
  }

  // =================================================================
  // 2. ANALYST WORKBENCH
  // =================================================================
  let filter = "alerts";
  let selectedId = null;
  const TIER_ORDER = ["high", "medium", "low", "clear"];
  const decisions = () => load("cp2_decisions", {});

  function renderWorkbench() {
    const { results } = reassess();
    const counts = { high: 0, medium: 0, low: 0, clear: 0 };
    results.forEach((r) => counts[r.tier]++);
    const prot = results.filter((r) => r.protection.length).length;
    const filters = [
      ["alerts", "Open alerts", counts.high + counts.medium, "High + Medium"],
      ["high", "High", counts.high, "Investigate"],
      ["medium", "Medium", counts.medium, "Review"],
      ["low", "Low", counts.low, "Monitor only"],
      ["protection", "Player protection", prot, "Responsible gambling team"],
      ["all", "All players", results.length, "Including clear"]
    ];
    const sum = document.getElementById("summary");
    sum.innerHTML = filters.map(([k, label, n, sub]) => `<button type="button" data-f="${k}" aria-pressed="${filter === k}" aria-label="${label}: ${n}. ${sub}"><span>${label}</span><b>${n}</b><span class="hint" style="margin:0">${sub}</span></button>`).join("");
    sum.querySelectorAll("button").forEach((b) => { b.onclick = () => { filter = b.dataset.f; renderWorkbench(); }; });

    const list = results.filter((r) =>
      filter === "all" ? true : filter === "alerts" ? (r.tier === "high" || r.tier === "medium") : filter === "protection" ? r.protection.length > 0 : r.tier === filter);
    const q = document.getElementById("queue");
    const dec = decisions();
    q.innerHTML = "";
    if (!list.length) q.innerHTML = `<p class="hint">No players in this view.</p>`;
    if (!selectedId || !results.find((r) => r.player.id === selectedId)) selectedId = list[0] ? list[0].player.id : null;
    // Only one queue row is a Tab stop (the open case, else the first row). Arrow keys move between rows,
    // so a keyboard user reaches the case file in one Tab instead of tabbing past every player.
    const tabStop = list.some((r) => r.player.id === selectedId) ? selectedId : list[0] && list[0].player.id;
    list.slice(0, 250).forEach((r) => {
      const b = document.createElement("button");
      b.className = "qitem"; b.dataset.id = r.player.id; b.setAttribute("role", "option");
      b.setAttribute("aria-selected", r.player.id === selectedId ? "true" : "false");
      b.tabIndex = r.player.id === tabStop ? 0 : -1;
      const pat = r.patterns[0] ? r.patterns[0].name.split(":")[0] : r.flags.length ? r.flags.length + " red flag" + (r.flags.length > 1 ? "s" : "") : "No red flags";
      b.innerHTML = `<span class="nm">${esc(r.player.name)}</span><span class="pill ${r.tier}">${r.score} · ${E.TIERS[r.tier].label}</span>
        <span class="meta">${r.player.id} · ${esc(pat)}${dec[r.player.id] ? " · " + esc(dec[r.player.id]) : ""}${r.player.fromClearPass ? " · new via ClearPass" : ""}</span>`;
      b.setAttribute("aria-label", `${r.player.name}, ${E.TIERS[r.tier].label} risk, score ${r.score}, ${pat}${dec[r.player.id] ? ", " + dec[r.player.id] : ""}`);
      b.onclick = () => { selectedId = r.player.id; renderWorkbench(); const h = document.querySelector("#detail h2"); if (h) h.focus(); };
      q.appendChild(b);
    });
    renderCase(results.find((r) => r.player.id === selectedId));
  }
  // Arrow keys move through the queue; Enter or Space opens the case.
  document.getElementById("queue").addEventListener("keydown", (e) => {
    const items = Array.from(document.querySelectorAll("#queue .qitem"));
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const n = items[Math.max(0, Math.min(items.length - 1, to))];
    items.forEach((b) => { b.tabIndex = b === n ? 0 : -1; });
    n.focus();
  });

  function renderCase(a) {
    const box = document.getElementById("detail");
    if (!a) { box.innerHTML = `<p>Select a player from the queue.</p>`; return; }
    const p = a.player, dec = decisions()[p.id];
    const flaggedTx = new Set(a.flags.flatMap((f) => f.txIds));
    const deps = a.window.filter((t) => t.type === "deposit"), wds = a.window.filter((t) => t.type === "withdrawal");
    const groupBy = (list) => { const m = {}; list.forEach((t) => { m[t.bank] = (m[t.bank] || 0) + t.amount; }); return Object.entries(m).sort((x, y) => y[1] - x[1]); };
    const depBanks = groupBy(deps), wdBanks = groupBy(wds);
    const holders = Array.from(new Set(deps.map((t) => t.holder)));
    const recent = a.window.filter((t) => t.type !== "wager" && t.type !== "win").slice(-18).reverse();
    const reason = a.patterns[0];

    box.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><h2 tabindex="-1">${esc(p.name)}</h2><p class="hint" style="margin:0">${p.id} · age ${p.age} · verified by ${esc(p.verifiedBy.toLowerCase())} · verified bank <b>${esc(p.registeredBank)}</b></p></div>
        <span class="tag">${p.fromClearPass ? "Signed up via ClearPass" : "Synthetic player"}</span>
      </div>

      <div class="row" style="align-items:flex-end;gap:18px">
        <span class="score" aria-hidden="true">${a.score}</span><span class="sr">Risk score ${a.score} out of 100.</span>
        <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:220px">
          <span class="pill ${a.tier}" style="align-self:flex-start">${E.TIERS[a.tier].label} risk · ${a.flags.length} red flag${a.flags.length === 1 ? "" : "s"}</span>
          <div class="ladder" role="group" aria-label="Risk ladder">
            ${TIER_ORDER.slice().reverse().map((t, i) => `<div class="${a.tier === t ? "on" : ""}">${E.TIERS[t].label}<br>${["0 flags", "1 flag", "2 flags", "3+ flags"][i]}${a.tier === t ? `<span class="sr">, this player</span>` : ""}</div>`).join("")}
          </div>
        </div>
      </div>
      <p><b>Next step:</b> ${esc(E.TIERS[a.tier].action)}</p>

      ${a.patterns.map((pt, i) => `<div class="pattern ${a.tier === "medium" ? "med" : ""}"><span class="tag">Pattern ${a.patterns.length > 1 ? i + 1 : ""}</span><h3>${esc(pt.name)}</h3><p>${esc(pt.why)}</p><p><b>Recommended:</b> ${esc(pt.next)}</p></div>`).join("")}

      <h3>Red flags and evidence</h3>
      ${a.flags.length ? `<ul class="flags">${a.flags.map((f) => `<li><span class="fam">${esc(f.family)}</span><b>${esc(f.label)}</b><span class="ev">${esc(f.evidence)}</span></li>`).join("")}</ul>` : `<p>No red flags in the last 90 days.</p>`}
      ${a.tier === "low" ? `<div class="note"><span class="tag">Why this is not an alert</span><p>One red flag on its own has an innocent explanation most of the time, like a VPN left on after work or a second personal bank. ClearPass keeps watching quietly and only alerts when a second, independent flag appears. No friction for the player, no wasted analyst time.</p></div>` : ""}

      <h3>Money in and out</h3>
      <div class="flow-map">
        <div><span class="tag">Verified at sign-up</span><b>${esc(p.registeredBank)}</b><span>Card holder: ${esc(p.name)}</span></div>
        <div><span class="tag">Deposits from</span>${depBanks.length ? depBanks.map(([b, v]) => `<span class="${b !== p.registeredBank ? "odd" : ""}">${esc(b)}: ${E.fmt(v)}${b !== p.registeredBank ? " (different bank)" : ""}</span>`).join("") : "<span>None</span>"}
          ${holders.filter((h) => h !== p.name).map((h) => `<span class="odd">Card holder: ${esc(h)}</span>`).join("")}</div>
        <div><span class="tag">Withdrawals to</span>${wdBanks.length ? wdBanks.map(([b, v]) => `<span class="${b !== p.registeredBank ? "odd" : ""}">${esc(b)}: ${E.fmt(v)}${b !== p.registeredBank ? " (different bank)" : ""}</span>`).join("") : "<span>None</span>"}</div>
      </div>

      ${a.linked.length ? `<h3>Linked accounts</h3>${networkSvg(a)}<p class="hint">Accounts connected by a shared device or the same payout account. Review them as one case.</p>` : ""}

      <h3>Recent deposits and withdrawals</h3>
      <div class="tablewrap"><table>
        <caption class="sr">Last ${recent.length} deposits and withdrawals, newest first. Rows marked as evidence are part of a red flag.</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col" class="num">Amount</th><th scope="col">Bank</th><th scope="col">Card holder</th><th scope="col">Notes</th></tr></thead>
        <tbody>${recent.map((t) => {
          const notes = [];
          if (t.bank !== p.registeredBank) notes.push("Different bank");
          if (t.holder !== p.name && t.type === "deposit") notes.push("Third-party card");
          if (t.vpn) notes.push("VPN");
          if (flaggedTx.has(t.id)) notes.push("Evidence");
          return `<tr class="${flaggedTx.has(t.id) ? "hit" : ""}"><td>${E.dstr(t.ts)}</td><td>${t.type === "deposit" ? "Deposit" : "Withdrawal"}</td><td class="num">${E.fmt(t.amount)}</td><td>${esc(t.bank)}</td><td>${t.type === "deposit" ? esc(t.holder) : "–"}</td><td>${notes.join(", ") || "–"}</td></tr>`;
        }).join("") || `<tr><td colspan="6">No deposits or withdrawals in the last 90 days.</td></tr>`}</tbody>
      </table></div>

      ${a.reports.length ? `<div class="note"><span class="tag">FINTRAC reporting due · separate from suspicion</span>${a.reports.map((r) => `<p><b>${esc(r.type)}:</b> ${esc(r.detail)}</p>`).join("")}<p class="hint" style="margin:0">A large payout must be reported even when nothing about it is suspicious.</p></div>` : ""}
      ${a.protection.length ? `<div class="note"><span class="tag">Player protection · routed to responsible gambling, not AML</span>${a.protection.map((x) => `<p>${esc(x)}</p>`).join("")}</div>` : ""}

      <div class="note">
        <span class="tag">Accessibility context · never used in the score</span>
        <dl class="ctx">
          <dt>Assistive technology</dt><dd>${esc(p.a11y.assistiveTech)}</dd>
          <dt>Typical session</dt><dd>${p.a11y.avgSessionMin} min</dd>
          <dt>Photo retries at sign-up</dt><dd>${p.a11y.photoRetries}</dd>
        </dl>
        <p class="hint" style="margin:0">Not scored: ${E.EXCLUDED_SIGNALS.join(", ").toLowerCase()}.</p>
      </div>

      <p class="status" id="status" role="status">Decision: ${esc(dec || "Open")}</p>
      <div class="row">
        <button class="small" data-d="Cleared: explained">Clear (explained)</button>
        <button class="small" data-d="Monitoring">Keep monitoring</button>
        <button class="small" data-d="Escalated to level 2">Escalate</button>
        ${a.tier === "high" || a.tier === "medium" ? `<button class="small primary" id="str-btn">Draft suspicious transaction report</button>` : ""}
      </div>
      <div id="str-box"></div>`;

    box.querySelectorAll("button[data-d]").forEach((b) => b.onclick = () => {
      const d = decisions(); d[p.id] = b.dataset.d; save("cp2_decisions", d);
      announce(p.name + ": " + b.dataset.d);
      renderWorkbench();
      const again = document.querySelector(`#detail button[data-d="${b.dataset.d}"]`); if (again) again.focus();
    });
    const sb = box.querySelector("#str-btn");
    if (sb) sb.onclick = () => {
      const out = box.querySelector("#str-box");
      out.innerHTML = `<div class="note"><label for="str-text">Draft narrative (edit before filing)</label><textarea id="str-text">${esc(E.strNarrative(a))}</textarea><div class="row"><button class="small" id="copy">Copy text</button></div></div>`;
      out.querySelector("#copy").onclick = () => {
        const ta = out.querySelector("#str-text");
        (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(() => announce("Copied"), () => { ta.select(); announce("Text selected. Press Control C to copy."); });
      };
      out.querySelector("textarea").focus();
    };
  }

  // Linked-account graph: this player in the centre, linked accounts around, shared devices and payout accounts as hubs.
  function networkSvg(a) {
    const ctx = assessed.ctx;
    const ids = [a.player.id].concat(a.linked);
    const hubs = [];
    ctx.deviceIndex.forEach((set, key) => { const hit = ids.filter((i) => set.has(i)); if (hit.length > 1) hubs.push({ key, kind: "Device", hit }); });
    ctx.payoutIndex.forEach((set, key) => { const hit = ids.filter((i) => set.has(i)); if (hit.length > 1) hubs.push({ key, kind: "Payout account", hit }); });
    const Wd = 520, Ht = 320, cx = Wd / 2, cy = Ht / 2;
    const pos = {};
    ids.forEach((id, i) => { const ang = (i / ids.length) * Math.PI * 2 - Math.PI / 2; pos[id] = [cx + Math.cos(ang) * 130, cy + Math.sin(ang) * 115]; });
    hubs.forEach((h, i) => { h.x = cx + (i - (hubs.length - 1) / 2) * 110; h.y = cy; });
    const names = {}; assessed.results.forEach((r) => { names[r.player.id] = r; });
    const lines = hubs.flatMap((h) => h.hit.map((id) => `<line x1="${h.x}" y1="${h.y}" x2="${pos[id][0]}" y2="${pos[id][1]}" stroke="var(--muted)" stroke-width="2"/>`)).join("");
    const hubEls = hubs.map((h) => `<rect x="${h.x - 46}" y="${h.y - 16}" width="92" height="32" rx="6" fill="var(--note-bg)" stroke="var(--accent)" stroke-width="2"/><text x="${h.x}" y="${h.y + 5}" text-anchor="middle" font-size="12" fill="var(--fg)">${esc(h.kind)}</text>`).join("");
    const nodes = ids.map((id) => {
      const r = names[id]; const [x, y] = pos[id]; const me = id === a.player.id;
      const col = r ? (r.tier === "high" ? "var(--bad)" : r.tier === "medium" ? "var(--warn)" : "var(--muted)") : "var(--muted)";
      return `<circle cx="${x}" cy="${y}" r="${me ? 24 : 18}" fill="var(--surface)" stroke="${col}" stroke-width="${me ? 4 : 3}"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--fg)">${id}</text>`;
    }).join("");
    const desc = hubs.map((h) => `${h.kind} ${h.key} shared by ${h.hit.join(", ")}`).join(". ");
    return `<div class="tablewrap" style="padding:8px"><svg class="net" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="Linked accounts. ${esc(desc)}.">${lines}${hubEls}${nodes}</svg></div>`;
  }

  // =================================================================
  // 3. RULE VALIDATION
  // =================================================================
  function renderValidation() {
    const { results } = reassess();
    const v = E.validate(results.filter((r) => !r.player.fromClearPass));
    const pct = (x) => Math.round(x * 100) + "%";
    const box = document.getElementById("validation");
    box.innerHTML = `
      <div class="panel">
        <h2>Does pattern matching work?</h2>
        <p>The synthetic population includes ${v.plantedCount} planted launderers across five bank typologies, plus innocent players built to trip exactly one or two red flags. Here is how the pattern rules handled them.</p>
        <div class="metrics">
          <div class="metric"><span>Planted cases caught (Medium or High)</span><b>${v.tp} of ${v.plantedCount}</b><span class="hint">Recall ${pct(v.recall)}</span></div>
          <div class="metric"><span>Alerts that were real</span><b>${pct(v.precision)}</b><span class="hint">${v.fp} innocent player${v.fp === 1 ? "" : "s"} sent to review</span></div>
          <div class="metric"><span>Players monitored</span><b>${v.total}</b><span class="hint">Last 90 days of activity</span></div>
        </div>
      </div>

      <div class="compare">
        <div class="panel"><span class="tag">One red flag = alert</span><h3>${v.singleRule.alerts} alerts, ${v.singleRule.falsePositives} innocent</h3><p>Every VPN user and every player with a second bank gets flagged. Analysts drown and good customers get friction.</p></div>
        <div class="panel"><span class="tag">ClearPass patterns</span><h3>${v.patternRule.alerts} alerts, ${v.patternRule.falsePositives} innocent</h3><p>A single flag is watched quietly. Alerts start when independent flags corroborate. ${v.singleRule.falsePositives - v.patternRule.falsePositives} fewer innocent players flagged on the same data.</p></div>
      </div>

      <div class="panel">
        <h3>Result by player type</h3>
        <div class="tablewrap"><table>
          <thead><tr><th scope="col">Player type</th><th scope="col">Planted as</th><th scope="col" class="num">Players</th><th scope="col" class="num">Clear</th><th scope="col" class="num">Low</th><th scope="col" class="num">Medium</th><th scope="col" class="num">High</th></tr></thead>
          <tbody>${v.byKind.map((k) => `<tr><th scope="row">${esc(k.kind)}</th><td>${k.suspicious ? "Suspicious" : "Innocent"}</td><td class="num">${k.count}</td><td class="num">${k.clear}</td><td class="num">${k.low}</td><td class="num">${k.medium}</td><td class="num">${k.high}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="hint">Read this honestly: the suspicious cases were planted by us, so a high catch rate is expected. The useful results are that innocent single-flag players stay at Low, legitimate high rollers stay Clear because they're compared to their own history, and the spouse's-card cases show that Medium means "a person checks", not "guilty". Real data will be messier.</p>
      </div>

      <div class="panel">
        <h3>The rules, in plain language</h3>
        <div class="tablewrap"><table>
          <thead><tr><th scope="col">Red flag</th><th scope="col">Family</th><th scope="col" class="num">Weight</th></tr></thead>
          <tbody>${Object.values(E.FLAGS).map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(f.family)}</td><td class="num">${f.weight}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="hint">Tier comes from the number of red flags (0 Clear, 1 Low, 2 Medium, 3+ High). Weights only order cases inside a tier. A single transaction under $10,000 never alerts on its own; it only counts as part of a pattern, such as several deposits in 24 hours that add up to $10,000 or more.</p>
      </div>`;
  }

  go(0);
})();
