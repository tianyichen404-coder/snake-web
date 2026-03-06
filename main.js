(() => {
  /**
   * Snake (continuous, camera-follow)
   * - World is bounded 30x30 units
   * - Camera centers on snake head
   * - 360° turning (keyboard or mouse selectable)
   * - Self collision does NOT end game (segments can overlap)
   * - Sprint: hold Space, 1.5x speed, uses energy (recharge 10s, consume 2x), max 5s per burst
   * - Foods are sprite-based (apple/mango/rock)
   */

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const speedEl = document.getElementById('speed');
  const statusEl = document.getElementById('status');
  const difficultyEl = document.getElementById('difficulty');
  const controlModeEl = document.getElementById('controlMode');
  const energyFillEl = document.getElementById('energyFill');
  const energyTextEl = document.getElementById('energyText');

  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnStep = document.getElementById('btnStep');

  // World settings
  const WORLD = 30; // 30x30 units (bounded)

  const COLORS = {
    bg: '#05070a',
    grid: 'rgba(255,255,255,0.04)',
    border: 'rgba(230,237,243,0.16)',
    text: 'rgba(230,237,243,0.85)',
    shadow: 'rgba(0,0,0,0.35)',
  };

  // Sprites
  const SPRITES = {
    head: new Image(),
    body: new Image(),
    tail: new Image(),
    turn: new Image(),
  };
  SPRITES.head.src = 'assets/head.png';
  SPRITES.body.src = 'assets/body.png';
  SPRITES.tail.src = 'assets/tail.png';
  SPRITES.turn.src = 'assets/turn.png';

  const FOOD_KIND = {
    APPLE: 'apple',
    MANGO: 'mango',
    ROCK: 'rock',
  };

  const FOOD_SPRITES = {
    [FOOD_KIND.APPLE]: new Image(),
    [FOOD_KIND.MANGO]: new Image(),
    [FOOD_KIND.ROCK]: new Image(),
  };
  // User-specified food sprites
  FOOD_SPRITES[FOOD_KIND.APPLE].src = 'assets/Basketball.png';
  FOOD_SPRITES[FOOD_KIND.MANGO].src = 'assets/油饼.png';
  FOOD_SPRITES[FOOD_KIND.ROCK].src = 'assets/rock.png';

  const LS_BEST = 'snake_web_best_v1';
  const LS_DIFFICULTY = 'snake_web_difficulty_v1';
  const LS_CONTROL = 'snake_web_control_v1';

  // Difficulty presets
  const DIFFICULTY = {
    newbie: { label: '新手', baseSpeed: 4.2, turnSpeed: 3.4 },
    easy: { label: '简单', baseSpeed: 5.0, turnSpeed: 3.8 },
    hard: { label: '困难', baseSpeed: 6.2, turnSpeed: 4.4 },
    insane: { label: '极难', baseSpeed: 7.2, turnSpeed: 5.0 },
  };

  // Food rules
  const FOOD_TTL_MS = 10000;
  const FOOD_BLINK_MS = 3000;

  // Sprint rules
  const SPRINT_MULT = 1.5;
  const SPRINT_MAX_BURST_S = 5;
  const ENERGY_RECHARGE_S = 10; // full in 10s
  const ENERGY_CONSUME_MULT = 2; // consume rate is 2x recharge

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function wrapAngle(a) {
    const twoPi = Math.PI * 2;
    a = a % twoPi;
    if (a < 0) a += twoPi;
    return a;
  }

  function angleDelta(from, to) {
    // shortest signed delta
    let d = wrapAngle(to) - wrapAngle(from);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
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

  function loadBest() {
    const v = Number(localStorage.getItem(LS_BEST) || '0');
    state.best = Number.isFinite(v) ? clamp(v | 0, 0, 999999) : 0;
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

  function loadControlMode() {
    const key = String(localStorage.getItem(LS_CONTROL) || 'keyboard');
    const resolved = key === 'mouse' ? 'mouse' : 'keyboard';
    controlModeEl.value = resolved;
    state.controlMode = resolved;
  }

  function saveControlMode() {
    localStorage.setItem(LS_CONTROL, state.controlMode);
  }

  function updateSpeedUI() {
    // show effective multiplier vs base
    const mult = state.sprinting ? SPRINT_MULT : 1;
    speedEl.textContent = `${mult.toFixed(2)}x`;
  }

  function applyDifficulty(key) {
    const preset = DIFFICULTY[key] || DIFFICULTY.easy;
    state.difficulty = key in DIFFICULTY ? key : 'easy';
    state.baseSpeed = preset.baseSpeed;
    state.turnSpeed = preset.turnSpeed;
    updateSpeedUI();
  }

  function setEnergyUI() {
    const pct = Math.round(state.energy * 100);
    energyFillEl.style.width = `${pct}%`;
    energyTextEl.textContent = `${pct}%`;
  }

  function resizeCanvasForDPR() {
    // CSS size is controlled by layout; use bounding box to set backing store
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    state.dpr = dpr;
    state.cssW = w;
    state.cssH = h;

    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    // use CSS pixels for drawing, but with dpr scale
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  function worldToScreen(p) {
    // camera centers on head
    const scale = state.scale;
    const cx = state.cssW / 2;
    const cy = state.cssH / 2;
    const hx = state.head.x;
    const hy = state.head.y;

    return {
      x: cx + (p.x - hx) * scale,
      y: cy + (p.y - hy) * scale,
    };
  }

  function drawSpriteWorld(pos, img, rotRad, sizeWorld) {
    const s = worldToScreen(pos);
    const px = s.x;
    const py = s.y;
    const sizePx = sizeWorld * state.scale;

    if (!img || !img.complete || !img.naturalWidth) {
      // fallback circle
      ctx.fillStyle = 'rgba(71,209,108,0.85)';
      ctx.beginPath();
      ctx.arc(px, py, sizePx * 0.45, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rotRad);
    ctx.drawImage(img, -sizePx / 2, -sizePx / 2, sizePx, sizePx);
    ctx.restore();
  }

  function drawOverlay(title, subtitle) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, state.cssW, state.cssH);

    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';

    ctx.font = '700 34px ui-sans-serif, system-ui, -apple-system, Segoe UI';
    ctx.fillText(title, state.cssW / 2, state.cssH / 2 - 10);

    ctx.font = '500 16px ui-sans-serif, system-ui, -apple-system, Segoe UI';
    ctx.fillStyle = 'rgba(230,237,243,0.75)';
    ctx.fillText(subtitle, state.cssW / 2, state.cssH / 2 + 20);
  }

  function drawBackground() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, state.cssW, state.cssH);

    // border box (world bounds)
    const tl = worldToScreen({ x: 0, y: 0 });
    const br = worldToScreen({ x: WORLD, y: WORLD });
    const x = tl.x;
    const y = tl.y;
    const w = br.x - tl.x;
    const h = br.y - tl.y;

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // optional grid for orientation
    if (!state.showGrid) return;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= WORLD; i++) {
      const a = worldToScreen({ x: i, y: 0 });
      const b = worldToScreen({ x: i, y: WORLD });
      ctx.beginPath();
      ctx.moveTo(a.x + 0.5, a.y + 0.5);
      ctx.lineTo(b.x + 0.5, b.y + 0.5);
      ctx.stroke();

      const c = worldToScreen({ x: 0, y: i });
      const d = worldToScreen({ x: WORLD, y: i });
      ctx.beginPath();
      ctx.moveTo(c.x + 0.5, c.y + 0.5);
      ctx.lineTo(d.x + 0.5, d.y + 0.5);
      ctx.stroke();
    }
  }

  function drawFoods() {
    for (const f of state.foods) {
      const remaining = f.expiresAt - state.gameTimeMs;
      const blinking = remaining <= FOOD_BLINK_MS;
      const visible = !blinking || (((remaining / 200) | 0) % 2 === 0);
      if (!visible) continue;

      const img = FOOD_SPRITES[f.kind];
      drawSpriteWorld({ x: f.x, y: f.y }, img, 0, 1);
    }
  }

  function sampleBodySprites() {
    // draw from tail to head so the front segments cover older segments
    const pts = state.body;
    if (pts.length < 2) return;

    // tail
    const tail = pts[pts.length - 1];
    const beforeTail = pts[pts.length - 2];
    const tailAng = Math.atan2(tail.y - beforeTail.y, tail.x - beforeTail.x);
    drawSpriteWorld(tail, SPRITES.tail, tailAng, 1);

    // body samples (skip head and tail)
    // place a sprite every ~0.6 units along the polyline
    const step = 0.6;
    let carry = 0;

    for (let i = pts.length - 2; i > 0; i--) {
      const a = pts[i];
      const b = pts[i - 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen <= 1e-6) continue;

      const ang = Math.atan2(dy, dx);
      let t = carry;
      while (t < segLen) {
        const u = t / segLen;
        const p = { x: a.x + dx * u, y: a.y + dy * u };
        // use body sprite; turns are not strictly needed because we sample along the curve
        drawSpriteWorld(p, SPRITES.body, ang, 1);
        t += step;
      }
      carry = t - segLen;
    }

    // head
    drawSpriteWorld(state.head, SPRITES.head, state.angle, 1);
  }

  function draw(showOverlay = false) {
    resizeCanvasForDPR();

    // scale: fit world bounds in view, but keep a bit zoomed in so sprites are visible.
    // We'll set 1 world unit ~ (min(cssW, cssH) / 18) px.
    const base = Math.min(state.cssW, state.cssH);
    state.scale = Math.max(10, base / 18);

    drawBackground();
    drawFoods();
    sampleBodySprites();

    if (!state.running) {
      drawOverlay('按 Enter 开始', '选择控制方式后开始');
    } else if (state.paused && !state.gameOver) {
      drawOverlay('已暂停', 'Q 继续 / 单步按钮');
    } else if (showOverlay && state.gameOver) {
      drawOverlay('游戏结束', `得分 ${state.score}（Enter 重开）`);
    }
  }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function spawnFood(kind) {
    // Spawn on grid cells, but grid lines are hidden.
    // Use cell centers (i + 0.5, j + 0.5) so they feel aligned.
    for (let tries = 0; tries < 5000; tries++) {
      const gx = (Math.random() * WORLD) | 0;
      const gy = (Math.random() * WORLD) | 0;
      const x = gx + 0.5;
      const y = gy + 0.5;

      // Keep within safe border margin (food size ~ 1 unit)
      if (x < 0.75 || y < 0.75 || x > WORLD - 0.75 || y > WORLD - 0.75) continue;

      // ensure not too close to head
      const dx = x - state.head.x;
      const dy = y - state.head.y;
      if (dx * dx + dy * dy < 6) continue;

      state.foods.push({
        id: `${kind}:${state.gameTimeMs}:${Math.random().toString(16).slice(2)}`,
        kind,
        x,
        y,
        bornAt: state.gameTimeMs,
        expiresAt: state.gameTimeMs + FOOD_TTL_MS,
      });
      return true;
    }
    return false;
  }

  function updateFoods(dtMs) {
    // expire
    for (let i = state.foods.length - 1; i >= 0; i--) {
      if (state.foods[i].expiresAt <= state.gameTimeMs) state.foods.splice(i, 1);
    }

    // spawn cadence: keep a few on board
    const counts = {
      [FOOD_KIND.APPLE]: 0,
      [FOOD_KIND.MANGO]: 0,
      [FOOD_KIND.ROCK]: 0,
    };
    for (const f of state.foods) counts[f.kind]++;

    const caps = state.foodCaps;
    for (const k of Object.keys(counts)) {
      while (counts[k] < caps[k]) {
        if (!spawnFood(k)) break;
        counts[k]++;
      }
    }

    // eat check
    const eatRadius = 0.65; // in world units
    for (let i = state.foods.length - 1; i >= 0; i--) {
      const f = state.foods[i];
      const dx = f.x - state.head.x;
      const dy = f.y - state.head.y;
      if (dx * dx + dy * dy > eatRadius * eatRadius) continue;

      // apply effects
      if (f.kind === FOOD_KIND.APPLE) {
        state.score += 10;
        state.length += 0.9; // increase length in world units
        // subtle speed ramp
        state.baseSpeed = Math.min(state.baseSpeed * 1.01, state.baseSpeedMax);
      } else if (f.kind === FOOD_KIND.MANGO) {
        state.score += 5;
        state.length += 0.5;
        state.mangoBuffUntil = state.gameTimeMs + 10000;
      } else if (f.kind === FOOD_KIND.ROCK) {
        state.score = Math.max(0, state.score - 10);
        state.length = Math.max(3.5, state.length - 0.8);
      }

      state.foods.splice(i, 1);

      scoreEl.textContent = String(state.score);
      if (state.score > state.best) {
        state.best = state.score;
        bestEl.textContent = String(state.best);
        saveBest();
      }
    }
  }

  function updateEnergy(dtS) {
    const rechargeRate = 1 / ENERGY_RECHARGE_S;
    const consumeRate = rechargeRate * ENERGY_CONSUME_MULT;

    const wantSprint = state.sprintKeyDown && !state.paused && state.running && !state.gameOver;

    // reset burst timer when sprint key is released
    if (!wantSprint) {
      state.sprintBurstS = 0;
      state.sprinting = false;
      state.energy = clamp(state.energy + rechargeRate * dtS, 0, 1);
      setEnergyUI();
      return;
    }

    // try sprint
    const canSprint = state.energy > 0.0001 && state.sprintBurstS < SPRINT_MAX_BURST_S;
    if (canSprint) {
      state.sprinting = true;
      state.energy = clamp(state.energy - consumeRate * dtS, 0, 1);
      state.sprintBurstS += dtS;
    } else {
      state.sprinting = false;
      // still recharge a bit if you hold space with no energy or burst limit reached
      state.energy = clamp(state.energy + rechargeRate * dtS * 0.25, 0, 1);
    }

    setEnergyUI();
  }

  function updateControl(dtS) {
    if (state.controlMode === 'keyboard') {
      // Keyboard: always move forward; WASD only changes direction
      // A/D: turn
      const turn = (state.keyRight ? 1 : 0) - (state.keyLeft ? 1 : 0);
      state.angle = wrapAngle(state.angle + turn * state.turnSpeed * dtS);

      // Optional: allow W/S to slightly bias forward/back (disabled by default)
      state.throttle = 1;
    } else {
      // mouse: always forward, angle follows mouse
      state.throttle = 1;

      const dx = state.mouseWorld.x - state.head.x;
      const dy = state.mouseWorld.y - state.head.y;
      if (dx * dx + dy * dy > 1e-6) {
        const target = Math.atan2(dy, dx);
        const d = angleDelta(state.angle, target);
        const maxTurn = state.turnSpeed * dtS;
        state.angle = wrapAngle(state.angle + clamp(d, -maxTurn, maxTurn));
      }
    }
  }

  function pushHeadPoint() {
    const last = state.body[0];
    if (!last) {
      state.body.unshift({ x: state.head.x, y: state.head.y });
      return;
    }
    const dx = state.head.x - last.x;
    const dy = state.head.y - last.y;
    const d = Math.hypot(dx, dy);
    if (d >= 0.18) {
      state.body.unshift({ x: state.head.x, y: state.head.y });
      // cap points to keep memory bounded
      if (state.body.length > 3000) state.body.length = 3000;
    }
  }

  function trimBodyToLength() {
    // Keep polyline length to state.length
    let total = 0;
    const pts = state.body;
    if (pts.length < 2) return;

    // compute from head(pts[0]) towards tail
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (total + seg >= state.length) {
        // cut within this segment
        const need = state.length - total;
        const t = seg > 1e-6 ? need / seg : 0;
        const nx = a.x + (b.x - a.x) * t;
        const ny = a.y + (b.y - a.y) * t;
        pts.length = i + 2;
        pts[i + 1] = { x: nx, y: ny };
        return;
      }
      total += seg;
    }
  }

  function tick(dtMs) {
    if (!state.running || state.paused || state.gameOver) return;

    const dtS = dtMs / 1000;

    updateEnergy(dtS);
    updateControl(dtS);

    const mangoActive = state.mangoBuffUntil > state.gameTimeMs;
    const speedBonus = mangoActive ? 1.08 : 1;

    const base = state.baseSpeed * speedBonus;
    const effSpeed = base * (state.sprinting ? SPRINT_MULT : 1);

    const v = effSpeed * state.throttle;

    state.head.x += Math.cos(state.angle) * v * dtS;
    state.head.y += Math.sin(state.angle) * v * dtS;

    // world bounds (hard boundary)
    if (state.head.x < 0.5) state.head.x = 0.5;
    if (state.head.y < 0.5) state.head.y = 0.5;
    if (state.head.x > WORLD - 0.5) state.head.x = WORLD - 0.5;
    if (state.head.y > WORLD - 0.5) state.head.y = WORLD - 0.5;

    pushHeadPoint();
    trimBodyToLength();

    updateFoods(dtMs);

    updateSpeedUI();
  }

  function resetGame() {
    state.running = true;
    state.paused = false;
    state.gameOver = false;

    state.score = 0;
    scoreEl.textContent = '0';

    applyDifficulty(state.difficulty);

    state.gameTimeMs = 0;
    state.lastTs = performance.now();

    state.energy = 1;
    state.sprintBurstS = 0;
    state.sprinting = false;
    setEnergyUI();

    state.head = { x: WORLD / 2, y: WORLD / 2 };
    state.angle = 0;
    state.throttle = 1;

    // body polyline: head at index 0
    state.length = 6.5;
    state.body = [
      { x: state.head.x, y: state.head.y },
      { x: state.head.x - 1, y: state.head.y },
      { x: state.head.x - 2, y: state.head.y },
      { x: state.head.x - 3, y: state.head.y },
      { x: state.head.x - 4, y: state.head.y },
      { x: state.head.x - 5, y: state.head.y },
      { x: state.head.x - 6, y: state.head.y },
    ];

    state.foods = [];
    state.mangoBuffUntil = 0;

    // spawn caps vary by difficulty
    state.foodCaps = {
      [FOOD_KIND.APPLE]: state.difficulty === 'insane' ? 2 : 3,
      [FOOD_KIND.MANGO]: 1,
      [FOOD_KIND.ROCK]: state.difficulty === 'newbie' ? 2 : state.difficulty === 'easy' ? 4 : state.difficulty === 'hard' ? 6 : 8,
    };

    // speed ceiling for ramping
    state.baseSpeedMax = DIFFICULTY.insane.baseSpeed * 1.25;

    setStatus('进行中');
    draw();
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
    // simulate a small dt for a single step
    state.gameTimeMs += 1000 / 60;
    tick(1000 / 60);
    draw();
  }

  function loop(ts) {
    const dt = ts - state.lastTs;
    state.lastTs = ts;

    if (state.running && !state.paused && !state.gameOver) {
      state.gameTimeMs += dt;
      tick(dt);
    }

    draw();
    requestAnimationFrame(loop);
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // convert to world using inverse of worldToScreen
    const scale = state.scale || 1;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    return {
      x: state.head.x + (x - cx) / scale,
      y: state.head.y + (y - cy) / scale,
    };
  }

  function onKeyDown(e) {
    const k = e.key;

    // prevent page scroll
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();

    if (k === 'Enter') {
      resetGame();
      return;
    }

    // Q: pause / resume
    if (k === 'q' || k === 'Q') {
      togglePause();
      return;
    }

    // Space: sprint (hold). No longer used for pause.
    if (k === ' ') {
      if (!state.running || state.gameOver || state.paused) return;
      state.sprintKeyDown = true;
      return;
    }

    // WASD/Arrow keys are used to change direction (turning). Movement is always forward by default.
    if (k === 'w' || k === 'W' || k === 'ArrowUp') {
      // instant face up
      state.angle = -Math.PI / 2;
    }
    if (k === 's' || k === 'S' || k === 'ArrowDown') {
      // instant face down
      state.angle = Math.PI / 2;
    }
    if (k === 'a' || k === 'A' || k === 'ArrowLeft') state.keyLeft = true;
    if (k === 'd' || k === 'D' || k === 'ArrowRight') state.keyRight = true;

    if ((k === 's' || k === 'S') && state.paused) {
      stepOnce();
    }
  }

  function onKeyUp(e) {
    const k = e.key;

    if (k === ' ') {
      state.sprintKeyDown = false;
      return;
    }

    if (k === 'a' || k === 'A' || k === 'ArrowLeft') state.keyLeft = false;
    if (k === 'd' || k === 'D' || k === 'ArrowRight') state.keyRight = false;
  }

  function init() {
    // defaults
    state.showGrid = false; // hide grid lines (foods still spawn on grid)

    loadBest();
    loadDifficulty();
    loadControlMode();

    setEnergyUI();

    state.running = false;
    setStatus('未开始');

    // initial head for camera
    state.head = { x: WORLD / 2, y: WORLD / 2 };
    state.angle = 0;

    draw();

    window.addEventListener('resize', () => draw());

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });

    canvas.addEventListener('mousemove', (e) => {
      state.mouseWorld = screenToWorld(e.clientX, e.clientY);
    });

    canvas.addEventListener('mousedown', () => {
      // focus canvas so keyboard works in some browsers
      canvas.focus?.();
    });

    btnStart.addEventListener('click', () => resetGame());
    btnPause.addEventListener('click', () => togglePause());
    btnStep.addEventListener('click', () => stepOnce());

    difficultyEl.addEventListener('change', () => {
      applyDifficulty(difficultyEl.value);
      saveDifficulty();
      if (state.running) resetGame();
    });

    controlModeEl.addEventListener('change', () => {
      state.controlMode = controlModeEl.value === 'mouse' ? 'mouse' : 'keyboard';
      saveControlMode();
    });

    // start loop
    state.lastTs = performance.now();
    requestAnimationFrame(loop);
  }

  const state = {
    running: false,
    paused: false,
    gameOver: false,

    score: 0,
    best: 0,

    difficulty: 'easy',
    controlMode: 'keyboard',

    // timing
    gameTimeMs: 0,
    lastTs: 0,

    // rendering
    dpr: 1,
    cssW: canvas.width,
    cssH: canvas.height,
    scale: 24,
    showGrid: true,

    // movement
    head: { x: WORLD / 2, y: WORLD / 2 },
    angle: 0,
    throttle: 1,
    baseSpeed: 5.0,
    baseSpeedMax: 9.0,
    turnSpeed: 3.8,

    // input
    keyForward: false,
    keyLeft: false,
    keyRight: false,

    mouseWorld: { x: WORLD / 2 + 1, y: WORLD / 2 },

    // body polyline (head to tail)
    body: [],
    length: 6.5,

    // foods
    foods: [],
    foodCaps: {
      [FOOD_KIND.APPLE]: 3,
      [FOOD_KIND.MANGO]: 1,
      [FOOD_KIND.ROCK]: 4,
    },

    // buff
    mangoBuffUntil: 0,

    // sprint energy
    energy: 1,
    sprintKeyDown: false,
    sprinting: false,
    sprintBurstS: 0,
  };

  init();
})();
