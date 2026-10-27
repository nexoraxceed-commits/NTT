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
        if (pending > 0) {
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

  /* -------------------------------------------------------------- boot */

  window.NTTUI = {
    toast,
    haptic,
    rollNumber,
    createOrb,
    enhanceDashboard,
  };

  prewarm();
  document.addEventListener("DOMContentLoaded", hookSetMessage);
})();
