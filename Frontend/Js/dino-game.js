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
  const picker = document.querySelector("#arcade-game-picker");

  const width = canvas.width;
  const height = canvas.height;
  const dayMs = 24 * 60 * 60 * 1000;
  const colors = {
    ink: "#15211d",
    green: "#2f6f5d",
    muted: "#6c7b76",
    cream: "#fff8e9",
    sky: "#eaf5ef",
    lavender: "#efedff",
    red: "#d66b3d",
    gold: "#d99a2b",
    purple: "#6761dd",
  };

  let activeDefinition = null;
  let activeGame = null;
  let running = false;
  let paused = false;
  let frameId = 0;
  let previousTime = 0;
  let currentScore = 0;
  let bestScore = 0;

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function getBestKey(gameId) {
    return `nexora_arcade_best_${gameId}`;
  }

  function getUtcDayNumber() {
    const now = new Date();
    return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / dayMs);
  }

  function getDailyIndex() {
    return getUtcDayNumber() % GAMES.length;
  }

  function clearScene(topColor, bottomColor) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, topColor);
    gradient.addColorStop(1, bottomColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawPill(x, y, w, h, color) {
    if (w <= 0 || h <= 0) {
      return;
    }

    const radius = Math.min(h / 2, w / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fill();
  }

  function updateScore(value) {
    currentScore = Math.max(0, value || 0);
    scoreOutput.textContent = formatScore(currentScore);
  }

  function setStatus(message) {
    statusOutput.textContent = message;
  }

  function showOverlay(title, copy, buttonText = "Start game") {
    overlayTitle.textContent = title;
    overlayCopy.textContent = copy;
    startButton.textContent = buttonText;
    overlay.hidden = false;
  }

  function applyControls(controls = {}) {
    actionButton.textContent = controls.action || "Action";
    actionButton.hidden = Boolean(controls.hideAction);
    leftButton.textContent = controls.left || "Left";
    rightButton.textContent = controls.right || "Right";
    leftButton.hidden = !controls.directional;
    rightButton.hidden = !controls.directional;
  }

  function finishGame(message) {
    running = false;
    paused = false;
    cancelAnimationFrame(frameId);
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause";

    if (currentScore > bestScore) {
      bestScore = Math.floor(currentScore);
      window.localStorage.setItem(getBestKey(activeDefinition.id), String(bestScore));
      bestOutput.textContent = String(bestScore);
    }

    showOverlay("Game over", `${message} Score ${formatScore(currentScore)}.`, "Play again");
    setStatus(`Game over. Score ${formatScore(currentScore)}.`);
  }

  function renderFrame(time) {
    if (!running || paused || !activeGame) return;
    const delta = Math.min((time - previousTime) / 16.67, 2);
    previousTime = time;
    activeGame.update(delta);
    activeGame.draw();
    updateScore(activeGame.score);

    if (activeGame.done) {
      finishGame(activeGame.message || "Run complete.");
      return;
    }

    frameId = requestAnimationFrame(renderFrame);
  }

  function startGame() {
    if (!activeGame || !activeDefinition) return;
    activeGame.reset();
    running = true;
    paused = false;
    previousTime = performance.now();
    overlay.hidden = true;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause";
    updateScore(0);
    setStatus(`${activeDefinition.title} running.`);
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(renderFrame);
  }

  function togglePause() {
    if (!running || !activeGame) return;
    paused = !paused;
    pauseButton.textContent = paused ? "Resume" : "Pause";
    setStatus(paused ? "Game paused." : `${activeDefinition.title} running.`);
    if (paused) {
      cancelAnimationFrame(frameId);
      return;
    }

    previousTime = performance.now();
    frameId = requestAnimationFrame(renderFrame);
  }

  function runPrimaryAction(event) {
    event?.preventDefault();
    if (!running) {
      startGame();
      return;
    }
    if (!paused) {
      activeGame?.primaryDown?.(event);
      if (activeGame?.done) {
        finishGame(activeGame.message || "Game ended.");
      }
    }
  }

  function runStageAction(event) {
    if (event.target.closest("button")) return;
    event.preventDefault();
    if (!running) {
      startGame();
      return;
    }
    if (!paused) {
      if (activeGame?.pointerDown) {
        activeGame.pointerDown(event, canvas);
      } else {
        activeGame?.primaryDown?.(event);
      }
      if (activeGame?.done) {
        finishGame(activeGame.message || "Game ended.");
      }
    }
  }

  function renderPicker() {
    if (!picker || !activeDefinition) return;
    picker.innerHTML = "";
    GAMES.filter((game) => game.id !== activeDefinition.id).forEach((game) => {
      const button = document.createElement("button");
      button.className = "arcade-icon-card";
      button.type = "button";
      button.setAttribute("aria-label", `Play ${game.title}`);
      button.innerHTML = `
        <span class="arcade-icon-card-art" aria-hidden="true">${game.icon}</span>
        <span>${game.shortTitle}</span>
      `;
      button.addEventListener("click", () => selectGame(game.id));
      picker.append(button);
    });
  }

  function selectGame(gameId) {
    const dailyGame = GAMES[getDailyIndex()];
    const definition = GAMES.find((game) => game.id === gameId) || dailyGame;
    activeDefinition = definition;
    activeGame = definition.create();
    running = false;
    paused = false;
    cancelAnimationFrame(frameId);
    bestScore = Number(window.localStorage.getItem(getBestKey(definition.id))) || 0;
    bestOutput.textContent = String(bestScore);
    titleOutput.textContent = definition.title;
    descriptionOutput.textContent = definition.description;
    kickerOutput.textContent = definition.id === dailyGame.id ? "Game of the day" : "Arcade pick";
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause";
    applyControls(activeGame.controls);
    updateScore(0);
    activeGame.reset();
    activeGame.draw();
    showOverlay(definition.title, definition.instructions, definition.startLabel || "Start game");
    setStatus(`${definition.title} ready.`);
    renderPicker();
  }

  function createDinoRunGame() {
    const ground = 334;
    const player = { x: 82, y: ground - 70, width: 74, height: 70, vy: 0 };
    let obstacles = [];
    let dust = [];
    let score = 0;
    let speed = 6.2;
    let spawnClock = 0;
    let nextSpawn = 70;

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

    function drawBackground() {
      clearScene(colors.sky, colors.cream);
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
      const x = player.x;
      const y = player.y;
      const runningStep = Math.floor(score * 1.8) % 2;

      ctx.fillStyle = "rgba(21, 33, 29, 0.12)";
      ctx.beginPath();
      ctx.ellipse(x + 42, ground + 4, 42, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = colors.green;
      ctx.beginPath();
      ctx.moveTo(x + 10, y + 44);
      ctx.lineTo(x + 2, y + 35);
      ctx.lineTo(x + 18, y + 38);
      ctx.quadraticCurveTo(x + 24, y + 19, x + 45, y + 22);
      ctx.lineTo(x + 47, y + 7);
      ctx.quadraticCurveTo(x + 48, y + 1, x + 56, y + 1);
      ctx.lineTo(x + 70, y + 1);
      ctx.quadraticCurveTo(x + 76, y + 1, x + 76, y + 8);
      ctx.lineTo(x + 76, y + 20);
      ctx.lineTo(x + 62, y + 20);
      ctx.lineTo(x + 62, y + 27);
      ctx.quadraticCurveTo(x + 62, y + 37, x + 50, y + 39);
      ctx.lineTo(x + 48, y + 50);
      ctx.lineTo(x + 36, y + 50);
      ctx.quadraticCurveTo(x + 26, y + 51, x + 10, y + 44);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 63, y + 7, 5, 5);
      ctx.fillStyle = colors.ink;
      ctx.fillRect(x + 68, y + 19, 8, 4);

      ctx.fillStyle = colors.green;
      if (runningStep === 0) {
        ctx.fillRect(x + 25, y + 48, 10, 20);
        ctx.fillRect(x + 25, y + 64, 20, 7);
        ctx.fillRect(x + 45, y + 48, 10, 15);
        ctx.fillRect(x + 45, y + 60, 17, 7);
      } else {
        ctx.fillRect(x + 26, y + 48, 10, 15);
        ctx.fillRect(x + 18, y + 60, 18, 7);
        ctx.fillRect(x + 46, y + 48, 10, 20);
        ctx.fillRect(x + 46, y + 64, 20, 7);
      }
    }

    return {
      controls: { action: "Jump" },
      score: 0,
      done: false,
      message: "",
      reset() {
        obstacles = [];
        dust = [];
        score = 0;
        speed = 6.2;
        spawnClock = 0;
        nextSpawn = 70;
        player.y = ground - player.height;
        player.vy = 0;
        this.score = 0;
        this.done = false;
        this.message = "";
      },
      primaryDown() {
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
      },
      update(delta) {
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
        this.score = score;

        const hitbox = {
          x: player.x + 13,
          y: player.y + 6,
          width: player.width - 16,
          height: player.height - 6,
        };
        if (obstacles.some((item) => intersects(hitbox, item))) {
          this.done = true;
          this.message = "Obstacle hit.";
        }
      },
      draw() {
        drawBackground();
        dust.forEach((item) => {
          ctx.globalAlpha = Math.max(0, item.life / 24);
          ctx.fillStyle = colors.gold;
          ctx.fillRect(item.x, item.y, 5, 5);
        });
        ctx.globalAlpha = 1;
        obstacles.forEach((item) => {
          ctx.fillStyle = item.color;
          ctx.fillRect(item.x, item.y, item.width, item.height);
          ctx.fillRect(item.x - 7, item.y + item.height * 0.44, item.width * 0.46, 9);
          ctx.fillRect(item.x + item.width * 0.62, item.y + item.height * 0.28, item.width * 0.42, 9);
        });
        drawDino();
      },
    };
  }

  function createStackTowerGame() {
    const blockHeight = 30;
    const baseY = height - 48;
    const palette = [colors.green, colors.purple, colors.gold, colors.red];
    let blocks = [];
    let moving = null;
    let direction = 1;
    let score = 0;

    function createMovingBlock() {
      const last = blocks[blocks.length - 1];
      moving = {
        x: 0,
        y: last.y - blockHeight,
        width: last.width,
        height: blockHeight,
        speed: 5 + blocks.length * 0.18,
        color: palette[blocks.length % palette.length],
      };
      direction = 1;
    }

    return {
      controls: { action: "Drop" },
      score: 0,
      done: false,
      message: "",
      reset() {
        blocks = [{ x: width / 2 - 150, y: baseY, width: 300, height: blockHeight, color: colors.green }];
        score = 0;
        this.score = 0;
        this.done = false;
        this.message = "";
        createMovingBlock();
      },
      primaryDown() {
        const last = blocks[blocks.length - 1];
        const left = Math.max(moving.x, last.x);
        const right = Math.min(moving.x + moving.width, last.x + last.width);
        const overlap = right - left;
        if (overlap <= 6) {
          this.done = true;
          this.message = "The tower slipped.";
          return;
        }
        blocks.push({
          x: left,
          y: moving.y,
          width: overlap,
          height: blockHeight,
          color: moving.color,
        });
        score += 10;
        if (blocks.length > 10) {
          blocks.forEach((block) => {
            block.y += blockHeight;
          });
        }
        createMovingBlock();
        this.score = score;
      },
      update(delta) {
        moving.x += direction * moving.speed * delta;
        if (moving.x <= 0) {
          moving.x = 0;
          direction = 1;
        }
        if (moving.x + moving.width >= width) {
          moving.x = width - moving.width;
          direction = -1;
        }
        this.score = score;
      },
      draw() {
        clearScene("#fbf8ff", "#f7fbf8");
        ctx.fillStyle = "rgba(21, 33, 29, 0.08)";
        ctx.fillRect(0, baseY + blockHeight + 8, width, 8);
        blocks.forEach((block) => {
          ctx.fillStyle = block.color;
          ctx.fillRect(block.x, block.y, block.width, block.height);
          ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
          ctx.fillRect(block.x, block.y, block.width, 4);
        });
        ctx.fillStyle = moving.color;
        ctx.fillRect(moving.x, moving.y, moving.width, moving.height);
        ctx.fillStyle = "rgba(255, 255, 255, 0.32)";
        ctx.fillRect(moving.x, moving.y, moving.width, 4);
      },
    };
  }

  function createTapTargetGame() {
    let target = null;
    let score = 0;
    let streak = 0;
    let timeLimit = 95;
    let timeLeft = timeLimit;

    function spawnTarget() {
      const radius = clamp(42 - streak * 1.5, 20, 42);
      target = {
        x: random(radius + 24, width - radius - 24),
        y: random(radius + 28, height - radius - 28),
        radius,
      };
      timeLimit = clamp(95 - streak * 3, 45, 95);
      timeLeft = timeLimit;
    }

    function pointerToCanvas(event, targetCanvas) {
      const rect = targetCanvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * width,
        y: ((event.clientY - rect.top) / rect.height) * height,
      };
    }

    return {
      controls: { action: "Tap target", hideAction: true },
      score: 0,
      done: false,
      message: "",
      reset() {
        score = 0;
        streak = 0;
        this.score = 0;
        this.done = false;
        this.message = "";
        spawnTarget();
      },
      pointerDown(event, targetCanvas) {
        const point = pointerToCanvas(event, targetCanvas);
        const distance = Math.hypot(point.x - target.x, point.y - target.y);
        if (distance <= target.radius) {
          streak += 1;
          score += 10 + streak;
          this.score = score;
          spawnTarget();
          return;
        }
        timeLeft = Math.max(0, timeLeft - 12);
      },
      update(delta) {
        timeLeft -= delta;
        if (timeLeft <= 0) {
          this.done = true;
          this.message = "Target missed.";
        }
        this.score = score;
      },
      draw() {
        clearScene("#f7fbf8", "#fff8ef");
        const timerWidth = 320;
        const timerRatio = clamp(timeLeft / timeLimit, 0, 1);
        drawPill(width / 2 - timerWidth / 2, 30, timerWidth, 14, "rgba(47, 111, 93, 0.14)");
        drawPill(width / 2 - timerWidth / 2, 30, timerWidth * timerRatio, 14, colors.green);

        ctx.fillStyle = "rgba(103, 97, 221, 0.14)";
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.radius + 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colors.purple;
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.radius * 0.52, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colors.red;
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.radius * 0.23, 0, Math.PI * 2);
        ctx.fill();
      },
    };
  }

  const GAMES = [
    {
      id: "dino-run",
      title: "Dino Run",
      shortTitle: "Dino",
      description: "Jump over hazards and keep your sprint alive.",
      instructions: "Jump over hazards and keep your streak alive.",
      startLabel: "Start run",
      icon:
        '<svg viewBox="0 0 24 24"><path d="M6 15h2.2l.8 2h2l-.5-2h2.3l.8 2h2l-.7-2.7c1.1-.6 1.7-1.6 1.7-2.8V10h2V8h-3V5.8c0-1-.8-1.8-1.8-1.8H12v2h2.5v2H12v2h2.5v1.2c0 .5-.4.8-.8.8H9.5L6.7 9.8 5.3 11.2 7.1 13H6v2Z"/></svg>',
      create: createDinoRunGame,
    },
    {
      id: "stack-tower",
      title: "Stack Tower",
      shortTitle: "Stack",
      description: "Drop moving blocks and keep the tower balanced.",
      instructions: "Tap when the moving block lines up with the tower.",
      startLabel: "Start stack",
      icon:
        '<svg viewBox="0 0 24 24"><path d="M6 17h12v3H6v-3Zm2-5h10v3H8v-3Zm-2-5h12v3H6V7Zm4-5h8v3h-8V2Z"/></svg>',
      create: createStackTowerGame,
    },
    {
      id: "tap-target",
      title: "Tap Target",
      shortTitle: "Target",
      description: "Tap the target before the timer runs out.",
      instructions: "Start the round, then tap each target directly on the board.",
      startLabel: "Start target",
      icon:
        '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/></svg>',
      create: createTapTargetGame,
    },
  ];

  startButton.addEventListener("click", startGame);
  pauseButton.addEventListener("click", togglePause);
  actionButton.addEventListener("pointerdown", runPrimaryAction);
  leftButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    activeGame?.leftDown?.();
  });
  rightButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    activeGame?.rightDown?.();
  });
  stage.addEventListener("pointerdown", runStageAction);

  document.addEventListener("keydown", (event) => {
    if (!activeGame) return;
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) {
      runPrimaryAction(event);
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

  selectGame(GAMES[getDailyIndex()].id);
})();
