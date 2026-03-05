(() => {
  /**
   * Snake (grid-based)
   * - Deterministic tick loop
   * - Input queue prevents instant reverse
   * - Local best score
   */

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const speedEl = document.getElementById('speed');
  const statusEl = document.getElementById('status');
  const difficultyEl = document.getElementById('difficulty');

  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnStep = document.getElementById('btnStep');

  // Grid settings
  const GRID = 24; // 24x24
  const CELL = Math.floor(canvas.width / GRID);
  const PAD = Math.floor((canvas.width - CELL * GRID) / 2);

  const COLORS = {
    bg: '#05070a',
    grid: 'rgba(255,255,255,0.04)',
    snake: '#47d16c',
    snakeHead: '#77f2a0',
    food: '#ff4d4d',
    text: 'rgba(230,237,243,0.85)',
    shadow: 'rgba(0,0,0,0.35)',
  };

  const LS_BEST = 'snake_web_best_v1';
  const LS_DIFFICULTY = 'snake_web_difficulty_v1';

  // Food classification (for easier future expansion)
  const FOOD_CATEGORY = {
    BUFF: 'buff',
    DEBUFF: 'debuff',
  };

  // Special foods (timed spawns)
  // Note: base red food is handled separately.
  const SPECIAL_FOOD = {
    YELLOW: 'yellow',
    GRAY: 'gray',
  };

  /** @type {Record<string, {category:'buff'|'debuff', color:string, ttlMs:number, blinkMs:number}>} */
  const SPECIAL_FOOD_DEFS = {
    [SPECIAL_FOOD.YELLOW]: {
      category: FOOD_CATEGORY.BUFF,
      color: '#ffd166',
      ttlMs: 10000,
      blinkMs: 3000,
    },
    [SPECIAL_FOOD.GRAY]: {
      category: FOOD_CATEGORY.DEBUFF,
      color: '#9aa4b2',
      ttlMs: 10000,
      blinkMs: 3000,
    },
  };

  // Difficulty presets (tick interval in ms). Current game speed corresponds to "easy".
  // Larger ms = slower.
  const DIFFICULTY = {
    newbie: { label: '新手', baseTickMs: 150 },
    easy: { label: '简单', baseTickMs: 110 }, // current default
    hard: { label: '困难', baseTickMs: 85 },
    insane: { label: '极难', baseTickMs: 65 },
  };

  const DIR = {
    Up: { x: 0, y: -1 },
    Down: { x: 0, y: 1 },
    Left: { x: -1, y: 0 },
    Right: { x: 1, y: 0 },
  };

  function isOpposite(a, b) {
    return a && b && a.x === -b.x && a.y === -b.y;
  }

  function clampInt(n, min, max) {
    return Math.max(min, Math.min(max, n | 0));
  }

  function randInt(min, max) {
    return (Math.random() * (max - min + 1) + min) | 0;
  }

  function keyOf(p) {
    return `${p.x},${p.y}`;
  }

  function setStatus(label, kind = 'normal') {
    // kind: normal | paused | over
    if (kind === 'over') {
      statusEl.innerHTML = `状态：<strong class="over">${label}</strong>`;
      return;
    }
    if (kind === 'paused') {
      statusEl.innerHTML = `状态：<strong class="paused">${label}</strong>`;
      return;
    }
    statusEl.innerHTML = `状态：<strong>${label}</strong>`;
  }

  const state = {
    running: false,
    paused: false,
    gameOver: false,

    score: 0,
    best: 0,

    difficulty: 'easy',

    // timing
    baseTickMs: 110,
    tickMs: 110,
    minTickMs: 55,
    accMs: 0,
    lastTs: 0,
    gameTimeMs: 0,

    // snake
    snake: [], // head is [0]
    dir: DIR.Right,
    nextDirQueue: [],

    // base food (red)
    food: { x: 0, y: 0 },
    foodSize: 1,
    foodValue: 10,

    // special foods
    specials: [], // {kind:'yellow'|'gray', x,y, bornAt, expiresAt}
    nextYellowAt: 0,
    nextGrayAt: 0,

    // effects
    yellowBuffUntil: 0,
  };

  function loadBest() {
    const v = Number(localStorage.getItem(LS_BEST) || '0');
    state.best = Number.isFinite(v) ? clampInt(v, 0, 999999) : 0;
    bestEl.textContent = String(state.best);
  }

  function saveBest() {
    localStorage.setItem(LS_BEST, String(state.best));
  }

  function resetGame() {
    state.running = true;
    state.paused = false;
    state.gameOver = false;

    state.score = 0;
    scoreEl.textContent = '0';

    applyDifficulty(state.difficulty);
    state.tickMs = state.baseTickMs;
    state.accMs = 0;
    state.lastTs = performance.now();
    state.gameTimeMs = 0;

    state.specials = [];
    state.yellowBuffUntil = 0;

    // Schedule special spawns
    state.nextYellowAt = randInt(6000, 12000);
    state.nextGrayAt = randInt(2500, 4500);

    // Start snake centered, length 4
    const cx = (GRID / 2) | 0;
    const cy = (GRID / 2) | 0;

    state.snake = [
      { x: cx + 1, y: cy },
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];

    state.dir = DIR.Right;
    state.nextDirQueue = [];

    spawnFood();
    updateSpeedUI();
    setStatus('进行中');

    draw();
  }

  function isOccupied(x, y) {
    for (const p of state.snake) {
      if (p.x === x && p.y === y) return true;
    }
    for (const s of state.specials) {
      if (s.x === x && s.y === y) return true;
    }
    return false;
  }

  function redFoodCells() {
    const cells = [];
    for (let dy = 0; dy < state.foodSize; dy++) {
      for (let dx = 0; dx < state.foodSize; dx++) {
        cells.push({ x: state.food.x + dx, y: state.food.y + dy });
      }
    }
    return cells;
  }

  function normalizeRedFoodPosition() {
    // Ensure the top-left stays in-bounds for the current foodSize.
    state.food.x = clampInt(state.food.x, 0, GRID - state.foodSize);
    state.food.y = clampInt(state.food.y, 0, GRID - state.foodSize);
  }

  function spawnFood() {
    // base red food
    const maxX = GRID - state.foodSize;
    const maxY = GRID - state.foodSize;

    let tries = 0;
    while (tries++ < 5000) {
      const x = randInt(0, maxX);
      const y = randInt(0, maxY);

      // Need all occupied cells of the red food to be empty
      let ok = true;
      for (let dy = 0; dy < state.foodSize; dy++) {
        for (let dx = 0; dx < state.foodSize; dx++) {
          if (isOccupied(x + dx, y + dy)) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }

      if (ok) {
        state.food = { x, y };
        return;
      }
    }

    // In the unlikely case the board is full.
    state.food = { x: -1, y: -1 };
  }

  function enqueueDir(d) {
    if (!state.running || state.gameOver) return;

    const lastQueued = state.nextDirQueue.length
      ? state.nextDirQueue[state.nextDirQueue.length - 1]
      : null;
    const current = lastQueued || state.dir;

    // Prevent reverse
    if (isOpposite(current, d)) return;

    // Don't enqueue duplicates
    if (current.x === d.x && current.y === d.y) return;

    // Keep queue short
    if (state.nextDirQueue.length < 2) {
      state.nextDirQueue.push(d);
    }
  }

  function applyQueuedDir() {
    if (state.nextDirQueue.length) {
      const d = state.nextDirQueue.shift();
      if (!isOpposite(state.dir, d)) state.dir = d;
    }
  }

  function tick() {
    if (!state.running || state.paused || state.gameOver) return;

    applyQueuedDir();

    const head = state.snake[0];
    const nx = head.x + state.dir.x;
    const ny = head.y + state.dir.y;

    // Wall collision
    if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) {
      endGame();
      return;
    }

    const newHead = { x: nx, y: ny };

    // base food collision (red food may be bigger than 1 cell)
    const willEatRed = redFoodCells().some((c) => c.x === nx && c.y === ny);

    // special food collision
    const eatenSpecials = [];
    if (state.specials.length) {
      for (let i = state.specials.length - 1; i >= 0; i--) {
        const s = state.specials[i];
        if (s.x === nx && s.y === ny) {
          eatenSpecials.push(s.kind);
          state.specials.splice(i, 1);
        }
      }
    }

    // Self collision (note: tail moves unless we eat red)
    const bodyToCheck = willEatRed ? state.snake : state.snake.slice(0, -1);
    for (const p of bodyToCheck) {
      if (p.x === newHead.x && p.y === newHead.y) {
        endGame();
        return;
      }
    }

    // Move
    state.snake.unshift(newHead);

    // Apply special food effects
    for (const kind of eatenSpecials) {
      applySpecialFoodEffect(kind);
    }

    if (willEatRed) {
      state.score += state.foodValue;
      scoreEl.textContent = String(state.score);

      if (state.score > state.best) {
        state.best = state.score;
        bestEl.textContent = String(state.best);
        saveBest();
      }

      // Speed up a bit every red food
      // Lower ms = faster
      state.tickMs = Math.max(state.minTickMs, Math.round(state.tickMs * 0.97));
      updateSpeedUI();

      // Respawn red food (respecting current size)
      spawnFood();
    } else {
      state.snake.pop();
    }

    draw();
  }

  function endGame() {
    state.gameOver = true;
    setStatus('游戏结束（Enter 重开）', 'over');
    draw(true);
  }

  function updateSpeedUI() {
    const mul = state.baseTickMs / state.tickMs;
    speedEl.textContent = `${mul.toFixed(2)}x`;
  }

  function applyDifficulty(key) {
    const preset = DIFFICULTY[key] || DIFFICULTY.easy;
    state.difficulty = key in DIFFICULTY ? key : 'easy';
    state.baseTickMs = preset.baseTickMs;
    // Minimum tick scales with base speed, so acceleration feels consistent across difficulties.
    state.minTickMs = Math.max(35, Math.round(state.baseTickMs * 0.5));
    updateSpeedUI();
  }

  function grayTargetCount() {
    switch (state.difficulty) {
      case 'newbie':
        return 1;
      case 'easy':
        return 2;
      case 'hard':
        return 3;
      case 'insane':
        return 4;
      default:
        return 2;
    }
  }

  function applyRedFoodBuff() {
    // If yellow buff active, red food becomes 2x2 and worth 15 points. Otherwise normal.
    const active = state.yellowBuffUntil > state.gameTimeMs;
    state.foodSize = active ? 2 : 1;
    state.foodValue = active ? 15 : 10;
    normalizeRedFoodPosition();
  }

  function applySpecialFoodEffect(kind) {
    switch (kind) {
      case SPECIAL_FOOD.GRAY: {
        // Debuff: score -20
        state.score = Math.max(0, state.score - 20);
        scoreEl.textContent = String(state.score);
        break;
      }
      case SPECIAL_FOOD.YELLOW: {
        // Buff: for 10s, red food becomes 2x2 and worth 15 points
        state.yellowBuffUntil = state.gameTimeMs + 10000;
        applyRedFoodBuff();
        break;
      }
    }
  }

  function spawnSpecial(kind) {
    /** kind: 'yellow' | 'gray' */
    const def = SPECIAL_FOOD_DEFS[kind];
    if (!def) return false;

    let tries = 0;
    while (tries++ < 5000) {
      const x = randInt(0, GRID - 1);
      const y = randInt(0, GRID - 1);
      if (!isOccupied(x, y)) {
        const bornAt = state.gameTimeMs;
        state.specials.push({
          kind,
          x,
          y,
          bornAt,
          expiresAt: bornAt + def.ttlMs,
        });
        return true;
      }
    }
    return false;
  }

  function updateSpecials() {
    // Expire
    for (let i = state.specials.length - 1; i >= 0; i--) {
      if (state.specials[i].expiresAt <= state.gameTimeMs) {
        state.specials.splice(i, 1);
      }
    }

    // Yellow buff expiry
    const wasBuffActive = state.foodSize === 2;
    const isBuffActive = state.yellowBuffUntil > state.gameTimeMs;
    if (wasBuffActive !== isBuffActive) {
      applyRedFoodBuff();
      // If red food is now 2x2, ensure it's in-bounds; if it overlaps snake, respawn it.
      if (state.food.x >= 0) {
        const cells = redFoodCells();
        const overlapSnake = cells.some((c) => state.snake.some((p) => p.x === c.x && p.y === c.y));
        if (overlapSnake) spawnFood();
      }
    }

    // Spawn scheduling
    if (state.gameTimeMs >= state.nextYellowAt) {
      // At most one yellow on board
      const hasYellow = state.specials.some((s) => s.kind === SPECIAL_FOOD.YELLOW);
      if (!hasYellow) spawnSpecial(SPECIAL_FOOD.YELLOW);
      state.nextYellowAt = state.gameTimeMs + randInt(8000, 14000);
    }

    if (state.gameTimeMs >= state.nextGrayAt) {
      const grayCount = state.specials.filter((s) => s.kind === SPECIAL_FOOD.GRAY).length;
      const target = grayTargetCount();
      if (grayCount < target) {
        // Attempt to spawn up to (target - grayCount)
        const want = target - grayCount;
        for (let i = 0; i < want; i++) spawnSpecial(SPECIAL_FOOD.GRAY);
      }
      state.nextGrayAt = state.gameTimeMs + randInt(2200, 4200);
    }
  }

  function loadDifficulty() {
    const key = String(localStorage.getItem(LS_DIFFICULTY) || 'easy');
    const resolved = key in DIFFICULTY ? key : 'easy';
    difficultyEl.value = resolved;
    applyDifficulty(resolved);
  }

  function saveDifficulty() {
    localStorage.setItem(LS_DIFFICULTY, state.difficulty);
  }

  function draw(showOverlay = false) {
    // background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // subtle grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID; i++) {
      const x = PAD + i * CELL + 0.5;
      const y = PAD + i * CELL + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD + 0.5, y);
      ctx.lineTo(PAD + GRID * CELL + 0.5, y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, PAD + 0.5);
      ctx.lineTo(x, PAD + GRID * CELL + 0.5);
      ctx.stroke();
    }

    // base food (red, may be bigger)
    if (state.food.x >= 0) {
      const cells = redFoodCells();
      for (const c of cells) {
        drawCell(c.x, c.y, COLORS.food, true);
      }
    }

    // special foods (blink during last 3s)
    for (const s of state.specials) {
      const def = SPECIAL_FOOD_DEFS[s.kind];
      if (!def) continue;

      const remaining = s.expiresAt - state.gameTimeMs;
      const blinking = remaining <= def.blinkMs;
      const visible = !blinking || (((remaining / 200) | 0) % 2 === 0);
      if (!visible) continue;

      drawCell(s.x, s.y, def.color, true);
    }

    // snake
    for (let i = state.snake.length - 1; i >= 0; i--) {
      const p = state.snake[i];
      const isHead = i === 0;
      drawCell(p.x, p.y, isHead ? COLORS.snakeHead : COLORS.snake, false);
    }

    // overlay text
    if (!state.running) {
      drawOverlay('按 Enter 开始', '方向键 / WASD 控制');
    } else if (state.paused && !state.gameOver) {
      drawOverlay('已暂停', 'Space 继续 / S 单步');
    } else if (showOverlay && state.gameOver) {
      drawOverlay('游戏结束', `得分 ${state.score}（Enter 重开）`);
    }
  }

  function drawCell(gx, gy, color, isFood) {
    const x = PAD + gx * CELL;
    const y = PAD + gy * CELL;
    const r = isFood ? 9 : 6;

    // shadow
    ctx.fillStyle = COLORS.shadow;
    roundRectFill(x + 2, y + 3, CELL - 4, CELL - 4, r);

    ctx.fillStyle = color;
    roundRectFill(x + 1, y + 1, CELL - 4, CELL - 4, r);
  }

  function roundRectFill(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.fill();
  }

  function drawOverlay(title, subtitle) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';

    ctx.font = '700 34px ui-sans-serif, system-ui, -apple-system, Segoe UI';
    ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 10);

    ctx.font = '500 16px ui-sans-serif, system-ui, -apple-system, Segoe UI';
    ctx.fillStyle = 'rgba(230,237,243,0.75)';
    ctx.fillText(subtitle, canvas.width / 2, canvas.height / 2 + 20);
  }

  function togglePause() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    setStatus(state.paused ? '已暂停' : '进行中', state.paused ? 'paused' : 'normal');
    draw();
  }

  function stepOnce() {
    if (!state.running || state.gameOver) return;
    if (!state.paused) return;
    tick();
  }

  function loop(ts) {
    if (!state.running) {
      requestAnimationFrame(loop);
      return;
    }

    const dt = ts - state.lastTs;
    state.lastTs = ts;

    if (!state.paused && !state.gameOver) {
      state.gameTimeMs += dt;

      // update timed systems
      updateSpecials();

      state.accMs += dt;
      while (state.accMs >= state.tickMs) {
        state.accMs -= state.tickMs;
        tick();
        if (state.gameOver) break;
      }
    }

    requestAnimationFrame(loop);
  }

  function onKeyDown(e) {
    const k = e.key;

    // prevent page scroll on arrows/space
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) {
      e.preventDefault();
    }

    if (k === 'Enter') {
      resetGame();
      return;
    }

    if (k === ' ') {
      togglePause();
      return;
    }

    // S: when paused, do a single-step; when running, it should behave as "Down" (WASD)
    if (k === 's' || k === 'S') {
      if (state.paused) {
        stepOnce();
        return;
      }
      // fall through to movement handling
    }

    // Movement
    switch (k) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        enqueueDir(DIR.Up);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        // Note: S reserved for step when paused; movement still ok when running.
        enqueueDir(DIR.Down);
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        enqueueDir(DIR.Left);
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        enqueueDir(DIR.Right);
        break;
    }
  }

  function init() {
    loadBest();
    loadDifficulty();
    applyRedFoodBuff();

    state.running = false;
    setStatus('未开始');
    draw();

    window.addEventListener('keydown', onKeyDown, { passive: false });

    btnStart.addEventListener('click', () => resetGame());
    btnPause.addEventListener('click', () => togglePause());
    btnStep.addEventListener('click', () => stepOnce());

    // Change difficulty. If game is already running, preserve the current speed multiplier.
    difficultyEl.addEventListener('change', () => {
      const prevBase = state.baseTickMs;
      const prevTick = state.tickMs;
      const key = difficultyEl.value;

      applyDifficulty(key);
      saveDifficulty();

      if (state.running && !state.gameOver) {
        const mul = prevBase / prevTick; // e.g. 1.30x
        state.tickMs = Math.max(state.minTickMs, Math.round(state.baseTickMs / mul));
        updateSpeedUI();
        draw();
      }
    });

    canvas.addEventListener('pointerdown', () => canvas.focus?.());

    requestAnimationFrame((ts) => {
      state.lastTs = ts;
      requestAnimationFrame(loop);
    });
  }

  init();
})();
