/*
 * Illustrations from illos.dev (free licence, Frontend/illos/*.svg).
 *
 * Any element with data-illos="<name>" gets that SVG inlined (inline so it
 * picks up the app's colours and dark mode through CSS variables). Elements
 * rendered later by app.js or welcome.js are picked up automatically.
 *
 * Playback follows illos's own rules: plays once when half of it is in view,
 * holds the last frame, loops while hovered with a mouse, and stays still for
 * people who prefer reduced motion (the SVGs handle that themselves).
 */
(function () {
  "use strict";

  const VERSION = "1";
  const cache = new Map();

  function load(name) {
    if (!cache.has(name)) {
      cache.set(
        name,
        fetch(`/illos/${name}.svg?v=${VERSION}`).then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      );
    }
    return cache.get(name);
  }

  function playOnce(host) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let started = false;
    const animations = () => host.getAnimations({ subtree: true });
    const play = () => {
      if (!started) {
        started = true;
        host.style.setProperty("--illos-play", "running");
        return;
      }
      if (animations().some((a) => a.playState === "running")) return;
      // Seek only: play() would take the CSS animation out of CSS control.
      for (const a of animations()) a.currentTime = 0;
    };
    let wasOut = true;
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          const inView = entries.some((e) => e.isIntersecting);
          if (inView && wasOut) play();
          wasOut = !inView;
        },
        { threshold: 0.5 }
      );
      io.observe(host);
    } else {
      play();
    }
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let hovering = false;
    let waiting = false;
    const loop = () => {
      if (waiting) return;
      const list = animations();
      if (!list.length) return;
      waiting = true;
      Promise.all(list.map((a) => a.finished)).then(
        () =>
          requestAnimationFrame(() => {
            waiting = false;
            if (!hovering) return;
            for (const a of animations()) a.currentTime = 0;
            loop();
          }),
        () =>
          requestAnimationFrame(() => {
            waiting = false;
            if (hovering) loop();
          })
      );
    };
    host.addEventListener("mouseenter", () => {
      hovering = true;
      play();
      loop();
    });
    host.addEventListener("mouseleave", () => {
      hovering = false;
    });
  }

  function mount(el) {
    if (el.dataset.illosMounted) return;
    el.dataset.illosMounted = "1";
    el.setAttribute("aria-hidden", "true"); // decorative: the text beside it says it
    el.style.setProperty("--illos-play", "paused");
    load(el.dataset.illos)
      .then((svg) => {
        el.innerHTML = svg;
        el.classList.add("is-loaded");
        playOnce(el);
      })
      .catch(() => el.remove());
  }

  function scan(root) {
    if (root.matches && root.matches("[data-illos]")) mount(root);
    if (root.querySelectorAll) root.querySelectorAll("[data-illos]:not([data-illos-mounted])").forEach(mount);
  }

  window.NTTIllos = {
    block(name, extraClass) {
      const el = document.createElement("div");
      el.className = `illos${extraClass ? ` ${extraClass}` : ""}`;
      el.dataset.illos = name;
      return el;
    },
  };

  function start() {
    scan(document.body);
    new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n.nodeType === 1 && scan(n));
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
