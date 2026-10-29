/*
 * "Jump-starting the server" scene for the sign-in pages.
 *
 * Render's free plan puts the backend to sleep when idle, and the first
 * request then takes 30-60 seconds. When a sign-in page opens, this pings
 * /health. If the server has not answered within WAIT_MS, it shows a small
 * comic card (a bunny jump-starting a sleepy server from a car battery) with
 * a progress bar, and asks the live background to speed up. When the server
 * answers, the bar fills, the server wakes, and the card folds away.
 *
 * The form stays usable the whole time; nothing here blocks signing in.
 */
(function () {
  "use strict";

  const config = window.NTT_CONFIG || {};
  const apiBase = String(config.apiBaseUrl || "").replace(/\/$/, "");
  const panel = document.querySelector(".auth-body .brand-panel");
  if (!apiBase || !panel || !window.fetch) {
    return;
  }

  const WAIT_MS = 1200; // a warm server answers well inside this
  const RETRY_MS = 3000; // if the ping fails outright, try again
  const SLOW_MS = 95000; // past this, admit it is taking a while
  const EXPECT_MS = 45000; // typical wake time; shapes the progress curve

  const LINES = [
    ["The server is napping.", "Bunny has found the jumper cables."],
    ["Red to red, black to black…", "Bunny double-checked. Twice."],
    ["Charging up.", "12 volts of pure optimism."],
    ["Revving the engine.", "Vroom. Ish."],
    ["Lights are flickering!", "Free servers nap when idle — we'll be up in a minute."],
    ["Almost awake.", "One more crank should do it."],
  ];

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let settled = false;
  let shown = false;
  let startedAt = 0;
  let raf = 0;
  let lineIndex = -1;
  let card = null;
  let els = {};

  function bg(speed) {
    if (window.NTTLiveBg && typeof window.NTTLiveBg.setSpeed === "function") {
      window.NTTLiveBg.setSpeed(speed);
    }
  }

  const svg = `
<svg class="ws-art" viewBox="0 0 300 124" role="img" aria-label="A bunny jump-starting a sleepy server from a car battery">
  <line class="ws-ground" x1="6" y1="112" x2="294" y2="112"/>

  <!-- car battery -->
  <g class="ws-battery">
    <rect x="22" y="66" width="74" height="46" rx="7" class="ws-batt-body"/>
    <rect x="22" y="66" width="74" height="9" rx="4" class="ws-batt-lid"/>
    <rect x="31" y="58" width="12" height="9" rx="2" class="ws-term-pos"/>
    <rect x="75" y="58" width="12" height="9" rx="2" class="ws-term-neg"/>
    <text x="37" y="94" class="ws-sign">+</text>
    <text x="81" y="94" class="ws-sign">−</text>
    <path d="M61 80 l-7 13 h6 l-3 11 l10 -15 h-6 l4 -9 z" class="ws-bolt"/>
  </g>

  <!-- cables: black lies on the ground, red goes through the bunny's paw -->
  <path d="M81 60 C 84 34, 120 120, 164 110 S 200 104, 210 100" class="ws-cable ws-cable-neg"/>
  <path id="ws-red" d="M37 60 C 44 14, 150 6, 200 52" class="ws-cable ws-cable-pos"/>
  <path d="M37 60 C 44 14, 150 6, 200 52" class="ws-pulse"/>
  <rect x="206" y="96" width="9" height="8" rx="2" class="ws-clamp-neg"/>

  <!-- sleepy server -->
  <g class="ws-server">
    <rect x="210" y="26" width="72" height="86" rx="9" class="ws-srv-body"/>
    <rect x="218" y="36" width="56" height="26" rx="5" class="ws-srv-face"/>
    <g class="ws-eyes-shut">
      <path d="M231 50 q5 4 10 0" /><path d="M251 50 q5 4 10 0" />
    </g>
    <g class="ws-eyes-open">
      <circle cx="236" cy="48" r="3.2"/><circle cx="256" cy="48" r="3.2"/>
      <path d="M239 56 q7 5 14 0" class="ws-smile"/>
    </g>
    <rect x="218" y="68" width="56" height="12" rx="3" class="ws-slot"/>
    <rect x="218" y="86" width="56" height="12" rx="3" class="ws-slot"/>
    <circle cx="266" cy="74" r="2.6" class="ws-led ws-led-1"/>
    <circle cx="258" cy="74" r="2.6" class="ws-led ws-led-2"/>
    <circle cx="266" cy="92" r="2.6" class="ws-led ws-led-3"/>
    <circle cx="258" cy="92" r="2.6" class="ws-led ws-led-4"/>
    <g class="ws-zzz">
      <text x="276" y="22">z</text><text x="284" y="12">z</text><text x="291" y="3">z</text>
    </g>
  </g>

  <!-- the bunny, holding the red clamp to the server -->
  <g class="ws-bunny">
    <g class="ws-bunny-inner">
      <g class="ws-ear ws-ear-back"><ellipse cx="168" cy="40" rx="5" ry="15"/><ellipse cx="168" cy="42" rx="2.2" ry="10" class="ws-ear-in"/></g>
      <g class="ws-ear ws-ear-front"><ellipse cx="180" cy="38" rx="5" ry="15"/><ellipse cx="180" cy="40" rx="2.2" ry="10" class="ws-ear-in"/></g>
      <circle cx="152" cy="96" r="6" class="ws-tail"/>
      <ellipse cx="166" cy="92" rx="16" ry="18" class="ws-fur"/>
      <circle cx="174" cy="64" r="13" class="ws-fur"/>
      <circle cx="180" cy="62" r="1.9" class="ws-eye"/>
      <ellipse cx="186.5" cy="66" rx="2" ry="1.5" class="ws-nose"/>
      <circle cx="178" cy="70" r="2.6" class="ws-cheek"/>
      <path d="M174 86 L 197 60" class="ws-arm"/>
      <ellipse cx="160" cy="110" rx="8" ry="3.4" class="ws-fur"/>
      <ellipse cx="176" cy="110" rx="8" ry="3.4" class="ws-fur"/>
      <!-- goggles strap: safety first -->
      <path d="M163 58 q11 -6 22 -2" class="ws-strap"/>
    </g>
  </g>
  <rect x="196" y="47" width="11" height="9" rx="2" class="ws-clamp-pos"/>

  <!-- sparks at the clamp -->
  <g class="ws-sparks">
    <path d="M208 46 l6 -6"/><path d="M210 52 l8 0"/><path d="M208 57 l6 5"/>
  </g>
</svg>`;

  function build() {
    card = document.createElement("div");
    card.className = "wake-scene";
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    card.innerHTML = `
      ${svg}
      <div class="ws-copy">
        <p class="ws-title" data-ws="title"></p>
        <p class="ws-sub" data-ws="sub"></p>
      </div>
      <div class="ws-bar" aria-hidden="true"><span class="ws-bar-fill" data-ws="fill"></span></div>
      <p class="ws-meta"><span data-ws="pct">0%</span><span data-ws="note">You can sign in meanwhile</span></p>`;
    els = {
      title: card.querySelector('[data-ws="title"]'),
      sub: card.querySelector('[data-ws="sub"]'),
      fill: card.querySelector('[data-ws="fill"]'),
      pct: card.querySelector('[data-ws="pct"]'),
      note: card.querySelector('[data-ws="note"]'),
    };
    const anchor = panel.querySelector(".brand-partner");
    panel.insertBefore(card, anchor || null);
  }

  function setLine(index) {
    if (index === lineIndex) return;
    lineIndex = index;
    const [title, sub] = LINES[index];
    els.title.textContent = title;
    els.sub.textContent = sub;
  }

  function progressAt(elapsed) {
    // Eases toward 94% so it keeps moving but never claims "done" early.
    return 0.94 * (1 - Math.exp(-elapsed / (EXPECT_MS / 2.2)));
  }

  function tick() {
    if (settled) return;
    const elapsed = performance.now() - startedAt;
    const p = progressAt(elapsed);
    els.fill.style.transform = `scaleX(${p.toFixed(4)})`;
    els.pct.textContent = `${Math.round(p * 100)}%`;
    card.style.setProperty("--ws-p", p.toFixed(3));
    card.dataset.level = String(Math.min(4, Math.floor(p * 5)));
    setLine(Math.min(LINES.length - 1, Math.floor(elapsed / (EXPECT_MS / LINES.length))));
    if (elapsed > SLOW_MS) {
      els.note.textContent = "Taking longer than usual — hang tight";
    }
    bg(1 + p * 4.5);
    raf = window.setTimeout(tick, reduceMotion ? 1000 : 120);
  }

  function show() {
    if (shown || settled) return;
    shown = true;
    build();
    document.body.classList.add("wake-scene-on");
    startedAt = performance.now();
    requestAnimationFrame(() => card.classList.add("is-in"));
    tick();
  }

  function ready() {
    if (settled) return;
    settled = true;
    window.clearTimeout(raf);
    if (!shown) return; // server was already awake: show nothing
    card.classList.add("is-ready");
    card.dataset.level = "5";
    els.fill.style.transform = "scaleX(1)";
    els.pct.textContent = "100%";
    els.title.textContent = "We're up!";
    els.sub.textContent = "Server's awake and caffeinated. Go ahead and sign in.";
    els.note.textContent = "Thanks, bunny";
    bg(7);
    window.setTimeout(() => bg(1), 900);
    window.setTimeout(() => {
      card.classList.add("is-out");
      document.body.classList.remove("wake-scene-on");
      window.setTimeout(() => card.remove(), 600);
    }, 3200);
  }

  function ping() {
    window
      .fetch(`${apiBase}/health`, { mode: "no-cors", cache: "no-store" })
      .then(ready)
      .catch(() => {
        // Network error (offline, or Render still swapping in): keep waiting.
        if (!settled) window.setTimeout(ping, RETRY_MS);
      });
  }

  window.setTimeout(show, WAIT_MS);
  ping();
})();
