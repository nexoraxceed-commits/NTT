/*
 * NTT UI kit — small, dependency-free motion and feedback layer.
 *
 * Loaded on every page right after config.js and before app.js. Everything
 * here is additive: if this file fails to load, the site works exactly as
 * before. Nothing here changes what data is sent to or read from the backend.
 *
 * Ported to vanilla JS from:
 *   - Rare UI (https://rareui.com) by Swami Malode — Fluid Orb, Animated Counter.
 *     MIT + Commons Clause + Attribution licence; used here for internal,
 *     non-commercial use with credit.
 *   - Amicro (https://github.com/Subhan-code/Amicro--Micro-transitions-) by
 *     Syed Subhan Uddin, MIT — Dynamic Island toast, skeleton shimmer,
 *     staggered fade-up, sliding toggle, web haptics.
 */
(function () {
  "use strict";

  const config = window.NTT_CONFIG || {};
  const apiBase = String(config.apiBaseUrl || "").replace(/\/$/, "");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------ haptics */

  function haptic(pattern = 10) {
    try {
      if (navigator.vibrate && window.matchMedia("(pointer: coarse)").matches) {
        navigator.vibrate(pattern);
      }
    } catch (_error) {
      // Haptics are a nicety; ignore any failure.
    }
  }

  /* ------------------------------------------------------ dynamic island */

  let island = null;
  let islandTimer = null;
  let islandSticky = null;

  const ISLAND_ICONS = {
    success: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    error: '<path d="M12 7v6"/><path d="M12 17h.01"/>',
    info: '<path d="M12 11v6"/><path d="M12 7h.01"/>',
    wait: "",
  };

  function ensureIsland() {
    if (island) {
      return island;
    }
    island = document.createElement("div");
    island.className = "ui-island";
    island.setAttribute("role", "status");
    island.setAttribute("aria-live", "polite");
    island.innerHTML = `
      <span class="ui-island-icon" aria-hidden="true"></span>
      <span class="ui-island-text"></span>`;
    island.addEventListener("click", () => {
      if (!islandSticky) {
        hideIsland();
      }
    });
    document.body.append(island);
    return island;
  }

  function paintIsland(text, tone) {
    const el = ensureIsland();
    el.dataset.tone = tone;
    const iconEl = el.querySelector(".ui-island-icon");
    iconEl.innerHTML =
      tone === "wait"
        ? '<span class="ui-island-spinner"></span>'
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ISLAND_ICONS[tone] || ISLAND_ICONS.info}</svg>`;
    el.querySelector(".ui-island-text").textContent = text;
    // Restart the morph so each new message visibly lands.
    el.classList.remove("is-shown");
    void el.offsetWidth;
    el.classList.add("is-shown");
  }

  function hideIsland() {
    clearTimeout(islandTimer);
    if (island) {
      island.classList.remove("is-shown");
    }
  }

  /**
   * Show a short message in the pill at the top of the screen.
   * tone: "success" | "error" | "info" | "wait". sticky messages stay until
   * dismissed with toast.clear(id).
   */
  function toast(text, options = {}) {
    const { tone = "success", sticky = false, id = null, duration = 2800 } = options;
    if (!text || !document.body) {
      return;
    }
    clearTimeout(islandTimer);
    islandSticky = sticky ? id || "sticky" : null;
    paintIsland(text, tone);
    if (tone === "success") {
      haptic(12);
    } else if (tone === "error") {
      haptic([18, 60, 18]);
    }
    if (!sticky) {
      islandTimer = setTimeout(hideIsland, duration);
    }
  }

  toast.clear = function clear(id) {
    if (!id || islandSticky === id) {
      islandSticky = null;
      hideIsland();
    }
  };

  /* ---------------------------------------- server wake-up (Render free) */

  // Render's free plan puts the backend to sleep after ~15 idle minutes; the
  // first request then takes 30-60 seconds. We (1) nudge the server awake as
  // soon as any page opens, and (2) explain the wait instead of looking frozen.

  const WAKE_DELAY_MS = 5000;
  const PREWARM_KEY = "ntt-prewarm-at";
  let pending = 0;
  let wakeTimer = null;
  let wakeShown = false;

  function prewarm() {
    if (!apiBase) {
      return;
    }
    try {
      const last = Number(window.sessionStorage.getItem(PREWARM_KEY) || 0);
      if (Date.now() - last < 4 * 60 * 1000) {
        return;
      }
      window.sessionStorage.setItem(PREWARM_KEY, String(Date.now()));
    } catch (_error) {
      // Storage can be blocked; ping anyway.
    }
    // no-cors: we only want the server to wake, not to read the reply.
    nativeFetch(`${apiBase}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {});
  }

  function startWaitWatch() {
    pending += 1;
    if (pending === 1 && !wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = null;
        // The sign-in pages show their own wake-up scene (Js/wake-scene.js).
        if (pending > 0 && !document.body.classList.contains("wake-scene-on")) {
          wakeShown = true;
          toast("Waking up the server — this can take up to a minute", {
            tone: "wait",
            sticky: true,
            id: "wake",
          });
        }
      }, WAKE_DELAY_MS);
    }
  }

  function endWaitWatch() {
    pending = Math.max(0, pending - 1);
    if (pending === 0) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
      if (wakeShown) {
        wakeShown = false;
        toast.clear("wake");
        toast("Connected", { tone: "success", duration: 1400 });
      }
    }
  }

  const nativeFetch = window.fetch.bind(window);

  window.fetch = function nttFetch(input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const watch = apiBase && typeof url === "string" && url.startsWith(apiBase);
    if (!watch) {
      return nativeFetch(input, init);
    }
    startWaitWatch();
    return nativeFetch(input, init).finally(endWaitWatch);
  };

  /* ------------------------------------------------ inline message mirror */

  // app.js shows feedback in small text under forms. Successes now also pop in
  // the island so they are seen on phones; errors pop only if the inline text
  // is scrolled out of view. The inline text is untouched.
  function isInView(el) {
    if (!el || !el.getBoundingClientRect) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
  }

  function hookSetMessage() {
    if (typeof window.setMessage !== "function" || window.setMessage.__nttWrapped) {
      return;
    }
    const original = window.setMessage;
    const wrapped = function setMessage(element, text, isError = false) {
      original(element, text, isError);
      const message = String(text || "").trim();
      if (!message || /(\.\.\.|…)$/.test(message)) {
        return;
      }
      if (isError) {
        // A failed load should not leave grey placeholders shimmering forever.
        document.querySelectorAll(".ui-skel-stack").forEach((el) => el.remove());
        document.querySelectorAll("[aria-busy='true']").forEach((el) => el.removeAttribute("aria-busy"));
        if (!isInView(element) && !/redirecting/i.test(message)) {
          toast(message, { tone: "error", duration: 4200 });
        }
        return;
      }
      toast(message, { tone: "success" });
    };
    wrapped.__nttWrapped = true;
    window.setMessage = wrapped;
  }

  /* ------------------------------------------------------ rolling counter */

  function digitColumn(digit) {
    const col = document.createElement("span");
    col.className = "ui-roll-col";
    const strip = document.createElement("span");
    strip.className = "ui-roll-strip";
    strip.innerHTML = "0123456789"
      .split("")
      .map((d) => `<span>${d}</span>`)
      .join("");
    strip.style.transform = `translateY(-${digit}em)`;
    col.append(strip);
    return col;
  }

  /** Roll an element's number from `from` to `to`, digit by digit. */
  function rollNumber(el, to, from = 0) {
    const target = Math.max(0, Math.round(Number(to) || 0));
    const start = Math.max(0, Math.round(Number(from) || 0));
    if (reduceMotion || target === start) {
      el.textContent = String(target);
      return;
    }
    const toDigits = String(target).split("").map(Number);
    const fromDigits = String(start).padStart(toDigits.length, "0").slice(-toDigits.length).split("").map(Number);
    el.textContent = "";
    el.classList.add("ui-roll");
    el.setAttribute("aria-label", String(target));
    const strips = toDigits.map((_, i) => {
      const col = digitColumn(fromDigits[i]);
      col.setAttribute("aria-hidden", "true");
      el.append(col);
      return col.firstChild;
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        strips.forEach((strip, i) => {
          strip.style.transitionDelay = `${(toDigits.length - 1 - i) * 45}ms`;
          strip.style.transform = `translateY(-${toDigits[i]}em)`;
        });
      });
    });
  }

  /* ----------------------------------------------------------- fluid orb */

  const ORB_VERT = "attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}";
  const ORB_FRAG = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec3 u_color;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
    float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);}
    float fbm(vec2 p){float v=0.0;float a=0.6;for(int i=0;i<3;i++){v+=a*noise(p);p*=2.0;a*=0.5;}return v;}
    void main(){
      vec2 uv=gl_FragCoord.xy/u_resolution.xy;
      float t=u_time*0.22;
      vec2 drift=vec2(sin(t)+0.6*sin(t*1.7+1.3),cos(t*0.8)+0.6*cos(t*1.3+2.1));
      vec2 p=vec2(uv.x*1.8,uv.y)+drift*0.7;
      vec2 q=vec2(fbm(p+drift),fbm(p+vec2(3.2,1.5)-drift));
      float f=fbm(p+1.2*q);
      float g=clamp(1.0-uv.y,0.0,1.0);
      float anchor=smoothstep(0.0,0.3,uv.y);
      float shade=clamp(g+(f-0.5)*0.8*anchor,0.0,1.0);
      vec3 white=vec3(0.99,1.0,1.0);
      vec3 light=mix(white,u_color,0.5);
      vec3 col=white;
      col=mix(col,light,smoothstep(0.28,0.52,shade));
      col=mix(col,u_color,smoothstep(0.58,0.88,shade));
      float edge=smoothstep(0.5,0.49,distance(uv,vec2(0.5)));
      gl_FragColor=vec4(col*edge,edge);
    }`;

  function hexToRgb(hex) {
    let h = String(hex || "").replace("#", "").trim();
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    const n = parseInt(h, 16);
    if (h.length !== 6 || Number.isNaN(n)) {
      return [0.04, 0.42, 0.96];
    }
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /**
   * Create a living orb. Returns { element, setColor(hex) } or null when
   * WebGL is unavailable (callers then simply show nothing).
   */
  function createOrb(size = 44, color = "#0a6cf5") {
    const wrap = document.createElement("span");
    wrap.className = "ui-orb";
    wrap.style.width = `${size}px`;
    wrap.style.height = `${size}px`;
    const canvas = document.createElement("canvas");
    wrap.append(canvas);

    const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) {
      wrap.classList.add("is-static");
      wrap.style.setProperty("--orb", color);
      return { element: wrap, setColor: (c) => wrap.style.setProperty("--orb", c) };
    }

    function compile(type, src) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    }
    const program = gl.createProgram();
    const vert = compile(gl.VERTEX_SHADER, ORB_VERT);
    const frag = compile(gl.FRAGMENT_SHADER, ORB_FRAG);
    if (!vert || !frag) {
      return null;
    }
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return null;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uTime = gl.getUniformLocation(program, "u_time");
    const uColor = gl.getUniformLocation(program, "u_color");

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    gl.viewport(0, 0, px, px);
    gl.uniform2f(gl.getUniformLocation(program, "u_resolution"), px, px);

    let current = hexToRgb(color);
    let target = current.slice();
    gl.uniform3f(uColor, ...current);

    const startAt = performance.now();
    let raf = 0;
    let lastFrame = 0;
    let visible = true;

    function frame(now) {
      raf = 0;
      // ~30fps is plenty for a slow drift and halves the GPU cost.
      if (now - lastFrame >= 33) {
        lastFrame = now;
        current = current.map((c, i) => c + (target[i] - c) * 0.08);
        gl.uniform3f(uColor, ...current);
        gl.uniform1f(uTime, reduceMotion ? 0 : (now - startAt) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (!reduceMotion && visible && !document.hidden) {
        raf = requestAnimationFrame(frame);
      }
    }
    function wake() {
      if (!raf) {
        raf = requestAnimationFrame(frame);
      }
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) {
          wake();
        }
      }).observe(wrap);
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        wake();
      }
    });
    wake();

    return {
      element: wrap,
      setColor(hex) {
        target = hexToRgb(hex);
        if (reduceMotion) {
          current = target.slice();
        }
        wake();
      },
    };
  }

  /* ------------------------------------------------------- dashboard hook */

  const dash = {
    counts: null,
    scope: null,
    open: null,
    orb: null,
  };

  const ORB_COLORS = {
    good: "#2ba84a",
    soon: "#f28c1e",
    late: "#e5352b",
    team: "#0a6cf5",
  };

  function placeSegPill(seg, fromScope, toScope) {
    if (!seg) {
      return;
    }
    let pill = seg.querySelector(".ui-seg-pill");
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "ui-seg-pill";
      pill.setAttribute("aria-hidden", "true");
      seg.prepend(pill);
    }
    seg.classList.add("ui-seg");
    const target = seg.querySelector(`[data-dash-scope="${toScope}"]`);
    const origin = seg.querySelector(`[data-dash-scope="${fromScope || toScope}"]`) || target;
    if (!target) {
      return;
    }
    const put = (button) => {
      pill.style.width = `${button.offsetWidth}px`;
      pill.style.transform = `translateX(${button.offsetLeft - 2}px)`;
    };
    pill.style.transition = "none";
    put(origin);
    if (origin !== target && !reduceMotion) {
      void pill.offsetWidth;
      pill.style.transition = "";
      requestAnimationFrame(() => put(target));
    } else {
      put(target);
    }
  }

  /**
   * Called by dashboard.js after every redraw. info:
   *   { scope, open, counts: {open, progress, overdue, closed}, dueSoon }
   */
  function enhanceDashboard(container, info = {}) {
    if (!container) {
      return;
    }
    container.removeAttribute("aria-busy");
    const firstDraw = dash.counts === null;
    const scopeChanged = !firstDraw && dash.scope !== info.scope;

    // Rolling numbers on the status cards: from 0 on first load, from the
    // old value when live refresh changes a count, untouched otherwise.
    container.querySelectorAll("[data-dash-kpi]").forEach((card) => {
      const key = card.dataset.dashKpi;
      const numEl = card.querySelector(".dash-kpi-num");
      if (!numEl) {
        return;
      }
      const to = Number(numEl.textContent) || 0;
      const from = firstDraw ? 0 : dash.counts[key];
      if (from !== undefined && from !== to) {
        rollNumber(numEl, to, scopeChanged ? from : from);
      }
    });

    // Sliding pill behind My work / Team.
    placeSegPill(container.querySelector(".dash-seg"), dash.scope, info.scope);

    // Cards cascade in on first load and when switching view.
    if (firstDraw || scopeChanged) {
      const items = [
        ...container.querySelectorAll(".dash-kpi"),
        ...container.querySelectorAll(".dash-grid > *"),
      ];
      items.forEach((item, index) => {
        item.style.setProperty("--ui-i", String(Math.min(index, 10)));
        item.classList.add("ui-rise");
      });
    }

    // Expanding a status card slides its list open.
    if (info.open && info.open !== dash.open) {
      container.querySelector("#dash-drawer")?.classList.add("ui-unfold");
    }

    // Status orb beside the greeting: green when clear, amber when work is
    // due this week, red when anything is overdue; blue in team view.
    const slot = container.querySelector(".dash-head-copy");
    if (slot) {
      if (!dash.orb) {
        dash.orb = createOrb(40);
        if (dash.orb) {
          dash.orb.element.classList.add("dash-orb");
        }
      }
      if (dash.orb) {
        const counts = info.counts || {};
        let mood = "good";
        let label = "All clear — nothing overdue";
        if (info.scope === "team") {
          mood = "team";
          label = "Team view";
        } else if (counts.overdue > 0) {
          mood = "late";
          label = `${counts.overdue} overdue`;
        } else if (info.dueSoon > 0) {
          mood = "soon";
          label = `${info.dueSoon} due this week`;
        }
        dash.orb.setColor(ORB_COLORS[mood]);
        dash.orb.element.title = label;
        dash.orb.element.setAttribute("role", "img");
        dash.orb.element.setAttribute("aria-label", label);
        slot.classList.add("has-orb");
        slot.prepend(dash.orb.element);
      }
    }

    dash.counts = { ...(info.counts || {}) };
    dash.scope = info.scope;
    dash.open = info.open || null;
  }

  /* ------------------------------------------- hours: duration picker */

  // Rare UI's Duration Picker, simplified: quick chips and -/+ steppers on
  // the "Hours" field. It only fills the existing input; the form and what
  // it sends are unchanged.
  const HOUR_CHIPS = [
    [0.25, "15m"],
    [0.5, "30m"],
    [1, "1h"],
    [2, "2h"],
    [3, "3h"],
  ];

  function enhanceHoursInput() {
    const input = document.querySelector("#work_hours");
    if (!input || input.dataset.uiEnhanced) {
      return;
    }
    input.dataset.uiEnhanced = "true";
    const min = Number(input.min) || 0.25;
    const max = Number(input.max) || 24;
    const step = Number(input.step) || 0.25;

    const chips = document.createElement("div");
    chips.className = "ui-chips";
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Quick pick hours");
    chips.innerHTML = HOUR_CHIPS.map(
      ([value, label]) => `<button type="button" class="ui-chip" data-hours="${value}" aria-pressed="false">${label}</button>`
    ).join("");

    const wrap = document.createElement("div");
    wrap.className = "ui-stepper";
    input.parentNode.insertBefore(wrap, input);
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "ui-step";
    minus.setAttribute("aria-label", "Fewer hours");
    minus.textContent = "−";
    const plus = minus.cloneNode();
    plus.setAttribute("aria-label", "More hours");
    plus.textContent = "+";
    wrap.append(minus, input, plus);
    input.closest(".task-log-row")?.before(chips);

    function sync() {
      const value = Number(input.value);
      chips.querySelectorAll(".ui-chip").forEach((chip) => {
        chip.setAttribute("aria-pressed", String(Number(chip.dataset.hours) === value));
      });
    }
    function set(value) {
      const clamped = Math.min(max, Math.max(min, Math.round(value / step) * step));
      input.value = String(clamped);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      sync();
      haptic(6);
    }
    chips.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-hours]");
      if (chip) {
        set(Number(chip.dataset.hours));
      }
    });
    minus.addEventListener("click", () => set((Number(input.value) || min + step) - step));
    plus.addEventListener("click", () => set((Number(input.value) || 0) + step));
    input.addEventListener("input", sync);
    input.form?.addEventListener("reset", () => setTimeout(sync, 0));
  }

  /* ------------------------------------------------- hold-to-delete */

  // Rare UI's Delete Button idea: deleting a comment needs a short press and
  // hold instead of a pop-up. Keyboard users still get the normal pop-up.
  const HOLD_MS = 900;
  const HOLD_SELECTOR = "[data-delete-comment-id]";
  let holdConfirmed = false;

  const nativeConfirm = window.confirm.bind(window);
  window.confirm = function nttConfirm(message) {
    if (holdConfirmed) {
      holdConfirmed = false;
      return true;
    }
    return nativeConfirm(message);
  };

  function setupHoldToDelete() {
    let timer = null;
    let active = null;
    let completed = null;

    function cancel() {
      clearTimeout(timer);
      timer = null;
      if (active) {
        active.classList.remove("is-holding");
      }
      active = null;
    }

    document.addEventListener("pointerdown", (event) => {
      const button = event.target.closest(HOLD_SELECTOR);
      if (!button || button.disabled || event.button > 0) {
        return;
      }
      active = button;
      button.classList.add("ui-hold", "is-holding");
      button.style.setProperty("--ui-hold-ms", `${HOLD_MS}ms`);
      timer = setTimeout(() => {
        timer = null;
        button.classList.remove("is-holding");
        completed = button;
        haptic([10, 40, 20]);
        holdConfirmed = true;
        button.click();
        // If nothing asked to confirm, don't leave the flag armed.
        setTimeout(() => {
          holdConfirmed = false;
        }, 0);
      }, HOLD_MS);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((type) =>
      document.addEventListener(type, (event) => {
        if (active && (type !== "pointerleave" || event.target === active)) {
          cancel();
        }
      }, true)
    );

    // Swallow the ordinary click that follows a short tap (and the trailing
    // click a browser fires after a completed hold). Keyboard clicks
    // (detail === 0) and our own programmatic click go through.
    let suppressUntil = 0;
    document.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest(HOLD_SELECTOR);
        if (!button) {
          return;
        }
        if (completed === button && !event.isTrusted) {
          completed = null;
          suppressUntil = Date.now() + 700;
          return;
        }
        if (event.detail === 0) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (Date.now() > suppressUntil) {
          toast("Press and hold to delete", { tone: "info", duration: 1800 });
        }
      },
      true
    );

    // Label the buttons as they appear.
    const label = () =>
      document.querySelectorAll(HOLD_SELECTOR).forEach((button) => {
        if (!button.dataset.uiHoldLabel) {
          button.dataset.uiHoldLabel = "true";
          button.classList.add("ui-hold");
          button.title = "Press and hold to delete";
        }
      });
    label();
    onDomChange(label);
  }

  /* ---------------------------------------------- task progress pop */

  // When a task moves forward (started, sent for review, closed), the step it
  // reached pops; closing a task gets a small celebration.
  function watchTaskSteps() {
    const steps = document.querySelector("#task-steps");
    if (!steps) {
      return;
    }
    let previous = null;
    new MutationObserver(() => {
      const items = [...steps.children];
      if (!items.length) {
        return;
      }
      const done = steps.querySelectorAll(".is-done").length;
      const allDone = done === items.length;
      if (previous !== null && done > previous) {
        const target = allDone ? items[items.length - 1] : items[done];
        target?.classList.add("ui-step-pop");
        if (allDone) {
          steps.classList.add("ui-steps-complete");
          haptic([12, 50, 12, 50, 24]);
        }
      }
      previous = done;
    }).observe(steps, { childList: true });
  }

  /* ------------------------------------------------- notification bell */

  // Rare UI's Notification Bell: the bell rings and the badge pops when the
  // unread count goes up while you're on the page.
  function watchNotificationBell() {
    let lastCount = null;
    function read(trigger) {
      const text = trigger.querySelector(".notification-badge")?.textContent || "0";
      return text === "99+" ? 100 : Number(text) || 0;
    }
    function check() {
      const trigger = document.querySelector("[data-notification-trigger]");
      if (!trigger) {
        return;
      }
      const count = read(trigger);
      if (lastCount !== null && count > lastCount) {
        trigger.classList.remove("ui-bell-ring");
        void trigger.offsetWidth;
        trigger.classList.add("ui-bell-ring");
        trigger.querySelector(".notification-badge")?.classList.add("ui-badge-pop");
        haptic([8, 40, 8]);
      }
      lastCount = count;
    }
    onDomChange(check);
  }

  /* -------------------------------------------- password show / hide */

  const EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_OFF = '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';

  function enhancePasswordInputs() {
    document.querySelectorAll('input[type="password"]').forEach((input) => {
      if (input.dataset.uiEye) {
        return;
      }
      input.dataset.uiEye = "true";
      const wrap = document.createElement("span");
      wrap.className = "ui-pass";
      input.parentNode.insertBefore(wrap, input);
      wrap.append(input);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-pass-toggle";
      const paint = () => {
        const shown = input.type === "text";
        button.setAttribute("aria-label", shown ? "Hide password" : "Show password");
        button.setAttribute("aria-pressed", String(shown));
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shown ? EYE_OFF : EYE}</svg>`;
      };
      button.addEventListener("click", () => {
        input.type = input.type === "password" ? "text" : "password";
        paint();
        input.focus({ preventScroll: true });
      });
      // Never submit a form with the password left visible in autofill history.
      input.form?.addEventListener("submit", () => {
        input.type = "password";
        paint();
      }, true);
      paint();
      wrap.append(button);
    });
  }

  /* -------------------------------------- task page: quick-action sheet */

  // Rare UI's Family Drawer idea: on phones, a floating button opens a
  // bottom sheet with the task's next step, logging hours and posting an
  // update, so nobody scrolls the whole page to act. Every action simply
  // triggers the existing button or field on the page.
  function setupTaskSheet() {
    const nextActions = document.querySelector("#task-actions-title");
    if (!nextActions || !document.querySelector("#task-steps")) {
      return;
    }
    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "ui-fab";
    fab.setAttribute("aria-label", "Task actions");
    fab.setAttribute("aria-haspopup", "dialog");
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

    const backdrop = document.createElement("div");
    backdrop.className = "ui-sheet-backdrop";
    const sheet = document.createElement("div");
    sheet.className = "ui-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Task actions");
    sheet.innerHTML = '<span class="ui-sheet-grip" aria-hidden="true"></span><p class="ui-sheet-title"></p><div class="ui-sheet-list"></div>';
    document.body.append(fab, backdrop, sheet);
    document.body.classList.add("has-ui-fab");

    const list = sheet.querySelector(".ui-sheet-list");
    const ICONS = {
      step: '<path d="M5 12.5l4.2 4.2L19 7"/>',
      hours: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
      update: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/>',
      edit: '<path d="M4 7h16M4 12h10M4 17h7"/>',
    };
    const item = (icon, label, hint, action, primary = false) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `ui-sheet-item${primary ? " is-primary" : ""}`;
      b.innerHTML = `<span class="ui-sheet-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg></span><span><b></b><small></small></span>`;
      b.querySelector("b").textContent = label;
      b.querySelector("small").textContent = hint;
      b.addEventListener("click", () => {
        close();
        setTimeout(action, 220);
      });
      return b;
    };
    const focusField = (selector, open) => () => {
      if (open) {
        const details = document.querySelector(open);
        if (details) {
          details.open = true;
        }
      }
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
        setTimeout(() => el.focus({ preventScroll: true }), 350);
      }
    };
    const visible = (el) => el && !el.hidden && !el.classList.contains("is-hidden") && el.offsetParent !== null;

    function build() {
      list.innerHTML = "";
      sheet.querySelector(".ui-sheet-title").textContent =
        document.querySelector("#task-title")?.textContent?.trim() || "This task";
      nextActions.querySelectorAll("button").forEach((original) => {
        if (visible(original) && !original.disabled) {
          list.append(item("step", original.textContent.trim(), "Next step", () => original.click(), original.classList.contains("btn-primary") || original.classList.contains("btn-approve")));
        }
      });
      if (document.querySelector("#work_hours")) {
        list.append(item("hours", "Log hours", "Add time you spent on this", focusField("#work_hours")));
      }
      if (document.querySelector("#comment_text")) {
        list.append(item("update", "Post an update", "Share progress or a link to your work", focusField("#comment_text")));
      }
      const editBox = document.querySelector("#task-edit-box");
      if (visible(editBox)) {
        list.append(item("edit", "Edit task", "Name, assignee, due date", focusField("#task_edit_title", "#task-edit-box")));
      }
    }

    let lastFocus = null;
    function open() {
      build();
      lastFocus = document.activeElement;
      document.body.classList.add("ui-sheet-open");
      sheet.style.transform = "";
      haptic(8);
      setTimeout(() => list.querySelector("button")?.focus({ preventScroll: true }), 300);
    }
    function close() {
      document.body.classList.remove("ui-sheet-open");
      sheet.style.transform = "";
      lastFocus?.focus?.({ preventScroll: true });
    }
    fab.addEventListener("click", open);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("ui-sheet-open")) {
        close();
      }
    });

    // Drag the sheet down to dismiss it.
    let startY = null;
    sheet.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".ui-sheet-grip, .ui-sheet-title") || event.pointerType === "touch") {
        startY = event.clientY;
      }
    });
    sheet.addEventListener("pointermove", (event) => {
      if (startY === null) {
        return;
      }
      const dy = Math.max(0, event.clientY - startY);
      if (dy > 6) {
        sheet.classList.add("is-dragging");
        sheet.style.transform = `translateY(${dy}px)`;
      }
    });
    const endDrag = (event) => {
      if (startY === null) {
        return;
      }
      const dy = Math.max(0, event.clientY - startY);
      startY = null;
      sheet.classList.remove("is-dragging");
      if (dy > 90) {
        close();
      } else {
        sheet.style.transform = "";
      }
    };
    sheet.addEventListener("pointerup", endDrag);
    sheet.addEventListener("pointercancel", endDrag);
  }

  /* --------------------------------------------------------- theme */

  // "system" follows the device; "light"/"dark" are explicit choices.
  const THEME_KEY = "ntt-theme";
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function themeChoice() {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch (_error) {
      return "system";
    }
  }

  function effectiveTheme(choice = themeChoice()) {
    return choice === "system" ? (darkQuery.matches ? "dark" : "light") : choice;
  }

  function applyTheme(choice, animate) {
    const root = document.documentElement;
    if (animate && !reduceMotion) {
      root.classList.add("theme-switching");
      setTimeout(() => root.classList.remove("theme-switching"), 320);
    }
    const mode = effectiveTheme(choice);
    if (mode === "dark") {
      root.setAttribute("data-theme", "dark");
    } else {
      root.removeAttribute("data-theme");
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && !document.body.classList.contains("project-game-body")) {
      meta.setAttribute("content", mode === "dark" ? "#0e0e11" : "#f2f2f7");
    }
    document.querySelectorAll("[data-theme-choice]").forEach((el) => {
      el.setAttribute("aria-pressed", String(el.dataset.themeChoice === choice));
    });
    document.querySelectorAll(".ui-theme-toggle").forEach((el) => {
      el.setAttribute("aria-label", mode === "dark" ? "Switch to light mode" : "Switch to dark mode");
      el.title = mode === "dark" ? "Light mode" : "Dark mode";
      el.dataset.mode = mode;
    });
  }

  function setTheme(choice) {
    try {
      if (choice === "system") {
        window.localStorage.removeItem(THEME_KEY);
      } else {
        window.localStorage.setItem(THEME_KEY, choice);
      }
    } catch (_error) {
      // Still switch for this page.
    }
    applyTheme(choice, true);
    haptic(6);
  }

  darkQuery.addEventListener?.("change", () => {
    if (themeChoice() === "system") {
      applyTheme("system", true);
    }
  });

  const SUN_MOON =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<mask id="ui-moon-mask"><rect width="24" height="24" fill="#fff"/><circle class="ui-moon-bite" cx="24" cy="4" r="7" fill="#000"/></mask>' +
    '<circle class="ui-sun-core" cx="12" cy="12" r="5" mask="url(#ui-moon-mask)" fill="currentColor"/>' +
    '<g class="ui-sun-rays" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<path d="M12 1.5v2M12 20.5v2M4.6 4.6 6 6M18 18l1.4 1.4M1.5 12h2M20.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></g></svg>';

  /* ------------------------------------- top bar: theme + who's signed in */

  function initials(name) {
    return (
      String(name || "?")
        .split(/[\s._@-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0].toUpperCase())
        .join("") || "?"
    );
  }

  function avatarHue(text) {
    let h = 0;
    for (const ch of String(text)) {
      h = (h * 31 + ch.charCodeAt(0)) % 360;
    }
    return h;
  }

  function setupTopbarControls() {
    const actions = document.querySelector(".workspace-topbar-actions");
    const session = typeof window.getSession === "function" ? window.getSession() : null;
    if (!actions || actions.dataset.uiControls || !session?.email) {
      return;
    }
    actions.dataset.uiControls = "true";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-icon ui-theme-toggle";
    toggle.innerHTML = SUN_MOON;
    toggle.addEventListener("click", () => setTheme(effectiveTheme() === "dark" ? "light" : "dark"));

    const email = String(session.email).toLowerCase();
    const cls = String(session.userClass || "").toUpperCase();
    const roleLabel = cls === "ADMIN" ? "Admin" : cls === "SENIOR" ? "Senior" : cls === "JUNIOR" ? "Junior" : "";
    const roleClass = cls === "JUNIOR" ? "is-junior" : "is-senior";
    const local = email.split("@")[0];
    let name = local;

    const me = document.createElement("div");
    me.className = "ui-me";
    me.innerHTML = `
      <button type="button" class="ui-me-btn" aria-haspopup="true" aria-expanded="false">
        <span class="ui-me-avatar"></span>
        <span class="ui-me-text"><b class="ui-me-name"></b>${roleLabel ? `<small>${roleLabel}</small>` : ""}</span>
        <svg class="ui-me-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="ui-me-menu" role="menu" hidden>
        <div class="ui-me-head">
          <span class="ui-me-avatar is-lg"></span>
          <span><b class="ui-me-name"></b><small class="ui-me-email"></small>${roleLabel ? `<span class="role-tag ${roleClass}">${roleLabel}</span>` : ""}</span>
        </div>
        <p class="ui-me-label">Appearance</p>
        <div class="ui-theme-tiles" role="group" aria-label="Appearance">
          <button type="button" data-theme-choice="system" aria-pressed="false"><span class="ui-tile is-system" aria-hidden="true"><i></i><i></i></span>System</button>
          <button type="button" data-theme-choice="light" aria-pressed="false"><span class="ui-tile is-light" aria-hidden="true"><i></i><i></i></span>Light</button>
          <button type="button" data-theme-choice="dark" aria-pressed="false"><span class="ui-tile is-dark" aria-hidden="true"><i></i><i></i></span>Dark</button>
        </div>
        <nav class="ui-me-links">
          <a href="/welcome" role="menuitem">Edit my profile</a>
          <a href="/guide" role="menuitem">Guide</a>
          <button type="button" role="menuitem" data-ui-logout>Log out</button>
        </nav>
      </div>`;

    function paintName() {
      me.querySelectorAll(".ui-me-name").forEach((el) => {
        el.textContent = name;
      });
      me.querySelector(".ui-me-email").textContent = email;
      const h = avatarHue(email);
      me.querySelectorAll(".ui-me-avatar").forEach((el) => {
        el.textContent = initials(name);
        el.style.setProperty("--av-bg", `hsl(${h} 60% 90%)`);
        el.style.setProperty("--av-ink", `hsl(${h} 45% 30%)`);
      });
      me.querySelector(".ui-me-btn").setAttribute("aria-label", `Signed in as ${name}${roleLabel ? `, ${roleLabel}` : ""}. Account menu`);
    }
    paintName();
    if (typeof window.getActiveUsers === "function") {
      window
        .getActiveUsers()
        .then((users) => {
          const user = (users || []).find((u) => String(u.email || "").toLowerCase() === email);
          if (user?.user_name) {
            name = user.user_name;
            paintName();
          }
        })
        .catch(() => {});
    }

    const button = me.querySelector(".ui-me-btn");
    const menu = me.querySelector(".ui-me-menu");
    function openMenu(open) {
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      me.classList.toggle("is-open", open);
      if (open) {
        applyTheme(themeChoice(), false);
      }
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(menu.hidden);
    });
    menu.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-theme-choice]");
      if (choice) {
        setTheme(choice.dataset.themeChoice);
        return;
      }
      if (event.target.closest("[data-ui-logout]")) {
        if (typeof window.logout === "function") {
          window.logout();
        } else {
          window.location.href = "/signed-out";
        }
      }
    });
    document.addEventListener("click", (event) => {
      if (!me.contains(event.target)) {
        openMenu(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) {
        openMenu(false);
        button.focus();
      }
    });

    actions.prepend(toggle);
    actions.append(me);
    applyTheme(themeChoice(), false);
  }

  // One shared, frame-throttled watcher for DOM changes app.js makes.
  const domListeners = [];
  let domQueued = false;
  function onDomChange(listener) {
    domListeners.push(listener);
    if (domListeners.length === 1) {
      new MutationObserver(() => {
        if (domQueued) {
          return;
        }
        domQueued = true;
        requestAnimationFrame(() => {
          domQueued = false;
          domListeners.forEach((fn) => {
            try {
              fn();
            } catch (_error) {
              // Decoration must never break the page.
            }
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  /* -------------------------------------------------------------- boot */

  window.NTTUI = {
    toast,
    haptic,
    rollNumber,
    createOrb,
    setTheme,
    enhanceDashboard,
  };

  prewarm();
  document.addEventListener("DOMContentLoaded", () => {
    [hookSetMessage, setupTopbarControls, enhanceHoursInput, enhancePasswordInputs, setupHoldToDelete, watchTaskSteps, watchNotificationBell, setupTaskSheet].forEach((fn) => {
      try {
        fn();
      } catch (_error) {
        // Each enhancement is optional.
      }
    });
  });
})();
