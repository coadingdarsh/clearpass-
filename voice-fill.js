/*
  voice-fill.js — fill a form by voice.
  The app asks each question out loud, listens, reads the answer back,
  and fills the field only after the person says "yes".

  Setup:
    1. Put this file next to index.html.
    2. Add a button inside or above your form:
         <button type="button" id="voice-fill-btn">Fill this form by voice</button>
    3. Before </body>, add:
         <script src="voice-fill.js"></script>
         <script>VoiceFill.attach("#voice-fill-btn", "form");</script>

  Voice commands at any point: "skip", "repeat", "stop".
  Escape key also stops.
  Works in Chrome and Edge. Speech recognition in Chrome is processed by
  Google's servers, so only use made-up details while this is a prototype.
*/
(function () {
  "use strict";

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ---------- speaking and listening ----------
  function speak(text) {
    return new Promise((resolve) => {
      announce(text);
      if (!("speechSynthesis" in window)) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-CA";
      u.rate = 1;
      u.onend = resolve;
      u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }

  // Short tone so the person knows when to start talking.
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      osc.onended = () => ctx.close();
    } catch (e) { /* no audio, carry on */ }
  }

  let activeRec = null;
  function listen() {
    return new Promise((resolve) => {
      const rec = new Recognition();
      rec.lang = "en-CA";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      let heard = "";
      rec.onresult = (e) => { heard = e.results[0][0].transcript.trim(); };
      rec.onerror = () => {};
      rec.onend = () => { activeRec = null; resolve(heard); };
      activeRec = rec;
      beep();
      setTimeout(() => { try { rec.start(); } catch (e) { resolve(""); } }, 200);
    });
  }

  // Screen reader announcements.
  let live;
  function announce(text) {
    if (!live) {
      live = document.createElement("div");
      live.setAttribute("aria-live", "assertive");
      live.setAttribute("aria-atomic", "true");
      live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
      document.body.appendChild(live);
    }
    live.textContent = "";
    setTimeout(() => { live.textContent = text; }, 30);
  }

  // ---------- figuring out what each field is ----------
  function labelFor(input) {
    if (input.id) {
      const l = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
      if (l) return l.textContent.trim();
    }
    const wrap = input.closest("label");
    if (wrap) return wrap.textContent.trim();
    return input.getAttribute("aria-label") || input.placeholder || input.name || "this field";
  }

  function kindOf(input, label) {
    const hint = [input.type, input.name, input.id, input.autocomplete, label].join(" ").toLowerCase();
    if (input.type === "email" || /e-?mail/.test(hint)) return "email";
    if (input.type === "date") return "date";
    if (/postal|postcode|zip/.test(hint)) return "postal";
    if (/\bmonth\b|bday-month/.test(hint)) return "month";
    if (/\bday\b|bday-day/.test(hint)) return "day";
    if (/\byear\b|bday-year/.test(hint)) return "year";
    if (/phone|tel/.test(hint)) return "phone";
    if (/name/.test(hint)) return "name";
    return "text";
  }

  // ---------- cleaning up what speech recognition returns ----------
  const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const NUMBER_WORDS = { zero:0, oh:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
    eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20,
    first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10 };

  function toNumber(text) {
    const t = text.toLowerCase().replace(/(st|nd|rd|th)\b/g, "");
    const digits = t.replace(/[^0-9]/g, "");
    if (digits) return digits;
    const word = t.trim().split(/\s+/).pop();
    return NUMBER_WORDS[word] !== undefined ? String(NUMBER_WORDS[word]) : "";
  }

  function monthNumber(text) {
    const t = text.toLowerCase();
    const i = MONTHS.findIndex((m) => t.includes(m) || t.includes(m.slice(0, 3)));
    return i >= 0 ? String(i + 1) : toNumber(t);
  }

  const clean = {
    email(t) {
      return t.toLowerCase()
        .replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".")
        .replace(/\s+underscore\s+/g, "_").replace(/\s+(dash|hyphen)\s+/g, "-")
        .replace(/\s+/g, "");
    },
    postal(t) {
      const s = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
      return s.length === 6 ? s.slice(0, 3) + " " + s.slice(3) : s;
    },
    name(t) { return t.replace(/\b\w/g, (c) => c.toUpperCase()); },
    day: toNumber,
    month: monthNumber,
    year: toNumber,
    phone(t) { return t.replace(/[^0-9]/g, ""); },
    date(t) {
      // "March 27 1998" or "27 March 1998" -> 1998-03-27
      const m = monthNumber(t);
      const nums = t.replace(/[a-z]+/gi, " ").match(/\d+/g) || [];
      const year = nums.find((n) => n.length === 4);
      const day = nums.find((n) => n.length <= 2);
      if (!m || !year || !day) return "";
      return year + "-" + m.padStart(2, "0") + "-" + day.padStart(2, "0");
    },
    text(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  };

  // How the answer is read back. Names and postal codes get spelled out,
  // because "Darsh" and "Darch" sound the same.
  function readBack(kind, value) {
    const spell = (s) => s.replace(/\s/g, "").split("").join(", ");
    if (kind === "name") return value + ". Spelled " + spell(value);
    if (kind === "postal") return spell(value);
    if (kind === "email") return value.replace("@", " at ").replace(/\./g, " dot ");
    if (kind === "month") return MONTHS[Number(value) - 1] || value;
    if (kind === "date") return new Date(value + "T12:00").toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
    return value;
  }

  // Works with plain inputs and with React-style controlled inputs.
  function setValue(input, value) {
    const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ---------- the guided flow ----------
  let stopped = false;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !stopped) { stopped = true; if (activeRec) activeRec.abort(); speechSynthesis.cancel(); }
  });

  async function fillField(input) {
    const label = labelFor(input);
    const kind = kindOf(input, label);
    for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
      await speak(attempt === 0 ? label + "?" : "Let's try again. " + label + "?");
      const heard = await listen();
      if (stopped) return;
      const said = heard.toLowerCase();
      if (!heard) { await speak("I didn't hear anything."); continue; }
      if (said === "stop") { stopped = true; return; }
      if (said === "skip") { await speak("Skipped."); return; }
      if (said === "repeat") { attempt--; continue; }

      const value = clean[kind](heard);
      if (!value) { await speak("I couldn't understand that as a " + kind + "."); continue; }

      await speak("I heard " + readBack(kind, value) + ". Is that right? Say yes or no.");
      const answer = (await listen()).toLowerCase();
      if (/^(yes|yeah|yep|correct|right)/.test(answer)) {
        setValue(input, value);
        return;
      }
    }
    if (!stopped) {
      input.focus();
      await speak("I'll leave " + label + " for you to type. Moving on.");
    }
  }

  async function run(form) {
    stopped = false;
    const fields = Array.from(form.querySelectorAll("input, select"))
      .filter((el) => !el.disabled && el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && el.offsetParent !== null);
    await speak("I'll ask " + fields.length + " questions. Answer after each beep. You can say skip, repeat, or stop.");
    for (const field of fields) {
      if (stopped) break;
      if (field.value) continue; // don't overwrite what's already filled
      field.scrollIntoView({ block: "center" });
      await fillField(field);
    }
    await speak(stopped ? "Voice filling stopped. Your answers so far are saved in the form." : "All done. Please review the form, then press Continue.");
  }

  window.VoiceFill = {
    supported: !!Recognition,
    run(form) { if (Recognition && form) return run(form); },
    attach(buttonSelector, formSelector) {
      const btn = document.querySelector(buttonSelector);
      if (!btn) return;
      if (!Recognition) {
        // Firefox and some others have no speech recognition. Point to the system dictation instead.
        btn.disabled = true;
        btn.textContent = "Voice filling needs Chrome or Edge. You can also use Windows voice typing: Windows key + H.";
        return;
      }
      btn.addEventListener("click", () => {
        const form = document.querySelector(formSelector);
        if (form) run(form);
      });
    }
  };
})();
