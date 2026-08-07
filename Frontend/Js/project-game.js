(() => {
  const canvas = document.querySelector("#project-game-canvas");
  if (!canvas) return;

  const context = canvas.getContext("2d");
  const stage = document.querySelector("#project-game-stage");
  const scoreElement = document.querySelector("#project-game-score");
  const bird = { x: 45, y: 240, radius: 18, velocity: 0 };
  let projectNames = ["New Project"];
  let obstacles = [];
  let particles = [];
  let score = 0;
  let running = false;
  let hasStartedOnce = false;
  let paused = false;
  let lastFrame = 0;
  let spawnTimer = 0;
  let bufferRemaining = 0;
  let lastCountdown = 0;
  let playTime = 0;
  let frameId = 0;
  let audioContext = null;
  let musicTimer = 0;
  let musicStep = 0;
  let musicEnabled = true;

  function haptic(pattern) {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioContext = new AudioContext();
    }
    if (audioContext?.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
  }

  function playMusicNote(frequency, duration = .16) {
    if (!audioContext || !musicEnabled || paused || !running) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.055, audioContext.currentTime + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration + .02);
  }

  function startMusic() {
    if (!musicEnabled) return;
    ensureAudio();
    window.clearInterval(musicTimer);
    const melody = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23];
    playMusicNote(melody[musicStep % melody.length]);
    musicTimer = window.setInterval(() => {
      if (running && !paused && !document.hidden) {
        musicStep += 1;
        playMusicNote(melody[musicStep % melody.length]);
      }
    }, 280);
  }

  function playCollectSound() {
    if (!audioContext) return;
    [659.25, 783.99, 1046.5].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const startsAt = audioContext.currentTime + index * .065;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startsAt);
      gain.gain.setValueAtTime(.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(.13, startsAt + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, startsAt + .14);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + .16);
    });
  }

  function playCollisionSound() {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(55, audioContext.currentTime + .28);
    gain.gain.setValueAtTime(.11, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + .3);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + .31);
  }

  function stopMusic() {
    window.clearInterval(musicTimer);
    musicTimer = 0;
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(300, stage.clientWidth);
    const height = Math.max(300, stage.clientHeight);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    canvas.dataset.width = String(width);
    canvas.dataset.height = String(height);
  }

  const width = () => Number(canvas.dataset.width || 960);
  const height = () => Number(canvas.dataset.height || 520);

  function drawBackground() {
    const gradient = context.createLinearGradient(0, 0, 0, height());
    gradient.addColorStop(0, "#dff5ee");
    gradient.addColorStop(1, "#f8fcfa");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width(), height());
    const drift = (playTime * .018) % 140;
    context.fillStyle = "rgba(255, 255, 255, .48)";
    for (let x = -100 - drift; x < width() + 100; x += 140) {
      context.beginPath();
      context.ellipse(x, 80 + ((x + drift) % 190), 38, 17, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = "rgba(47, 111, 93, .06)";
    context.fillRect(0, height() - 12, width(), 12);
  }

  function drawBird() {
    context.save();
    context.translate(bird.x, bird.y);
    context.rotate(Math.max(-0.35, Math.min(0.65, bird.velocity * 0.045)));
    context.fillStyle = "#f4b942";
    context.shadowColor = "rgba(31, 46, 42, .22)";
    context.shadowBlur = 10;
    context.beginPath();
    context.arc(0, 0, bird.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#2f6f5d";
    context.beginPath();
    context.ellipse(-8, 5, 12, 7, -0.3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(7, -6, 5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#1f2e2a";
    context.beginPath();
    context.arc(9, -6, 2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#e37932";
    context.beginPath();
    context.moveTo(16, -1);
    context.lineTo(29, 4);
    context.lineTo(16, 8);
    context.closePath();
    context.fill();
    context.restore();
  }

  function obstacleSize(name) {
    context.font = "700 16px system-ui, sans-serif";
    return { width: Math.min(290, Math.max(130, context.measureText(name).width + 42)), height: 54 };
  }

  function spawnObstacle() {
    const obstacleRoll = Math.random();
    if (obstacleRoll < 0.28) {
      const radius = 20 + Math.random() * 13;
      obstacles.push({
        type: "balloon",
        x: width() + 30,
        y: 45 + Math.random() * Math.max(40, height() - radius * 2 - 90),
        width: radius * 2,
        height: radius * 2 + 34,
        radius,
        counted: false,
        bob: Math.random() * Math.PI * 2,
      });
      return;
    }
    if (obstacleRoll < 0.46) {
      obstacles.push({
        type: "crow",
        x: width() + 30,
        y: 50 + Math.random() * Math.max(40, height() - 150),
        width: 62,
        height: 42,
        phase: Math.random() * Math.PI * 2,
        counted: false,
      });
      return;
    }
    const name = projectNames[Math.floor(Math.random() * projectNames.length)];
    const size = obstacleSize(name);
    obstacles.push({
      type: "project",
      name,
      x: width() + 30,
      y: 45 + Math.random() * Math.max(40, height() - size.height - 90),
      ...size,
      counted: false,
    });
  }

  function drawObstacles() {
    obstacles.forEach((item) => {
      if (item.type === "balloon") {
        const centerX = item.x + item.radius;
        const centerY = item.y + item.radius + Math.sin(playTime / 280 + item.bob) * 4;
        const colors = ["#e86a75", "#6d72d8", "#ef9f45", "#4ba3a1"];
        context.save();
        context.shadowColor = "rgba(255, 196, 74, .72)";
        context.shadowBlur = 18;
        context.fillStyle = colors[Math.floor((item.y + item.radius) % colors.length)];
        context.beginPath();
        context.ellipse(centerX, centerY, item.radius * .82, item.radius, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "rgba(255, 255, 255, .55)";
        context.beginPath();
        context.ellipse(centerX - item.radius * .28, centerY - item.radius * .3, 4, 8, -.4, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#64736e";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(centerX, item.y + item.radius * 2);
        context.quadraticCurveTo(centerX + 9, item.y + item.height - 16, centerX, item.y + item.height);
        context.stroke();
        context.fillStyle = "#ffffff";
        context.font = "800 12px system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("+1", centerX, centerY);
        context.restore();
        return;
      }
      if (item.type === "crow") {
        const wingLift = Math.sin(performance.now() / 95 + item.phase) * 9;
        context.save();
        context.translate(item.x + item.width / 2, item.y + item.height / 2);
        context.fillStyle = "#252c2a";
        context.beginPath();
        context.ellipse(0, 4, 23, 14, 0, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.moveTo(-5, 2);
        context.quadraticCurveTo(-22, -20 - wingLift, -33, -8 - wingLift);
        context.quadraticCurveTo(-18, -5, -3, 8);
        context.fill();
        context.beginPath();
        context.moveTo(5, 2);
        context.quadraticCurveTo(22, -20 - wingLift, 33, -8 - wingLift);
        context.quadraticCurveTo(18, -5, 3, 8);
        context.fill();
        context.beginPath();
        context.arc(20, -4, 10, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#f2c94c";
        context.beginPath();
        context.moveTo(29, -5);
        context.lineTo(42, 0);
        context.lineTo(29, 4);
        context.closePath();
        context.fill();
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(23, -7, 2.5, 0, Math.PI * 2);
        context.fill();
        context.restore();
        return;
      }
      context.fillStyle = "#2f6f5d";
      context.shadowColor = "rgba(31, 46, 42, .18)";
      context.shadowBlur = 12;
      context.beginPath();
      context.roundRect(item.x, item.y, item.width, item.height, 14);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "700 16px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      const label = item.name.length > 28 ? `${item.name.slice(0, 27)}…` : item.name;
      context.fillText(label, item.x + item.width / 2, item.y + item.height / 2);
      context.shadowBlur = 0;
    });
  }

  function emitParticles(x, y, color, count = 12) {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const force = 1.5 + Math.random() * 3.2;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * force,
        vy: Math.sin(angle) * force,
        life: 1,
        size: 2 + Math.random() * 4,
        color,
      });
    }
  }

  function updateAndDrawParticles(delta) {
    particles.forEach((particle) => {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vy += .08 * delta;
      particle.life -= .035 * delta;
      context.globalAlpha = Math.max(0, particle.life);
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 1;
    particles = particles.filter((particle) => particle.life > 0);
  }

  function collides(item) {
    if (item.type === "balloon") {
      const centerX = item.x + item.radius;
      const centerY = item.y + item.radius;
      return (bird.x - centerX) ** 2 + (bird.y - centerY) ** 2 <
        (bird.radius + item.radius * .82) ** 2;
    }
    if (item.type === "crow") {
      const centerX = item.x + item.width / 2;
      const centerY = item.y + item.height / 2;
      return (bird.x - centerX) ** 2 + (bird.y - centerY) ** 2 <
        (bird.radius + 22) ** 2;
    }
    const nearestX = Math.max(item.x, Math.min(bird.x, item.x + item.width));
    const nearestY = Math.max(item.y, Math.min(bird.y, item.y + item.height));
    return (bird.x - nearestX) ** 2 + (bird.y - nearestY) ** 2 < bird.radius ** 2;
  }

  function paint() {
    drawBackground();
    drawObstacles();
    updateAndDrawParticles(1);
    drawBird();
    if (running && bufferRemaining > 0) {
      context.fillStyle = "rgba(31, 46, 42, .82)";
      const countdownSize = Math.max(64, Math.min(120, width() * .14));
      context.font = `800 ${countdownSize}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        String(Math.ceil(bufferRemaining / 1000)),
        width() / 2,
        height() / 2
      );
      context.strokeStyle = "rgba(47, 111, 93, .24)";
      context.lineWidth = 7;
      context.beginPath();
      context.arc(width() / 2, height() / 2, countdownSize * .72, -.5 * Math.PI, 1.5 * Math.PI);
      context.stroke();
    }
  }

  function animateImpact(timestamp, startedAt) {
    drawBackground();
    drawObstacles();
    updateAndDrawParticles(1);
    drawBird();
    if (timestamp - startedAt < 320) {
      frameId = requestAnimationFrame((nextTimestamp) =>
        animateImpact(nextTimestamp, startedAt)
      );
    }
  }

  function finish() {
    running = false;
    paused = false;
    cancelAnimationFrame(frameId);
    stopMusic();
    playCollisionSound();
    haptic([90, 45, 140]);
    emitParticles(bird.x, bird.y, "#e86a75", 20);
    frameId = requestAnimationFrame((timestamp) => animateImpact(timestamp, timestamp));
    stage.animate?.(
      [
        { transform: "translateX(0)", filter: "none" },
        { transform: "translateX(-8px)", filter: "saturate(1.5)" },
        { transform: "translateX(7px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(0)", filter: "none" },
      ],
      { duration: 320, easing: "ease-out" }
    );
    scoreElement.parentElement.classList.add("is-collision");
    window.setTimeout(() => scoreElement.parentElement.classList.remove("is-collision"), 420);
  }

  function update(timestamp) {
    if (!running) return;
    const delta = Math.min(32, timestamp - lastFrame || 16) / 16.67;
    lastFrame = timestamp;
    if (!paused) {
      if (bufferRemaining > 0) {
        bufferRemaining = Math.max(0, bufferRemaining - 16.67 * delta);
        const countdown = Math.ceil(bufferRemaining / 1000);
        if (countdown > 0 && countdown !== lastCountdown) {
          lastCountdown = countdown;
          haptic(10);
        }
        bird.velocity = 0;
        paint();
        frameId = requestAnimationFrame(update);
        return;
      }
      bird.velocity += 0.25 * delta;
      bird.y += bird.velocity * delta;
      playTime += 16.67 * delta;
      spawnTimer -= 16.67 * delta;
      if (spawnTimer <= 0) {
        spawnObstacle();
        spawnTimer = Math.max(650, 2100 - playTime / 55);
      }
      const speed = 2.2 + Math.min(4.3, playTime / 18000);
      obstacles.forEach((item) => {
        item.x -= speed * (item.type === "crow" ? 1.18 : 1) * delta;
        if (item.type === "balloon" && !item.collected && collides(item)) {
          item.collected = true;
          score += 1;
          scoreElement.textContent = String(score);
          scoreElement.parentElement.classList.remove("is-earned");
          void scoreElement.parentElement.offsetWidth;
          scoreElement.parentElement.classList.add("is-earned");
          haptic([18, 24, 35]);
          playCollectSound();
          emitParticles(bird.x + 10, bird.y, "#f4b942", 16);
        }
      });
      obstacles = obstacles.filter(
        (item) => !item.collected && item.x + item.width > -30
      );
      if (
        bird.y - bird.radius <= 0 ||
        bird.y + bird.radius >= height() ||
        obstacles.some(
          (item) => ["project", "crow"].includes(item.type) && collides(item)
        )
      ) {
        paint();
        finish();
        return;
      }
    }
    paint();
    frameId = requestAnimationFrame(update);
  }

  function flap() {
    if (!running || bufferRemaining > 0) return;
    if (paused) togglePause();
    bird.velocity = -4.6;
    emitParticles(bird.x - 15, bird.y + 7, "#ffffff", 4);
    haptic(12);
  }

  function start() {
    hasStartedOnce = true;
    obstacles = [];
    particles = [];
    score = 0;
    spawnTimer = 1200;
    bufferRemaining = 5000;
    lastCountdown = 5;
    playTime = 0;
    bird.y = height() / 2;
    bird.velocity = 0;
    scoreElement.textContent = "0";
    running = true;
    paused = false;
    haptic(35);
    startMusic();
    lastFrame = performance.now();
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(update);
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      stopMusic();
    } else {
      startMusic();
    }
  }

  async function loadProjects() {
    try {
      const projects = await getAuthorizedJson("/projects");
      const names = projects.map((project) => String(project.project_name || "").trim()).filter(Boolean);
      if (names.length) projectNames = names;
    } catch (_error) {}
  }

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    ensureAudio();
    if (running) flap(); else start();
  });
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      ensureAudio();
      if (running) flap(); else start();
    }
    if (event.code === "KeyP") togglePause();
  });
  window.addEventListener("resize", () => { resizeCanvas(); paint(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running && !paused) togglePause();
  });
  window.addEventListener("pagehide", stopMusic);

  resizeCanvas();
  paint();
  loadProjects().finally(() => {
    if (!hasStartedOnce) start();
  });
})();
