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
  const catalog = document.querySelector("#arcade-catalog");
  const nextCopy = document.querySelector("#arcade-next-copy");

  const width = canvas.width;
  const height = canvas.height;
  const colors = {
    ink: "#15211d",
    green: "#2f6f5d",
    muted: "#6c7b76",
    cream: "#fffaf0",
    lavender: "#efedff",
    mint: "#edf9ed",
    blush: "#fff1ef",
    amber: "#fff8dc",
    blue: "#edf5ff",
    purple: "#6761dd",
    red: "#b4483b",
    gold: "#d99a2b",
  };
  const palette = ["#6761dd", "#2f6f5d", "#d99a2b", "#b4483b"];
  const dayMs = 24 * 60 * 60 * 1000;
  let activeGame = null;
  let activeDefinition = null;
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

  function clearScene(topColor, bottomColor) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, topColor);
    gradient.addColorStop(1, bottomColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawPill(x, y, w, h, color) {
    const radius = h / 2;
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

  function drawCenteredText(text, y, size = 28, color = colors.green) {
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(text, width / 2, y);
    ctx.textAlign = "left";
  }

  function formatScore(score) {
    return String(Math.max(0, Math.floor(score)));
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

  function updateScore(score) {
    currentScore = Math.max(0, score || 0);
    scoreOutput.textContent = formatScore(currentScore);
  }

  function showOverlay(title, copy, buttonText = "Start game") {
    overlayTitle.textContent = title;
    overlayCopy.textContent = copy;
    startButton.textContent = buttonText;
    overlay.hidden = false;
  }

  function setStatus(message) {
    statusOutput.textContent = message;
  }

  function applyControls(controls = {}) {
    actionButton.textContent = controls.action || "Action";
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
    activeGame.draw(ctx);
    updateScore(activeGame.score || 0);

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

  function selectGame(gameId, isDaily = false) {
    const definition = GAMES.find((game) => game.id === gameId) || GAMES[getDailyIndex()];
    activeDefinition = definition;
    activeGame = definition.create();
    running = false;
    paused = false;
    cancelAnimationFrame(frameId);
    bestScore = Number(window.localStorage.getItem(getBestKey(definition.id))) || 0;
    bestOutput.textContent = String(bestScore);
    titleOutput.textContent = definition.title;
    descriptionOutput.textContent = definition.description;
    kickerOutput.textContent = isDaily ? "Today's game" : "Arcade pick";
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause";
    applyControls(activeGame.controls);
    updateScore(0);
    activeGame.reset();
    activeGame.draw(ctx);
    showOverlay(definition.title, definition.instructions, "Start game");
    setStatus(`${definition.title} ready.`);
    renderCatalog();
  }

  function createRunnerGame(options) {
    const ground = 334;
    const player = { x: 88, y: ground - 56, width: 44, height: 56, vy: 0 };
    let obstacles = [];
    let dust = [];
    let score = 0;
    let speed = options.speed || 6.2;
    let spawnClock = 0;
    let nextSpawn = 75;

    function spawnObstacle() {
      const wide = Math.random() > 0.55;
      const obstacle = {
        x: width + 24,
        y: ground - (wide ? 42 : 66),
        width: wide ? 46 : 28,
        height: wide ? 42 : 66,
        color: options.obstacleColor || colors.red,
      };
      obstacles.push(obstacle);
      nextSpawn = Math.max(42, random(70, 112) - speed * 2.2);
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
        speed = options.speed || 6.2;
        spawnClock = 0;
        nextSpawn = 75;
        player.y = ground - player.height;
        player.vy = 0;
        this.score = 0;
        this.done = false;
        this.message = "";
      },
      primaryDown() {
        if (player.y < ground - player.height - 1) return;
        player.vy = options.jump || -15.4;
        for (let i = 0; i < 6; i += 1) {
          dust.push({ x: player.x + 8, y: ground - 3, vx: -random(1.5, 4), vy: -random(0.4, 2), life: 24 });
        }
      },
      update(delta) {
        player.vy += (options.gravity || 0.74) * delta;
        player.y = Math.min(ground - player.height, player.y + player.vy * delta);
        spawnClock += delta;
        if (spawnClock >= nextSpawn) {
          spawnClock = 0;
          spawnObstacle();
        }
        obstacles.forEach((item) => { item.x -= speed * delta; });
        obstacles = obstacles.filter((item) => item.x + item.width > -20);
        dust.forEach((item) => {
          item.x += item.vx * delta;
          item.y += item.vy * delta;
          item.life -= delta;
        });
        dust = dust.filter((item) => item.life > 0);
        score += 0.14 * delta;
        speed = Math.min(options.maxSpeed || 13, speed + 0.0035 * delta);
        this.score = score;

        const hitbox = {
          x: player.x + 8,
          y: player.y + 8,
          width: player.width - 14,
          height: player.height - 10,
        };
        if (obstacles.some((item) => intersects(hitbox, item))) {
          this.done = true;
          this.message = options.endMessage || "Obstacle hit.";
        }
      },
      draw() {
        clearScene(options.sky || "#eff7ff", options.groundColor || "#fff9e6");
        ctx.strokeStyle = options.lineColor || "rgba(47, 111, 93, 0.28)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, ground + 2);
        ctx.lineTo(width, ground + 2);
        ctx.stroke();

        ctx.fillStyle = "rgba(47, 111, 93, 0.15)";
        for (let x = -(score * speed * 4) % 54; x < width; x += 54) {
          ctx.fillRect(x, ground + 24, 28, 4);
        }

        dust.forEach((item) => {
          ctx.globalAlpha = Math.max(0, item.life / 24);
          ctx.fillRect(item.x, item.y, 5, 5);
        });
        ctx.globalAlpha = 1;

        obstacles.forEach((item) => {
          ctx.fillStyle = item.color;
          ctx.fillRect(item.x, item.y, item.width, item.height);
          ctx.fillRect(item.x - 7, item.y + item.height * 0.44, item.width * 0.46, 9);
          ctx.fillRect(item.x + item.width * 0.62, item.y + item.height * 0.28, item.width * 0.42, 9);
        });

        ctx.fillStyle = options.playerColor || colors.green;
        if (options.board) {
          drawPill(player.x - 8, player.y + 45, 66, 10, colors.gold);
        }
        ctx.fillRect(player.x + 8, player.y + 14, 30, 34);
        ctx.fillRect(player.x + 28, player.y, 24, 30);
        ctx.fillRect(player.x, player.y + 30, 18, 10);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(player.x + 42, player.y + 8, 4, 4);
      },
    };
  }

  function createJetpackGame() {
    const player = { x: 100, y: 190, width: 44, height: 44, vy: 0 };
    let barriers = [];
    let coins = [];
    let held = false;
    let score = 0;
    let speed = 5.4;
    let spawnClock = 0;

    function spawnBarrier() {
      const gapTop = random(88, 250);
      const gap = 120;
      barriers.push({
        x: width + 20,
        topHeight: gapTop,
        bottomY: gapTop + gap,
        width: 34,
      });
      coins.push({ x: width + 42, y: gapTop + gap / 2, size: 14, taken: false });
    }

    return {
      controls: { action: "Hover" },
      score: 0,
      done: false,
      message: "",
      reset() {
        player.y = 190;
        player.vy = 0;
        barriers = [];
        coins = [];
        held = false;
        score = 0;
        speed = 5.4;
        spawnClock = 0;
        this.score = 0;
        this.done = false;
        this.message = "";
      },
      primaryDown() {
        held = true;
      },
      primaryUp() {
        held = false;
      },
      update(delta) {
        player.vy += (held ? -0.48 : 0.54) * delta;
        player.vy = clamp(player.vy, -8, 8.5);
        player.y += player.vy * delta;
        spawnClock += delta;
        if (spawnClock > 92) {
          spawnClock = 0;
          spawnBarrier();
        }
        barriers.forEach((item) => { item.x -= speed * delta; });
        coins.forEach((coin) => { coin.x -= speed * delta; });
        barriers = barriers.filter((item) => item.x + item.width > -20);
        coins = coins.filter((coin) => coin.x > -30 && !coin.taken);
        score += 0.1 * delta;
        speed = Math.min(10, speed + 0.0028 * delta);

        const hitbox = { x: player.x + 5, y: player.y + 5, width: 34, height: 34 };
        if (player.y < 18 || player.y + player.height > height - 18) {
          this.done = true;
          this.message = "Pilot clipped the edge.";
        }
        barriers.forEach((barrier) => {
          const top = { x: barrier.x, y: 0, width: barrier.width, height: barrier.topHeight };
          const bottom = { x: barrier.x, y: barrier.bottomY, width: barrier.width, height: height - barrier.bottomY };
          if (intersects(hitbox, top) || intersects(hitbox, bottom)) {
            this.done = true;
            this.message = "Laser gate hit.";
          }
        });
        coins.forEach((coin) => {
          if (Math.abs(coin.x - player.x) < 34 && Math.abs(coin.y - player.y) < 34) {
            coin.taken = true;
            score += 8;
          }
        });
        this.score = score;
      },
      draw() {
        clearScene("#eef7ff", "#fff4e7");
        ctx.fillStyle = "rgba(103, 97, 221, 0.12)";
        ctx.fillRect(0, 0, width, 62);
        ctx.fillRect(0, height - 62, width, 62);
        barriers.forEach((barrier) => {
          ctx.fillStyle = colors.red;
          ctx.fillRect(barrier.x, 0, barrier.width, barrier.topHeight);
          ctx.fillRect(barrier.x, barrier.bottomY, barrier.width, height - barrier.bottomY);
        });
        coins.forEach((coin) => {
          ctx.fillStyle = colors.gold;
          ctx.beginPath();
          ctx.arc(coin.x, coin.y, coin.size, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.fillStyle = colors.green;
        drawPill(player.x, player.y + 12, 52, 22, colors.green);
        ctx.fillStyle = "#fff";
        ctx.fillRect(player.x + 34, player.y + 18, 6, 5);
        ctx.fillStyle = held ? colors.gold : "#dfe8e4";
        ctx.fillRect(player.x - 12, player.y + 19, 16, 10);
      },
    };
  }

  function createCrossyGame() {
    const lanes = 9;
    const laneHeight = height / lanes;
    const player = { col: 4, row: lanes - 1 };
    let cars = [];
    let score = 0;

    function buildCars() {
      cars = [];
      for (let row = 1; row < lanes - 1; row += 1) {
        const dir = row % 2 === 0 ? 1 : -1;
        for (let i = 0; i < 3; i += 1) {
          cars.push({
            row,
            x: random(0, width) + i * 260,
            width: random(66, 112),
            height: 32,
            dir,
            speed: random(2.4, 5.4),
            color: palette[row % palette.length],
          });
        }
      }
    }

    function move(dx, dy) {
      player.col = clamp(player.col + dx, 0, 8);
      player.row = clamp(player.row + dy, 0, lanes - 1);
      if (player.row === 0) {
        score += 20;
        player.row = lanes - 1;
      }
    }

    return {
      controls: { action: "Hop", left: "Left", right: "Right", directional: true },
      score: 0,
      done: false,
      message: "",
      reset() {
        player.col = 4;
        player.row = lanes - 1;
        score = 0;
        buildCars();
        this.score = 0;
        this.done = false;
        this.message = "";
      },
      primaryDown() {
        move(0, -1);
      },
      leftDown() {
        move(-1, 0);
      },
      rightDown() {
        move(1, 0);
      },
      update(delta) {
        cars.forEach((car) => {
          car.x += car.dir * car.speed * delta;
          if (car.dir > 0 && car.x > width + 120) car.x = -180;
          if (car.dir < 0 && car.x < -180) car.x = width + 120;
        });
        const playerRect = {
          x: player.col * (width / 9) + 25,
          y: player.row * laneHeight + 14,
          width: 42,
          height: 42,
        };
        cars.forEach((car) => {
          const carRect = { x: car.x, y: car.row * laneHeight + 18, width: car.width, height: car.height };
          if (intersects(playerRect, carRect)) {
            this.done = true;
            this.message = "Traffic won this round.";
          }
        });
        score += 0.025 * delta;
        this.score = score;
      },
      draw() {
        clearScene("#f7fbf8", "#eef2ff");
        for (let row = 0; row < lanes; row += 1) {
          ctx.fillStyle = row === 0 || row === lanes - 1 ? colors.mint : row % 2 ? "#eef0f3" : "#e7eaee";
          ctx.fillRect(0, row * laneHeight, width, laneHeight - 2);
        }
        cars.forEach((car) => {
          drawPill(car.x, car.row * laneHeight + 20, car.width, car.height, car.color);
        });
        ctx.fillStyle = colors.green;
        ctx.fillRect(player.col * (width / 9) + 28, player.row * laneHeight + 16, 36, 36);
        ctx.fillStyle = "#fff";
        ctx.fillRect(player.col * (width / 9) + 38, player.row * laneHeight + 22, 5, 5);
      },
    };
  }

  function createStackGame() {
    let blocks = [];
    let moving = null;
    let direction = 1;
    let score = 0;

    function makeMoving() {
      const last = blocks[blocks.length - 1];
      moving = {
        x: 0,
        y: last.y - 26,
        width: last.width,
        height: 26,
        speed: 5 + score * 0.12,
      };
      direction = 1;
    }

    return {
      controls: { action: "Drop" },
      score: 0,
      done: false,
      message: "",
      reset() {
        blocks = [{ x: width / 2 - 150, y: height - 38, width: 300, height: 28, color: colors.green }];
        score = 0;
        makeMoving();
        this.score = 0;
        this.done = false;
        this.message = "";
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
          height: moving.height,
          color: palette[blocks.length % palette.length],
        });
        score += 10;
        if (blocks.length > 10) {
          blocks.forEach((block) => { block.y += 26; });
        }
        makeMoving();
      },
      update(delta) {
        moving.x += direction * moving.speed * delta;
        if (moving.x < 0) {
          moving.x = 0;
          direction = 1;
        }
        if (moving.x + moving.width > width) {
          moving.x = width - moving.width;
          direction = -1;
        }
        this.score = score;
      },
      draw() {
        clearScene("#fbf8ff", "#f7fbf8");
        blocks.forEach((block) => {
          ctx.fillStyle = block.color;
          ctx.fillRect(block.x, block.y, block.width, block.height);
        });
        ctx.fillStyle = colors.gold;
        ctx.fillRect(moving.x, moving.y, moving.width, moving.height);
      },
    };
  }

  function createHelixGame() {
    let rotation = 0;
    let direction = 0;
    let ballY = 60;
    let velocity = 0;
    let rings = [];
    let score = 0;

    function buildRings() {
      rings = [];
      for (let i = 0; i < 7; i += 1) {
        rings.push({ y: 110 + i * 48, gap: random(0, Math.PI * 2), width: random(0.75, 1.05), passed: false });
      }
    }

    function angleInGap(angle, ring) {
      let diff = Math.abs(((angle - ring.gap + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return diff < ring.width / 2;
    }

    return {
      controls: { action: "Drop", left: "Rotate", right: "Rotate", directional: true },
      score: 0,
      done: false,
      message: "",
      reset() {
        rotation = 0;
        direction = 0;
        ballY = 60;
        velocity = 0;
        score = 0;
        buildRings();
        this.score = 0;
        this.done = false;
        this.message = "";
      },
      primaryDown() {
        velocity = Math.max(velocity, 7);
      },
      leftDown() {
        direction = -1;
      },
      leftUp() {
        if (direction < 0) direction = 0;
      },
      rightDown() {
        direction = 1;
      },
      rightUp() {
        if (direction > 0) direction = 0;
      },
      update(delta) {
        rotation += direction * 0.08 * delta;
        velocity += 0.1 * delta;
        ballY += velocity * delta;
        rings.forEach((ring) => {
          if (!ring.passed && ballY >= ring.y - 4) {
            if (!angleInGap(rotation, ring)) {
              this.done = true;
              this.message = "The ball hit a platform.";
            } else {
              ring.passed = true;
              score += 10;
            }
          }
        });
        if (ballY > height + 20) {
          score += 30;
          ballY = 50;
          velocity = 1.5;
          buildRings();
        }
        this.score = score;
      },
      draw() {
        clearScene("#f7fbf8", "#eef2ff");
        const cx = width / 2;
        rings.forEach((ring) => {
          ctx.strokeStyle = ring.passed ? "rgba(47,111,93,0.25)" : colors.green;
          ctx.lineWidth = 15;
          ctx.beginPath();
          ctx.arc(cx, ring.y, 160, rotation + ring.gap + ring.width / 2, rotation + ring.gap + Math.PI * 2 - ring.width / 2);
          ctx.stroke();
        });
        ctx.fillStyle = colors.purple;
        ctx.beginPath();
        ctx.arc(cx, ballY, 16, 0, Math.PI * 2);
        ctx.fill();
      },
    };
  }

  function createPinGame() {
    const center = { x: width / 2, y: height / 2 - 10 };
    let pins = [];
    let rotation = 0;
    let speed = 0.032;
    let score = 0;

    return {
      controls: { action: "Fire" },
      score: 0,
      done: false,
      message: "",
      reset() {
        pins = [0, Math.PI * 0.7, Math.PI * 1.4];
        rotation = 0;
        speed = 0.032;
        score = 0;
        this.score = 0;
        this.done = false;
        this.message = "";
      },
      primaryDown() {
        const angle = -Math.PI / 2 - rotation;
        const collision = pins.some((pin) => Math.abs(Math.atan2(Math.sin(pin - angle), Math.cos(pin - angle))) < 0.18);
        if (collision) {
          this.done = true;
          this.message = "Needle collision.";
          return;
        }
        pins.push(angle);
        score += 12;
        speed += 0.0015;
      },
      update(delta) {
        rotation += speed * delta;
        this.score = score;
      },
      draw() {
        clearScene("#fffaf0", "#f7fbf8");
        ctx.strokeStyle = colors.green;
        ctx.lineWidth = 3;
        pins.forEach((pin) => {
          const angle = pin + rotation;
          const x1 = center.x + Math.cos(angle) * 70;
          const y1 = center.y + Math.sin(angle) * 70;
          const x2 = center.x + Math.cos(angle) * 132;
          const y2 = center.y + Math.sin(angle) * 132;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.fillStyle = colors.purple;
          ctx.beginPath();
          ctx.arc(x2, y2, 8, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.fillStyle = colors.green;
        ctx.beginPath();
        ctx.arc(center.x, center.y, 68, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "700 28px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(pins.length), center.x, center.y + 10);
        ctx.textAlign = "left";
        ctx.strokeStyle = colors.red;
        ctx.beginPath();
        ctx.moveTo(center.x, height - 42);
        ctx.lineTo(center.x, center.y + 150);
        ctx.stroke();
      },
    };
  }

  function createDuetGame() {
    const center = { x: 150, y: height / 2 };
    let angle = 0;
    let direction = 1;
    let blocks = [];
    let score = 0;
    let spawnClock = 0;

    function dotRects() {
      return [0, Math.PI].map((offset) => ({
        x: center.x + Math.cos(angle + offset) * 44 - 10,
        y: center.y + Math.sin(angle + offset) * 44 - 10,
        width: 20,
        height: 20,
      }));
    }

    return {
      controls: { action: "Reverse", left: "Left", right: "Right", directional: true },
      score: 0,
      done: false,
      message: "",
      reset() {
        angle = 0;
        direction = 1;
        blocks = [];
        score = 0;
        spawnClock = 0;
        this.score = 0;
        this.done = false;
        this.message = "";
      },
      primaryDown() {
        direction *= -1;
      },
      leftDown() {
        direction = -1;
      },
      rightDown() {
        direction = 1;
      },
      update(delta) {
        angle += direction * 0.065 * delta;
        spawnClock += delta;
        if (spawnClock > 45) {
          spawnClock = 0;
          blocks.push({ x: width + 40, y: random(90, height - 90), width: 42, height: random(54, 110) });
        }
        blocks.forEach((block) => { block.x -= 5.8 * delta; });
        blocks = blocks.filter((block) => block.x + block.width > -20);
        score += 0.09 * delta;
        const dots = dotRects();
        if (blocks.some((block) => dots.some((dot) => intersects(dot, block)))) {
          this.done = true;
          this.message = "Orbit broken.";
        }
        this.score = score;
      },
      draw() {
        clearScene("#f8f7ff", "#f7fbf8");
        ctx.strokeStyle = "rgba(103,97,221,0.22)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(center.x, center.y, 44, 0, Math.PI * 2);
        ctx.stroke();
        blocks.forEach((block) => {
          ctx.fillStyle = colors.red;
          ctx.fillRect(block.x, block.y, block.width, block.height);
        });
        const dots = dotRects();
        ctx.fillStyle = colors.green;
        ctx.beginPath();
        ctx.arc(dots[0].x + 10, dots[0].y + 10, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colors.purple;
        ctx.beginPath();
        ctx.arc(dots[1].x + 10, dots[1].y + 10, 14, 0, Math.PI * 2);
        ctx.fill();
      },
    };
  }

  function createColorSwitchGame() {
    const player = { x: width / 2, y: height - 80, radius: 15, vy: 0, colorIndex: 0 };
    let gates = [];
    let score = 0;
    const gateColors = [colors.purple, colors.green, colors.gold, colors.red];

    function spawnGate(y) {
      gates.push({
        y,
        rotation: random(0, Math.PI * 2),
        speed: random(0.025, 0.055),
        passed: false,
      });
    }

    return {
      controls: { action: "Tap" },
      score: 0,
      done: false,
      message: "",
      reset() {
        player.y = height - 80;
        player.vy = 0;
        player.colorIndex = 0;
        gates = [];
        score = 0;
        [250, 120, -10].forEach(spawnGate);
        this.score = 0;
        this.done = false;
        this.message = "";
      },
      primaryDown() {
        player.vy = -8.4;
      },
      update(delta) {
        player.vy += 0.38 * delta;
        player.y += player.vy * delta;
        if (player.y > height - 50) {
          player.y = height - 50;
          player.vy = 0;
        }
        gates.forEach((gate) => {
          gate.rotation += gate.speed * delta;
          gate.y += 1.35 * delta;
          if (!gate.passed && Math.abs(player.y - gate.y) < 18) {
            const angle = ((gate.rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            const zone = Math.floor(angle / (Math.PI / 2)) % 4;
            if (zone !== player.colorIndex) {
              this.done = true;
              this.message = "Wrong color gate.";
            } else {
              gate.passed = true;
              player.colorIndex = (player.colorIndex + 1) % gateColors.length;
              score += 15;
            }
          }
        });
        gates = gates.filter((gate) => gate.y < height + 70);
        while (gates.length < 3) {
          const topY = Math.min(...gates.map((gate) => gate.y));
          spawnGate(topY - 140);
        }
        this.score = score;
      },
      draw() {
        clearScene("#f7fbf8", "#fff8f4");
        gates.forEach((gate) => {
          const radius = 58;
          for (let i = 0; i < 4; i += 1) {
            ctx.strokeStyle = gateColors[i];
            ctx.lineWidth = 13;
            ctx.beginPath();
            ctx.arc(width / 2, gate.y, radius, gate.rotation + i * Math.PI / 2, gate.rotation + (i + 0.8) * Math.PI / 2);
            ctx.stroke();
          }
        });
        ctx.fillStyle = gateColors[player.colorIndex];
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
        ctx.fill();
      },
    };
  }

  function createTimberGame() {
    let side = -1;
    let timer = 100;
    let score = 0;
    let branches = [];

    function buildBranches() {
      branches = Array.from({ length: 9 }, (_, index) => ({
        level: index,
        side: Math.random() > 0.5 ? 1 : -1,
      }));
    }

    function chop(nextSide) {
      side = nextSide;
      const danger = branches[0]?.side === side;
      if (danger) {
        this.done = true;
        this.message = "Branch hit.";
        return;
      }
      branches.shift();
      branches.push({ level: 8, side: Math.random() > 0.5 ? 1 : -1 });
      score += 5;
      timer = Math.min(100, timer + 8);
    }

    return {
      controls: { action: "Chop", left: "Left", right: "Right", directional: true },
      score: 0,
      done: false,
      message: "",
      reset() {
        side = -1;
        timer = 100;
        score = 0;
        buildBranches();
        this.score = 0;
        this.done = false;
        this.message = "";
      },
      primaryDown() {
        chop.call(this, side);
      },
      leftDown() {
        chop.call(this, -1);
      },
      rightDown() {
        chop.call(this, 1);
      },
      update(delta) {
        timer -= 0.34 * delta;
        if (timer <= 0) {
          this.done = true;
          this.message = "Time ran out.";
        }
        this.score = score;
      },
      draw() {
        clearScene("#fffaf0", "#f7fbf8");
        ctx.fillStyle = colors.green;
        ctx.fillRect(width / 2 - 35, 70, 70, 290);
        branches.forEach((branch, index) => {
          ctx.fillStyle = colors.gold;
          const y = 90 + index * 34;
          const x = branch.side > 0 ? width / 2 + 30 : width / 2 - 150;
          ctx.fillRect(x, y, 120, 18);
        });
        ctx.fillStyle = colors.purple;
        const lumberX = side > 0 ? width / 2 + 82 : width / 2 - 132;
        ctx.fillRect(lumberX, 318, 44, 48);
        ctx.fillStyle = colors.red;
        ctx.fillRect(60, 34, timer * 3, 12);
      },
    };
  }

  const GAMES = [
    {
      id: "dino-run",
      title: "Dino Run",
      tag: "Jump runner",
      description: "A quick desert sprint with rising speed and jump timing.",
      instructions: "Jump over hazards and keep your streak alive.",
      create: () => createRunnerGame({ obstacleColor: "#d66b3d", playerColor: colors.green, sky: "#eaf5ef", groundColor: "#fff8e9" }),
    },
    {
      id: "jetpack-hover",
      title: "Jetpack Hover",
      tag: "Hover runner",
      description: "Hold to climb, release to drop, and thread through laser gates.",
      instructions: "Hold the action button or Space to hover through gaps.",
      create: createJetpackGame,
    },
    {
      id: "crossy-hop",
      title: "Crossy Hop",
      tag: "Road hopper",
      description: "Hop lane by lane while traffic patterns keep changing.",
      instructions: "Hop forward and dodge the moving traffic.",
      create: createCrossyGame,
    },
    {
      id: "rhythm-dash",
      title: "Rhythm Dash",
      tag: "Tap platformer",
      description: "A snappy tap-to-jump run with instant restarts.",
      instructions: "Jump on rhythm and clear each block cleanly.",
      create: () => createRunnerGame({ obstacleColor: colors.purple, playerColor: colors.red, sky: "#f8f7ff", groundColor: "#fffaf0", gravity: 0.84, jump: -16.2, speed: 7.2, maxSpeed: 14, endMessage: "The beat dropped." }),
    },
    {
      id: "stack-tower",
      title: "Stack Tower",
      tag: "Precision stacker",
      description: "Drop moving blocks and keep the tower balanced.",
      instructions: "Tap when the moving block lines up with the tower.",
      create: createStackGame,
    },
    {
      id: "helix-drop",
      title: "Helix Drop",
      tag: "Spiral drop",
      description: "Rotate the gaps and let the ball fall through cleanly.",
      instructions: "Use left and right to rotate the tower gaps.",
      create: createHelixGame,
    },
    {
      id: "pin-orbit",
      title: "Pin Orbit",
      tag: "Needle timing",
      description: "Fire pins into a spinning core without collisions.",
      instructions: "Fire pins into open space around the circle.",
      create: createPinGame,
    },
    {
      id: "duet-dodge",
      title: "Duet Dodge",
      tag: "Orbit dodge",
      description: "Rotate paired dots and avoid incoming blocks.",
      instructions: "Switch direction or steer left and right around blocks.",
      create: createDuetGame,
    },
    {
      id: "color-gate",
      title: "Color Gate",
      tag: "Reaction tapper",
      description: "Bounce through matching color gates as patterns rotate.",
      instructions: "Tap to rise and pass only through the matching color.",
      create: createColorSwitchGame,
    },
    {
      id: "sand-surf",
      title: "Sand Surf",
      tag: "Chill runner",
      description: "A relaxed side-scroll ride with smooth jump timing.",
      instructions: "Jump cleanly, stay moving, and land the run.",
      create: () => createRunnerGame({ obstacleColor: colors.gold, playerColor: colors.purple, sky: "#eef7ff", groundColor: "#fff0d8", gravity: 0.62, jump: -13.4, speed: 5.8, board: true, endMessage: "The rider wiped out." }),
    },
    {
      id: "timber-tap",
      title: "Timber Tap",
      tag: "Left-right reflex",
      description: "Chop fast, swap sides, and avoid the branches.",
      instructions: "Tap left or right to chop from the safe side.",
      create: createTimberGame,
    },
  ];

  function renderCatalog() {
    if (!catalog) return;
    const todayId = GAMES[getDailyIndex()].id;
    catalog.innerHTML = "";
    GAMES.forEach((game) => {
      const button = document.createElement("button");
      button.className = "arcade-card";
      button.type = "button";
      button.dataset.gameId = game.id;
      if (activeDefinition?.id === game.id) {
        button.classList.add("is-active");
      }
      button.innerHTML = `
        <span class="arcade-card-tag">${game.id === todayId ? "Today" : game.tag}</span>
        <strong>${game.title}</strong>
        <span>${game.description}</span>
      `;
      button.addEventListener("click", () => selectGame(game.id, game.id === todayId));
      catalog.append(button);
    });
  }

  function wireMomentaryButton(button, down, up) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (!running) {
        startGame();
        return;
      }
      if (!paused) down?.();
    });
    button.addEventListener("pointerup", () => up?.());
    button.addEventListener("pointercancel", () => up?.());
    button.addEventListener("pointerleave", () => up?.());
  }

  startButton.addEventListener("click", startGame);
  pauseButton.addEventListener("click", togglePause);
  wireMomentaryButton(actionButton, () => activeGame?.primaryDown?.(), () => activeGame?.primaryUp?.());
  wireMomentaryButton(leftButton, () => activeGame?.leftDown?.(), () => activeGame?.leftUp?.());
  wireMomentaryButton(rightButton, () => activeGame?.rightDown?.(), () => activeGame?.rightUp?.());
  stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    if (!running) {
      startGame();
      return;
    }
    if (!paused) activeGame?.primaryDown?.();
  });
  stage.addEventListener("pointerup", () => activeGame?.primaryUp?.());
  stage.addEventListener("pointercancel", () => activeGame?.primaryUp?.());
  document.addEventListener("keydown", (event) => {
    if (!activeGame) return;
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) {
      event.preventDefault();
      if (!running) startGame();
      else if (!paused) activeGame.primaryDown?.();
    } else if (event.code === "ArrowLeft") {
      event.preventDefault();
      if (!paused) activeGame.leftDown?.();
    } else if (event.code === "ArrowRight") {
      event.preventDefault();
      if (!paused) activeGame.rightDown?.();
    } else if (event.code === "KeyP") {
      event.preventDefault();
      togglePause();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (!activeGame) return;
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) {
      activeGame.primaryUp?.();
    } else if (event.code === "ArrowLeft") {
      activeGame.leftUp?.();
    } else if (event.code === "ArrowRight") {
      activeGame.rightUp?.();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running && !paused) {
      togglePause();
    }
  });

  const dailyGame = GAMES[getDailyIndex()];
  if (nextCopy) {
    nextCopy.textContent = "A fresh featured game appears every day. Pick any game anytime.";
  }
  selectGame(dailyGame.id, true);
})();
