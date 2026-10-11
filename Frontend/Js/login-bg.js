/*
 * Live "network" background for the sign-in pages.
 *
 * Starts only after the page has loaded, so it never delays signing in.
 * Runs at 60 fps on laptops and desktops and 30 fps on phones or on devices
 * that ask to save data. Pauses when the tab is hidden and draws a single
 * still frame for people who prefer reduced motion.
 */
(function () {
  "use strict";

  const shell = document.querySelector(".login-shell");
  if (!shell || !window.requestAnimationFrame || !document.createElement("canvas").getContext) {
    return;
  }

  function start() {
    const canvas = document.createElement("canvas");
    canvas.className = "live-bg";
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);
    document.body.classList.add("has-live-bg");
    const ctx = canvas.getContext("2d");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const saveData = Boolean(navigator.connection && navigator.connection.saveData);
    const lowPower = coarse || saveData || (navigator.hardwareConcurrency || 8) <= 4;
    const frameMs = 1000 / (lowPower ? 30 : 60);

    let width = 0;
    let height = 0;
    let nodes = [];
    let raf = 0;
    let last = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round(Math.min(lowPower ? 40 : 80, (width * height) / 16000));
      nodes = Array.from({ length: Math.max(18, target) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * (frameMs > 20 ? 0.5 : 0.25),
        vy: (Math.random() - 0.5) * (frameMs > 20 ? 0.5 : 0.25),
        r: Math.random() * 1.4 + 0.8,
        warm: Math.random() < 0.11,
      }));
      draw(false);
    }

    function draw(step) {
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, width, height);
      const reach = Math.min(160, Math.max(90, width / 8));
      if (step) {
        for (const node of nodes) {
          node.x += node.vx;
          node.y += node.vy;
          if (node.x < 0 || node.x > width) node.vx *= -1;
          if (node.y < 0 || node.y > height) node.vy *= -1;
        }
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < reach) {
            ctx.strokeStyle = `rgba(90,184,240,${((1 - distance / reach) * 0.42).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (const node of nodes) {
        ctx.fillStyle = node.warm ? "rgba(242,140,30,0.9)" : "rgba(220,235,255,0.85)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop(time) {
      raf = window.requestAnimationFrame(loop);
      if (time - last < frameMs - 1) return;
      last = time;
      draw(true);
    }

    function play() {
      if (!reduceMotion && !document.hidden && !raf) {
        raf = window.requestAnimationFrame(loop);
      }
    }

    function pause() {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 150);
    });
    document.addEventListener("visibilitychange", () => (document.hidden ? pause() : play()));
    resize();
    play();
  }

  if (document.readyState === "complete") {
    window.setTimeout(start, 0);
  } else {
    window.addEventListener("load", () => window.setTimeout(start, 0), { once: true });
  }
})();
