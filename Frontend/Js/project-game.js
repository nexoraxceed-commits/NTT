(() => {
  const canvas = document.querySelector("#project-game-canvas");
  if (!canvas) return;

  const context = canvas.getContext("2d");
  const stage = document.querySelector("#project-game-stage");
  const scoreElement = document.querySelector("#project-game-score");
  const bird = { x: 45, y: 240, radius: 18, velocity: 0 };
  let projectNames = ["New Project"];
  let obstacles = [];
  let score = 0;
  let running = false;
  let paused = false;
  let lastFrame = 0;
  let spawnTimer = 0;
  let bufferRemaining = 0;
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
    context.fillStyle = "rgba(47, 111, 93, .08)";
    for (let x = 30; x < width(); x += 90) {
      context.beginPath();
      context.arc(x, 55 + (x % 170), 24, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawBird() {
    context.save();
    context.translate(bird.x, bird.y);
    context.rotate(Math.max(-0.35, Math.min(0.65, bird.velocity * 0.045)));
    context.fillStyle = "#f4b942";
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
    if (Math.random() < 0.28) {
      const radius = 20 + Math.random() * 13;
      obstacles.push({
        type: "balloon",
        x: width() + 30,
        y: 45 + Math.random() * Math.max(40, height() - radius * 2 - 90),
        width: radius * 2,
        height: radius * 2 + 34,
        radius,
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
        const centerY = item.y + item.radius;
        const colors = ["#e86a75", "#6d72d8", "#ef9f45", "#4ba3a1"];
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
        return;
      }
      context.fillStyle = "#2f6f5d";
      context.beginPath();
      context.roundRect(item.x, item.y, item.width, item.height, 14);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "700 16px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      const label = item.name.length > 28 ? `${item.name.slice(0, 27)}…` : item.name;
      context.fillText(label, item.x + item.width / 2, item.y + item.height / 2);
    });
  }

  function collides(item) {
    if (item.type === "balloon") {
      const centerX = item.x + item.radius;
      const centerY = item.y + item.radius;
      return (bird.x - centerX) ** 2 + (bird.y - centerY) ** 2 <
        (bird.radius + item.radius * .82) ** 2;
    }
    const nearestX = Math.max(item.x, Math.min(bird.x, item.x + item.width));
    const nearestY = Math.max(item.y, Math.min(bird.y, item.y + item.height));
    return (bird.x - nearestX) ** 2 + (bird.y - nearestY) ** 2 < bird.radius ** 2;
  }

  function paint() {
    drawBackground();
    drawObstacles();
    drawBird();
  }

  function finish() {
    running = false;
    paused = false;
    cancelAnimationFrame(frameId);
    stopMusic();
    haptic([90, 45, 140]);
  }

  function update(timestamp) {
    if (!running) return;
    const delta = Math.min(32, timestamp - lastFrame || 16) / 16.67;
    lastFrame = timestamp;
    if (!paused) {
      if (bufferRemaining > 0) {
        bufferRemaining = Math.max(0, bufferRemaining - 16.67 * delta);
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
        item.x -= speed * delta;
        if (item.type === "balloon" && !item.collected && collides(item)) {
          item.collected = true;
          score += 1;
          scoreElement.textContent = String(score);
          haptic([18, 24, 35]);
          playCollectSound();
        }
      });
      obstacles = obstacles.filter(
        (item) => !item.collected && item.x + item.width > -30
      );
      if (
        bird.y - bird.radius <= 0 ||
        bird.y + bird.radius >= height() ||
        obstacles.some((item) => item.type === "project" && collides(item))
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
    haptic(12);
  }

  function start() {
    obstacles = [];
    score = 0;
    spawnTimer = 1200;
    bufferRemaining = 5000;
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
  loadProjects().finally(start);
})();
