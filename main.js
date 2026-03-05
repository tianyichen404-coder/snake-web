(() => {
  /**
   * Snake (grid-based)
   * - Deterministic tick loop
   * - Input queue prevents instant reverse
   * - Timed foods with blink-before-expire
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

  // Grid settings (more cells)
  const GRID = 30; // 30x30
  const CELL = Math.floor(canvas.width / GRID);
  const PAD = Math.floor((canvas.width - CELL * GRID) / 2);

  const COLORS = {
    bg: '#05070a',
    grid: 'rgba(255,255,255,0.04)',
    snake: '#47d16c',
    snakeHead: '#77f2a0',
    red: '#ff4d4d',
    text: 'rgba(230,237,243,0.85)',
    shadow: 'rgba(0,0,0,0.35)',
  };

  const LS_BEST = 'snake_web_best_v1';
  const LS_DIFFICULTY = 'snake_web_difficulty_v1';

  // Food classification (for easier future expansion)
  const FOOD_CATEGORY = {
    BUFF: 'buff',
    DEBUFF: 'debuff',
    NORMAL: 'normal',
  };

  const FOOD_KIND = {
    RED: 'red',
    YELLOW: 'yellow',
    GRAY: 'gray',
  };

  // Global TTL rule: all foods expire and blink before disappearing.
  const FOOD_TTL_MS = 10000;
  const FOOD_BLINK_MS = 3000;

  /** @type {Record<string, {category:'normal'|'buff'|'debuff', color:string}>} */
  const FOOD_DEFS = {
    [FOOD_KIND.RED]: { category: FOOD_CATEGORY.NORMAL, color: COLORS.red },
    [FOOD_KIND.YELLOW]: { category: FOOD_CATEGORY.BUFF, color: '#ffd166' },
    [FOOD_KIND.GRAY]: { category: FOOD_CATEGORY.DEBUFF, color: '#9aa4b2' },
  };

  // Difficulty presets (tick interval in ms). Current game speed corresponds to "easy".
  // Larger ms = slower.
  const DIFFICULTY = {
    newbie: { label: '新手', baseTickMs: 150 },
    easy: { label: '简单', baseTickMs: 110 },
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

    // foods on board
    foods: /** @type {Array<{id:string, kind:'red'|'yellow'|'gray', x:number, y:number, size:number, bornAt:number, expiresAt:number}>} */ ([]),

    // effects
    yellowBuffUntil: 0,

    // spawn schedule per kind
    nextSpawnAt: {
      red: 0,
      yellow: 0,
      gray: 0,
    },

    // spawn caps to prevent the board from becoming unplayable
    maxOnBoard: {
      red: 3,
      yellow: 1,
      gray: 8, // actual target changes by difficulty
    },
  };

  function loadBest() {
    const v = Number(localStorage.getItem(LS_BEST) || '0');
    state.best = Number.isFinite(v) ? clampInt(v, 0, 999999) : 0;
    bestEl.textContent = String(state.best);
  }

  function saveBest() {
    localStorage.setItem(LS_BEST, String(state.best));
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

  function updateSpeedUI() {
    const mul = state.baseTickMs / state.tickMs;
    speedEl.textContent = `${mul.toFixed(2)}x`;
  }

  function applyDifficulty(key) {
    const preset = DIFFICULTY[key] || DIFFICULTY.easy;
    state.difficulty = key in DIFFICULTY ? key : 'easy';
    state.baseTickMs = preset.baseTickMs;
    state.minTickMs = Math.max(35, Math.round(state.baseTickMs * 0.5));
    updateSpeedUI();

    // difficulty impacts gray footprint and gray density cap
    state.maxOnBoard.gray = grayTargetCount() * 2; // allow more to exist since they are timed

    // also refresh sizes of existing gray foods
    for (const f of state.foods) {
      if (f.kind === FOOD_KIND.GRAY) {
        f.size = foodSizeForKind(f.kind);
        f.x = clampInt(f.x, 0, GRID - f.size);
        f.y = clampInt(f.y, 0, GRID - f.size);
      }
      if (f.kind === FOOD_KIND.RED) {
        f.size = redFoodSize();
        f.x = clampInt(f.x, 0, GRID - f.size);
        f.y = clampInt(f.y, 0, GRID - f.size);
      }
    }
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

  function redFoodSize() {
    // Easy mode: red food base is 2x2. Others: 1x1.
    const baseSize = state.difficulty === 'easy' ? 2 : 1;

    // Yellow buff changes red-food behavior
    const active = state.yellowBuffUntil > state.gameTimeMs;
    if (!active) return baseSize;

    // On non-easy modes, buff makes red food 2x2.
    if (state.difficulty !== 'easy') return 2;

    // On easy mode, it stays 2x2.
    return baseSize;
  }

  function redFoodValue() {
    const active = state.yellowBuffUntil > state.gameTimeMs;
    if (!active) return 10;
    // Easy mode buff: 20 points
    if (state.difficulty === 'easy') return 20;
    // Other modes buff: 15 points
    return 15;
  }

  function foodSizeForKind(kind) {
    if (kind === FOOD_KIND.RED) return redFoodSize();
    if (kind === FOOD_KIND.GRAY) {
      if (state.difficulty === 'hard') return 2;
      if (state.difficulty === 'insane') return 3;
      return 1;
    }
    return 1;
  }

  function foodPenaltyForKind(kind) {
    if (kind !== FOOD_KIND.GRAY) return 0;
    return state.difficulty === 'easy' ? 10 : 20;
  }

  function foodCells(f) {
    const size = f.size || 1;
    const cells = [];
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        cells.push({ x: f.x + dx, y: f.y + dy });
      }
    }
    return cells;
  }

  function isOccupied(x, y) {
    for (const p of state.snake) {
      if (p.x === x && p.y === y) return true;
    }
    for (const f of state.foods) {
      for (const c of foodCells(f)) {
        if (c.x === x && c.y === y) return true;
      }
    }
    return false;
  }

  function spawnFood(kind) {
    const def = FOOD_DEFS[kind];
    if (!def) return false;

    const size = foodSizeForKind(kind);
    const maxX = GRID - size;
    const maxY = GRID - size;

    // cap
    const count = state.foods.filter((f) => f.kind === kind).length;
    const cap = state.maxOnBoard[kind] ?? 999;
    if (count >= cap) return false;

    let tries = 0;
    while (tries++ < 5000) {
      const x = randInt(0, maxX);
      const y = randInt(0, maxY);

      // footprint must be empty
      let ok = true;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          if (isOccupied(x + dx, y + dy)) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }
      if (!ok) continue;

      const bornAt = state.gameTimeMs;
      const id = `${kind}:${bornAt}:${Math.random().toString(16).slice(2)}`;

      state.foods.push({
        id,
        kind,
        x,
        y,
        size,
        bornAt,
        expiresAt: bornAt + FOOD_TTL_MS,
      });

      return true;
    }

    return false;
  }

  function scheduleNextSpawn(kind, minMs, maxMs) {
    state.nextSpawnAt[kind] = state.gameTimeMs + randInt(minMs, maxMs);
  }

  function updateFoods() {
    // expire foods
    for (let i = state.foods.length - 1; i >= 0; i--) {
      if (state.foods[i].expiresAt <= state.gameTimeMs) {
        state.foods.splice(i, 1);
      }
    }

    // Yellow buff expiry affects size/value of red foods
    // Update existing red foods footprint to match current rules.
    for (const f of state.foods) {
      if (f.kind === FOOD_KIND.RED) {
        const newSize = redFoodSize();
        if (f.size !== newSize) {
          f.size = newSize;
          f.x = clampInt(f.x, 0, GRID - f.size);
          f.y = clampInt(f.y, 0, GRID - f.size);
        }
      }
    }

    // Spawn logic: foods can spawn again 1-10 seconds after the previous spawn,
    // even if older ones are still on the board (they will blink+expire by themselves).

    // Red: ensure at least one exists when running
    if (!state.foods.some((f) => f.kind === FOOD_KIND.RED)) {
      spawnFood(FOOD_KIND.RED);
      scheduleNextSpawn('red', 1000, 10000);
    }

    // Red spawn cadence
    if (state.gameTimeMs >= state.nextSpawnAt.red) {
      spawnFood(FOOD_KIND.RED);
      scheduleNextSpawn('red', 1000, 10000);
    }

    // Yellow: at most 1 on board
    if (state.gameTimeMs >= state.nextSpawnAt.yellow) {
      if (!state.foods.some((f) => f.kind === FOOD_KIND.YELLOW)) {
        spawnFood(FOOD_KIND.YELLOW);
      }
      scheduleNextSpawn('yellow', 1000, 10000);
    }

    // Gray: more frequent on harder difficulties
    if (state.gameTimeMs >= state.nextSpawnAt.gray) {
      spawnFood(FOOD_KIND.GRAY);
      const baseMin = state.difficulty === 'insane' ? 900 : state.difficulty === 'hard' ? 1200 : 1800;
      const baseMax = state.difficulty === 'insane' ? 3000 : state.difficulty === 'hard' ? 3600 : 4500;
      scheduleNextSpawn('gray', baseMin, baseMax);
    }
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

    state.foods = [];
    state.yellowBuffUntil = 0;

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

    // initial spawns
    spawnFood(FOOD_KIND.RED);
    scheduleNextSpawn('red', 1000, 10000);
    scheduleNextSpawn('yellow', 6000, 12000);
    scheduleNextSpawn('gray', 2500, 4500);

    updateSpeedUI();
    setStatus('进行中');
    draw();
  }

  function enqueueDir(d) {
    if (!state.running || state.gameOver) return;

    const lastQueued = state.nextDirQueue.length
      ? state.nextDirQueue[state.nextDirQueue.length - 1]
      : null;
    const current = lastQueued || state.dir;

    if (isOpposite(current, d)) return;
    if (current.x === d.x && current.y === d.y) return;

    if (state.nextDirQueue.length < 2) state.nextDirQueue.push(d);
  }

  function applyQueuedDir() {
    if (!state.nextDirQueue.length) return;
    const d = state.nextDirQueue.shift();
    if (!isOpposite(state.dir, d)) state.dir = d;
  }

  function endGame() {
    state.gameOver = true;
    setStatus('游戏结束（Enter 重开）', 'over');
    draw(true);
  }

  function tryEatAt(nx, ny) {
    /** @type {Array<'red'|'yellow'|'gray'>} */
    const eatenKinds = [];

    for (let i = state.foods.length - 1; i >= 0; i--) {
      const f = state.foods[i];
      const hit = foodCells(f).some((c) => c.x === nx && c.y === ny);
      if (!hit) continue;

      eatenKinds.push(f.kind);
      state.foods.splice(i, 1);
    }

    return eatenKinds;
  }

  function applyEatenEffects(kinds) {
    let ateRed = false;

    for (const kind of kinds) {
      if (kind === FOOD_KIND.RED) {
        ateRed = true;
        const val = redFoodValue();
        state.score += val;
        scoreEl.textContent = String(state.score);

        if (state.score > state.best) {
          state.best = state.score;
          bestEl.textContent = String(state.best);
          saveBest();
        }

        // speed up
        state.tickMs = Math.max(state.minTickMs, Math.round(state.tickMs * 0.97));
        updateSpeedUI();
      } else if (kind === FOOD_KIND.YELLOW) {
        const durMs = state.difficulty === 'easy' ? 15000 : 10000;
        state.yellowBuffUntil = state.gameTimeMs + durMs;
      } else if (kind === FOOD_KIND.GRAY) {
        const penalty = foodPenaltyForKind(kind);
        state.score = Math.max(0, state.score - penalty);
        scoreEl.textContent = String(state.score);
      }
    }

    return { ateRed };
  }

  function tick() {
    if (!state.running || state.paused || state.gameOver) return;

    applyQueuedDir();

    const head = state.snake[0];
    const nx = head.x + state.dir.x;
    const ny = head.y + state.dir.y;

    if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) {
      endGame();
      return;
    }

    const newHead = { x: nx, y: ny };

    // Find what we will eat on this cell
    const eatenKinds = tryEatAt(nx, ny);
    const willGrow = eatenKinds.includes(FOOD_KIND.RED);

    // Self collision (tail moves unless we grow)
    const bodyToCheck = willGrow ? state.snake : state.snake.slice(0, -1);
    for (const p of bodyToCheck) {
      if (p.x === newHead.x && p.y === newHead.y) {
        endGame();
        return;
      }
    }

    // Move
    state.snake.unshift(newHead);

    // Apply effects
    applyEatenEffects(eatenKinds);

    if (!willGrow) {
      state.snake.pop();
    }

    draw();
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

  function drawCell(gx, gy, color, isFood) {
    const x = PAD + gx * CELL;
    const y = PAD + gy * CELL;
    const r = isFood ? 9 : 6;

    ctx.fillStyle = COLORS.shadow;
    roundRectFill(x + 2, y + 3, CELL - 4, CELL - 4, r);

    ctx.fillStyle = color;
    roundRectFill(x + 1, y + 1, CELL - 4, CELL - 4, r);
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

  function draw(showOverlay = false) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // grid
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
      ctx.lineTo(x, PAD + GRID * CELL + 0.5, y);
      ctx.stroke();
    }

    // foods (blink in last 3s)
    for (const f of state.foods) {
      const def = FOOD_DEFS[f.kind];
      if (!def) continue;

      const remaining = f.expiresAt - state.gameTimeMs;
      const blinking = remaining <= FOOD_BLINK_MS;
      const visible = !blinking || (((remaining / 200) | 0) % 2 === 0);
      if (!visible) continue;

      for (const c of foodCells(f)) {
        drawCell(c.x, c.y, def.color, true);
      }
    }

    // snake
    for (let i = state.snake.length - 1; i >= 0; i--) {
      const p = state.snake[i];
      const isHead = i === 0;
      drawCell(p.x, p.y, isHead ? COLORS.snakeHead : COLORS.snake, false);
    }

    if (!state.running) {
      drawOverlay('按 Enter 开始', '方向键 / WASD 控制');
    } else if (state.paused && !state.gameOver) {
      drawOverlay('已暂停', 'Space 继续 / S 单步');
    } else if (showOverlay && state.gameOver) {
      drawOverlay('游戏结束', `得分 ${state.score}（Enter 重开）`);
    }
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

      // timed systems
      updateFoods();

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
    }

    switch (k) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        enqueueDir(DIR.Up);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
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

    state.running = false;
    setStatus('未开始');
    draw();

    window.addEventListener('keydown', onKeyDown, { passive: false });

    btnStart.addEventListener('click', () => resetGame());
    btnPause.addEventListener('click', () => togglePause());
    btnStep.addEventListener('click', () => stepOnce());

    difficultyEl.addEventListener('change', () => {
      const prevBase = state.baseTickMs;
      const prevTick = state.tickMs;
      const key = difficultyEl.value;

      applyDifficulty(key);
      saveDifficulty();

      if (state.running && !state.gameOver) {
        const mul = prevBase / prevTick;
        state.tickMs = Math.max(state.minTickMs, Math.round(state.baseTickMs / mul));
        updateSpeedUI();
        draw();
      }
    });

    requestAnimationFrame((ts) => {
      state.lastTs = ts;
      requestAnimationFrame(loop);
    });
  }

  init();
})();
