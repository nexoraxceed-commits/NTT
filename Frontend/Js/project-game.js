(() => {
  const canvas = document.querySelector("#project-game-canvas");
  if (!canvas) return;

  const context = canvas.getContext("2d");
  const stage = document.querySelector("#project-game-stage");
  const overlay = document.querySelector("#project-game-overlay");
  const overlayTitle = document.querySelector("#project-game-overlay-title");
  const overlayCopy = document.querySelector("#project-game-overlay-copy");
  const startButton = document.querySelector("#project-game-start");
  const flapButton = document.querySelector("#project-game-flap");
  const pauseButton = document.querySelector("#project-game-pause");
  const scoreElement = document.querySelector("#project-game-score");
  const bestElement = document.querySelector("#project-game-best");
  const messageElement = document.querySelector("#project-game-message");
  const bestKey = "nexora-project-game-best";
  const bird = { x: 150, y: 240, radius: 18, velocity: 0 };
  let projectNames = ["New Project"];
  let obstacles = [];
  let score = 0;
  let best = Number(window.localStorage.getItem(bestKey) || 0);
  let running = false;
  let paused = false;
  let lastFrame = 0;
  let spawnTimer = 0;
  let frameId = 0;

  bestElement.textContent = String(best);

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(300, stage.clientWidth);
    const height = Math.max(360, Math.min(520, width * 0.54));
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
    if (score > best) {
      best = score;
      window.localStorage.setItem(bestKey, String(best));
      bestElement.textContent = String(best);
    }
    overlayTitle.textContent = "Project collision!";
    overlayCopy.textContent = `You dodged ${score} project${score === 1 ? "" : "s"}.`;
    startButton.textContent = "Play again";
    overlay.hidden = false;
    pauseButton.disabled = true;
  }

  function update(timestamp) {
    if (!running) return;
    const delta = Math.min(32, timestamp - lastFrame || 16) / 16.67;
    lastFrame = timestamp;
    if (!paused) {
      bird.velocity += 0.24 * delta;
      bird.y += bird.velocity * delta;
      spawnTimer -= 16.67 * delta;
      if (spawnTimer <= 0) {
        spawnObstacle();
        spawnTimer = Math.max(780, 1550 - score * 20);
      }
      const speed = 3.5 + Math.min(4, score * 0.08);
      obstacles.forEach((item) => {
        item.x -= speed * delta;
        if (!item.counted && item.x + item.width < bird.x) {
          item.counted = true;
          score += 1;
          scoreElement.textContent = String(score);
        }
      });
      obstacles = obstacles.filter((item) => item.x + item.width > -30);
      if (bird.y - bird.radius <= 0 || bird.y + bird.radius >= height() || obstacles.some(collides)) {
        paint();
        finish();
        return;
      }
    }
    paint();
    frameId = requestAnimationFrame(update);
  }

  function flap() {
    if (!running) return;
    if (paused) togglePause();
    bird.velocity = -7.8;
  }

  function start() {
    obstacles = [];
    score = 0;
    spawnTimer = 650;
    bird.y = height() / 2;
    bird.velocity = 0;
    scoreElement.textContent = "0";
    running = true;
    paused = false;
    overlay.hidden = true;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause";
    lastFrame = performance.now();
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(update);
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    pauseButton.textContent = paused ? "Resume" : "Pause";
    messageElement.textContent = paused ? "Game paused." : "Game running.";
  }

  async function loadProjects() {
    try {
      const projects = await getAuthorizedJson("/projects");
      const names = projects.map((project) => String(project.project_name || "").trim()).filter(Boolean);
      if (names.length) projectNames = names;
      messageElement.textContent = `${projectNames.length} project name${projectNames.length === 1 ? "" : "s"} loaded. Space, click, or tap to flap.`;
    } catch (error) {
      messageElement.textContent = "Project names could not be loaded; using a practice project.";
    }
  }

  startButton.addEventListener("click", start);
  flapButton.addEventListener("click", flap);
  pauseButton.addEventListener("click", togglePause);
  canvas.addEventListener("pointerdown", (event) => { event.preventDefault(); flap(); });
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      if (running) flap(); else start();
    }
    if (event.code === "KeyP") togglePause();
  });
  window.addEventListener("resize", () => { resizeCanvas(); paint(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running && !paused) togglePause();
  });

  resizeCanvas();
  paint();
  loadProjects();
})();
