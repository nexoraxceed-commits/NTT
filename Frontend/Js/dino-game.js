(() => {
  const canvas = document.querySelector("#arcade-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const stage = document.querySelector("#arcade-stage");
  const overlay = document.querySelector("#arcade-overlay");
  const overlayTitle = document.querySelector("#arcade-overlay-title");
  const overlayCopy = document.querySelector("#arcade-overlay-copy");
  const startButton = document.querySelector("#arcade-start");
  const actionButton = document.querySelector("#arcade-action");
  const leftButton = document.querySelector("#arcade-left");
  const rightButton = document.querySelector("#arcade-right");
  const pauseButton = document.querySelector("#arcade-pause");
  const scoreOutput = document.querySelector("#arcade-score");
  const bestOutput = document.querySelector("#arcade-best");
  const titleOutput = document.querySelector("#arcade-title");
  const descriptionOutput = document.querySelector("#arcade-description");
  const kickerOutput = document.querySelector("#arcade-kicker");
  const statusOutput = document.querySelector("#arcade-status");

  const width = canvas.width;
  const height = canvas.height;
  const ground = 334;
  const bestKey = "nexora_dino_run_best";
  const colors = {
    ink: "#15211d",
    green: "#2f6f5d",
    muted: "#6c7b76",
    cream: "#fff8e9",
    sky: "#eaf5ef",
    red: "#d66b3d",
    gold: "#d99a2b",
  };

  let running = false;
  let paused = false;
  let frameId = 0;
  let previousTime = 0;
  let score = 0;
  let bestScore = Number(window.localStorage.getItem(bestKey)) || 0;
  let speed = 6.2;
  let spawnClock = 0;
  let nextSpawn = 70;
  let obstacles = [];
  let dust = [];
  const player = {
    x: 88,
    y: ground - 56,
    width: 44,
    height: 56,
    vy: 0,
  };

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function intersects(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  function formatScore(value) {
    return String(Math.max(0, Math.floor(value)));
  }

  function setStatus(message) {
    statusOutput.textContent = message;
  }

  function updateScore(value) {
    score = Math.max(0, value || 0);
    scoreOutput.textContent = formatScore(score);
  }

  function showOverlay(title, copy, buttonText = "Start run") {
    overlayTitle.textContent = title;
    overlayCopy.textContent = copy;
    startButton.textContent = buttonText;
    overlay.hidden = false;
  }

  function drawSceneBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, colors.sky);
    gradient.addColorStop(1, colors.cream);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(47, 111, 93, 0.28)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, ground + 2);
    ctx.lineTo(width, ground + 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(47, 111, 93, 0.15)";
    for (let x = -(score * speed * 4) % 54; x < width; x += 54) {
      ctx.fillRect(x, ground + 24, 28, 4);
    }
  }

  function drawDino() {
    ctx.fillStyle = colors.green;
    ctx.fillRect(player.x + 8, player.y + 14, 30, 34);
    ctx.fillRect(player.x + 28, player.y, 24, 30);
    ctx.fillRect(player.x, player.y + 30, 18, 10);

    const footOffset = Math.floor(score) % 2 === 0 ? 0 : 6;
    ctx.fillRect(player.x + 11, player.y + 48, 8, 10 + footOffset);
    ctx.fillRect(player.x + 29, player.y + 48, 8, 16 - footOffset);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(player.x + 42, player.y + 8, 4, 4);
  }

  function drawObstacles() {
    obstacles.forEach((item) => {
      ctx.fillStyle = item.color;
      ctx.fillRect(item.x, item.y, item.width, item.height);
      ctx.fillRect(item.x - 7, item.y + item.height * 0.44, item.width * 0.46, 9);
      ctx.fillRect(item.x + item.width * 0.62, item.y + item.height * 0.28, item.width * 0.42, 9);
    });
  }

  function drawDust(delta = 1) {
    dust.forEach((item) => {
      item.x += item.vx * delta;
      item.y += item.vy * delta;
      item.life -= delta;
      ctx.globalAlpha = Math.max(0, item.life / 24);
      ctx.fillStyle = colors.gold;
      ctx.fillRect(item.x, item.y, 5, 5);
    });
    ctx.globalAlpha = 1;
    dust = dust.filter((item) => item.life > 0);
  }

  function draw() {
    drawSceneBackground();
    drawDust(0);
    drawObstacles();
    drawDino();
  }

  function spawnObstacle() {
    const wide = Math.random() > 0.55;
    obstacles.push({
      x: width + 24,
      y: ground - (wide ? 42 : 66),
      width: wide ? 46 : 28,
      height: wide ? 42 : 66,
      color: colors.red,
    });
    nextSpawn = Math.max(42, random(70, 112) - speed * 2.2);
  }

  function jump() {
    if (player.y < ground - player.height - 1) return;
    player.vy = -15.4;
    for (let i = 0; i < 6; i += 1) {
      dust.push({
        x: player.x + 8,
        y: ground - 3,
        vx: -random(1.5, 4),
        vy: -random(0.4, 2),
        life: 24,
      });
    }
  }

  function resetGame() {
    running = false;
    paused = false;
    score = 0;
    speed = 6.2;
    spawnClock = 0;
    nextSpawn = 70;
    obstacles = [];
    dust = [];
    player.y = ground - player.height;
    player.vy = 0;
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause";
    updateScore(0);
    draw();
  }

  function finishGame() {
    running = false;
    paused = false;
    cancelAnimationFrame(frameId);
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause";

    if (score > bestScore) {
      bestScore = Math.floor(score);
      window.localStorage.setItem(bestKey, String(bestScore));
      bestOutput.textContent = String(bestScore);
    }

    showOverlay("Game over", `Obstacle hit. Score ${formatScore(score)}.`, "Run again");
    setStatus(`Game over. Score ${formatScore(score)}.`);
  }

  function update(delta) {
    player.vy += 0.74 * delta;
    player.y = Math.min(ground - player.height, player.y + player.vy * delta);

    spawnClock += delta;
    if (spawnClock >= nextSpawn) {
      spawnClock = 0;
      spawnObstacle();
    }

    obstacles.forEach((item) => {
      item.x -= speed * delta;
    });
    obstacles = obstacles.filter((item) => item.x + item.width > -20);

    dust.forEach((item) => {
      item.x += item.vx * delta;
      item.y += item.vy * delta;
      item.life -= delta;
    });
    dust = dust.filter((item) => item.life > 0);

    score += 0.14 * delta;
    speed = Math.min(13, speed + 0.0035 * delta);
    updateScore(score);

    const hitbox = {
      x: player.x + 8,
      y: player.y + 8,
      width: player.width - 14,
      height: player.height - 10,
    };

    if (obstacles.some((item) => intersects(hitbox, item))) {
      finishGame();
    }
  }

  function renderFrame(time) {
    if (!running || paused) return;
    const delta = Math.min((time - previousTime) / 16.67, 2);
    previousTime = time;
    update(delta);
    draw();
    if (running) {
      frameId = requestAnimationFrame(renderFrame);
    }
  }

  function startGame() {
    resetGame();
    running = true;
    paused = false;
    previousTime = performance.now();
    overlay.hidden = true;
    pauseButton.disabled = false;
    setStatus("Dino Run running.");
    frameId = requestAnimationFrame(renderFrame);
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    pauseButton.textContent = paused ? "Resume" : "Pause";
    setStatus(paused ? "Run paused." : "Dino Run running.");
    if (paused) {
      cancelAnimationFrame(frameId);
      return;
    }
    previousTime = performance.now();
    frameId = requestAnimationFrame(renderFrame);
  }

  function handleAction(event) {
    event?.preventDefault();
    if (!running) {
      startGame();
      return;
    }
    if (!paused) {
      jump();
    }
  }

  titleOutput.textContent = "Dino Run";
  descriptionOutput.textContent = "Jump over hazards and keep your sprint alive.";
  kickerOutput.textContent = "Arcade break";
  actionButton.textContent = "Jump";
  leftButton.hidden = true;
  rightButton.hidden = true;
  bestOutput.textContent = String(bestScore);

  startButton.addEventListener("click", startGame);
  pauseButton.addEventListener("click", togglePause);
  actionButton.addEventListener("pointerdown", handleAction);
  stage.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("button")) {
      handleAction(event);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) {
      handleAction(event);
    } else if (event.code === "KeyP") {
      event.preventDefault();
      togglePause();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running && !paused) {
      togglePause();
    }
  });

  resetGame();
  showOverlay("Dino Run", "Jump over hazards and keep your streak alive.", "Start run");
  setStatus("Dino Run ready.");
})();
