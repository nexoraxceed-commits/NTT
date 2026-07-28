(() => {
  const canvas = document.querySelector("#dino-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const stage = document.querySelector("#dino-stage");
  const overlay = document.querySelector("#dino-overlay");
  const title = document.querySelector("#dino-overlay-title");
  const copy = document.querySelector("#dino-overlay-copy");
  const start = document.querySelector("#dino-start");
  const jumpButton = document.querySelector("#dino-jump");
  const pauseButton = document.querySelector("#dino-pause");
  const scoreOutput = document.querySelector("#dino-score");
  const bestOutput = document.querySelector("#dino-best");
  const status = document.querySelector("#dino-status");
  const ground = 260;
  const player = { x: 76, y: 206, width: 50, height: 54, vy: 0 };
  let obstacles = [];
  let dust = [];
  let score = 0;
  let speed = 6;
  let spawnClock = 0;
  let nextSpawn = 95;
  let best = Number(localStorage.getItem("nexora_dino_best")) || 0;
  let running = false;
  let paused = false;
  let previousTime = 0;
  let frame;

  bestOutput.textContent = String(best);

  function reset() {
    obstacles = [];
    dust = [];
    score = 0;
    speed = 6;
    spawnClock = 0;
    nextSpawn = 95;
    player.y = ground - player.height;
    player.vy = 0;
    scoreOutput.textContent = "0";
  }

  function begin() {
    reset();
    running = true;
    paused = false;
    previousTime = performance.now();
    overlay.hidden = true;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause";
    status.textContent = "Game running.";
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }

  function jump() {
    if (!running) return begin();
    if (paused || player.y < ground - player.height - 1) return;
    player.vy = -14.5;
    for (let i = 0; i < 5; i += 1) {
      dust.push({ x: player.x + 10, y: ground - 4, vx: -Math.random() * 2.5, vy: -Math.random() * 2, life: 24 });
    }
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    pauseButton.textContent = paused ? "Resume" : "Pause";
    status.textContent = paused ? "Game paused." : "Game running.";
    if (paused) {
      cancelAnimationFrame(frame);
    } else {
      previousTime = performance.now();
      frame = requestAnimationFrame(update);
    }
  }

  function gameOver() {
    running = false;
    pauseButton.disabled = true;
    if (score > best) {
      best = Math.floor(score);
      localStorage.setItem("nexora_dino_best", String(best));
      bestOutput.textContent = String(best);
    }
    title.textContent = "Game over";
    copy.textContent = `You scored ${Math.floor(score)}. Ready for another run?`;
    start.textContent = "Run again";
    overlay.hidden = false;
    status.textContent = `Game over. Score ${Math.floor(score)}.`;
  }

  function spawn() {
    const tall = Math.random() > 0.45;
    const width = tall ? 25 : 42;
    const height = tall ? 56 : 36;
    obstacles.push({ x: canvas.width + 20, y: ground - height, width, height });
    nextSpawn = Math.max(48, 88 + Math.random() * 55 - speed * 3);
  }

  function hits(a, b) {
    return a.x + 7 < b.x + b.width && a.x + a.width - 7 > b.x &&
      a.y + 7 < b.y + b.height && a.y + a.height - 4 > b.y;
  }

  function update(time) {
    if (!running || paused) return;
    const delta = Math.min((time - previousTime) / 16.67, 2);
    previousTime = time;
    player.vy += 0.78 * delta;
    player.y = Math.min(ground - player.height, player.y + player.vy * delta);
    spawnClock += delta;
    if (spawnClock >= nextSpawn) {
      spawnClock = 0;
      spawn();
    }
    obstacles.forEach((item) => { item.x -= speed * delta; });
    obstacles = obstacles.filter((item) => item.x + item.width > -10);
    dust.forEach((item) => {
      item.x += item.vx * delta;
      item.y += item.vy * delta;
      item.life -= delta;
    });
    dust = dust.filter((item) => item.life > 0);
    score += 0.12 * delta;
    speed = Math.min(13, 6 + score / 180);
    scoreOutput.textContent = String(Math.floor(score));
    draw();
    if (obstacles.some((item) => hits(player, item))) return gameOver();
    frame = requestAnimationFrame(update);
  }

  function drawPlayer() {
    ctx.fillStyle = "#173e34";
    ctx.fillRect(player.x + 8, player.y + 13, 31, 35);
    ctx.fillRect(player.x + 27, player.y, 23, 28);
    ctx.fillRect(player.x, player.y + 30, 17, 10);
    ctx.fillStyle = "#f7fbf8";
    ctx.fillRect(player.x + 41, player.y + 6, 4, 4);
    ctx.fillStyle = "#173e34";
    const stride = Math.floor(score / 3) % 2;
    ctx.fillRect(player.x + 13, player.y + 45, 8, stride ? 9 : 5);
    ctx.fillRect(player.x + 31, player.y + 45, 8, stride ? 5 : 9);
  }

  function drawCactus(item) {
    ctx.fillStyle = "#d66b3d";
    ctx.fillRect(item.x + item.width * 0.34, item.y, item.width * 0.32, item.height);
    ctx.fillRect(item.x, item.y + item.height * 0.4, item.width * 0.42, 8);
    ctx.fillRect(item.x, item.y + item.height * 0.22, 7, item.height * 0.26);
    ctx.fillRect(item.x + item.width * 0.58, item.y + item.height * 0.55, item.width * 0.42, 8);
  }

  function draw() {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#eaf5ef");
    gradient.addColorStop(1, "#fff8e9");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(47,111,93,.12)";
    ctx.beginPath();
    ctx.arc(740, 70, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#98b5a8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, ground + 1);
    ctx.lineTo(canvas.width, ground + 1);
    ctx.stroke();
    ctx.fillStyle = "#98b5a8";
    for (let x = -(score * speed) % 42; x < canvas.width; x += 42) ctx.fillRect(x, ground + 17, 22, 3);
    dust.forEach((item) => {
      ctx.globalAlpha = Math.max(0, item.life / 24);
      ctx.fillRect(item.x, item.y, 4, 4);
    });
    ctx.globalAlpha = 1;
    obstacles.forEach(drawCactus);
    drawPlayer();
  }

  start.addEventListener("click", begin);
  jumpButton.addEventListener("click", jump);
  pauseButton.addEventListener("click", togglePause);
  stage.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("button")) jump();
  });
  document.addEventListener("keydown", (event) => {
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) {
      event.preventDefault();
      jump();
    } else if (event.code === "KeyP") {
      event.preventDefault();
      togglePause();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running && !paused) togglePause();
  });
  draw();
})();
