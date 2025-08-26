// Adaptive Brick Breaker - Retina / 논리좌표 수정 버전
// 주요 변경점:
// 1) gameState.width / height = CSS 논리 크기 (dpr 미포함)
// 2) Canvas 버퍼 크기만 dpr 곱, ctx.setTransform(dpr,dpr)로 스케일
// 3) 이전 버전에서 dpr이 직접 로직 좌표에 들어가던 문제 해결
// 4) 소형 화면 최소 폭/높이 클램프 + 비율 유지
// 5) 리사이즈 시 패들/볼 재정렬 안정화

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const livesEl = document.getElementById('lives');
  const overlay = document.getElementById('overlay');
  const msgTitle = document.getElementById('messageTitle');
  const msgBody = document.getElementById('messageBody');
  const btnCloseOverlay = document.getElementById('btnCloseOverlay');
  const btnStart = document.getElementById('btnStart');
  const btnStart2 = document.getElementById('btnStart2');
  const btnPause = document.getElementById('btnPause');
  const btnMute = document.getElementById('btnMute');
  const btnMode = document.getElementById('btnMode');
  const deviceBadge = document.getElementById('deviceBadge');

  // 디바이스 감지
  const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const ua = navigator.userAgent;
  const isMobileUA = /Android|iPhone|iPad|iPod|Samsung|Windows Phone|Mobile/i.test(ua);
  const isMobile = isCoarse || isMobileUA;

  deviceBadge.textContent = isMobile ? 'MOBILE' : 'DESKTOP';
  deviceBadge.style.background = isMobile ? '#4fc3f7' : '#ffd54f';

  let controlMode = 'drag';

  // CONFIG
  const BASE_CONFIG = {
    paddle: { width: 120, height: 18, speed: 600, minWidth: 60, maxWidth: 300 },
    ball: { radius: 9, speed: 340, speedIncrementPerLevel: 28, maxSpeed: 880 },
    bricks: {
      rowsStart: 5,
      cols: 10,
      gap: 6,
      topOffset: 70,
      sideMargin: 48,
      height: 28,
      baseWidth: () => {
        const w = gameState.width - 2 * CONFIG.bricks.sideMargin;
        return Math.floor((w - (CONFIG.bricks.cols - 1) * CONFIG.bricks.gap) / CONFIG.bricks.cols);
      },
      hpBase: 1
    },
    powerups: {
      dropChance: 0.18,
      fallSpeed: 170,
      radius: 13,
      effects: [
        { type: 'expand', label: '확장', color: '#4fc3f7', duration: 12 },
        { type: 'shrink', label: '축소', color: '#ff8c00', duration: 10 },
        { type: 'slow', label: '슬로우', color: '#b388ff', duration: 6 },
        { type: 'score', label: '+점수', color: '#ffd54f', value: 160 },
        { type: 'life', label: '목숨+', color: '#81c784' }
      ]
    },
    lives: 3,
    sounds: true,
    visuals: { grid: true, gridGap: 48 }
  };
  const MOBILE_OVERRIDES = {
    paddle: { width: 170, height: 22, speed: 900, minWidth: 90, maxWidth: 360 },
    ball: { radius: 12, speed: 300, speedIncrementPerLevel: 24, maxSpeed: 760 },
    bricks: { sideMargin: 32, gap: 5, height: 30 },
    powerups: { dropChance: 0.21, fallSpeed: 190, radius: 16 },
    visuals: { gridGap: 64 }
  };

  const CONFIG = mergeDeep(BASE_CONFIG, isMobile ? MOBILE_OVERRIDES : {});

  // Game State (논리 크기: CSS px)
  let gameState = {
    running: false,
    paused: false,
    score: 0,
    level: 1,
    lives: CONFIG.lives,
    bricks: [],
    paddle: null,
    ball: null,
    powerups: [],
    keys: {},
    messagesQueue: [],
    freezeTime: 0,
    lastTime: 0,
    width: 800,
    height: 600,
    pointer: {
      active: false,
      targetX: null,
      smoothingFactor: isMobile ? 0.32 : 0.85
    }
  };

  // Retina / Responsive resize
  function resizeCanvas() {
    const wrapper = canvas.parentElement;
    let rect = wrapper.getBoundingClientRect();

    // 논리 폭/높이 (CSS px). aspect-ratio 로 높이 결정됨.
    let logicalW = rect.width;
    let logicalH = rect.height;

    // 최소 크기 (너무 작으면 조정)
    const minW = isMobile ? 320 : 500;
    const minH = isMobile ? 420 : 480;
    if (logicalW < minW) logicalW = minW;
    if (logicalH < minH) logicalH = minH;

    // 저장
    gameState.width = logicalW;
    gameState.height = logicalH;

    // 실제 캔버스 픽셀 버퍼
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(logicalW * dpr);
    canvas.height = Math.round(logicalH * dpr);
    canvas.style.width = logicalW + 'px';
    canvas.style.height = logicalH + 'px';

    // 렌더 스케일
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // (모든 좌표는 논리 px)

    // 진행중이면 패들/볼 재정렬 (stick 상태일 때 자연스럽게)
    if (gameState.paddle) {
      gameState.paddle.x = clamp(gameState.paddle.x, 0, gameState.width - gameState.paddle.w);
      gameState.paddle.y = gameState.height - (isMobile ? 90 : 70);
    }
    if (gameState.ball && gameState.ball.sticky) {
      gameState.ball.x = gameState.paddle.x + gameState.paddle.w / 2;
      gameState.ball.y = gameState.paddle.y - gameState.ball.r - 1;
    }
  }
  window.addEventListener('resize', debounce(resizeCanvas, 120));
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 160));

  // Audio
  const SFX = {
    enabled: CONFIG.sounds,
    sounds: {
      bounce: beep(230, 0.04),
      brick: beep(420, 0.05),
      lose: beep(150, 0.45),
      power: beep(680, 0.14),
      life: beep(900, 0.22),
      level: beep(540, 0.28)
    },
    play(name) { if (this.enabled) this.sounds[name]?.(); },
    toggle() { this.enabled = !this.enabled; btnMute.textContent = this.enabled ? '음소거' : '소리켜기'; }
  };
  btnMute.addEventListener('click', () => SFX.toggle());

  function beep(freq, duration) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ac;
    try { ac = new Ctx(); } catch { return () => {}; }
    return () => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square'; o.frequency.value = freq;
      o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.22, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
      o.start(); o.stop(ac.currentTime + duration);
    };
  }

  // Utils
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function debounce(fn, d) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), d); }; }
  function mergeDeep(base, over) {
    const r = JSON.parse(JSON.stringify(base));
    (function recur(t, s) {
      for (const k in s) {
        if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) {
          t[k] = t[k] || {}; recur(t[k], s[k]);
        } else t[k] = s[k];
      }
    })(r, over);
    return r;
  }

  // Entities
  function createPaddle() {
    return {
      x: (gameState.width - CONFIG.paddle.width) / 2,
      y: gameState.height - (isMobile ? 90 : 70),
      w: CONFIG.paddle.width,
      h: CONFIG.paddle.height,
      speed: CONFIG.paddle.speed,
      effectTimers: {}
    };
  }
  function createBall() {
    const angleDeg = 45 + Math.random() * 90;
    const angle = angleDeg * Math.PI / 180;
    const speed = CONFIG.ball.speed + (gameState.level - 1) * CONFIG.ball.speedIncrementPerLevel;
    return {
      x: gameState.paddle.x + gameState.paddle.w / 2,
      y: gameState.paddle.y - CONFIG.ball.radius - 1,
      r: CONFIG.ball.radius,
      speed,
      dx: speed * Math.cos(angle) * (Math.random() < 0.5 ? -1 : 1),
      dy: -Math.abs(speed * Math.sin(angle)),
      sticky: true
    };
  }
  function buildBricks() {
    const rows = CONFIG.bricks.rowsStart + Math.floor((gameState.level - 1) * 0.6);
    const cols = CONFIG.bricks.cols;
    const width = CONFIG.bricks.baseWidth();
    const arr = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hp = CONFIG.bricks.hpBase + Math.floor(r / 2) + Math.floor((gameState.level - 1) / 2);
        arr.push({
          x: CONFIG.bricks.sideMargin + c * (width + CONFIG.bricks.gap),
          y: CONFIG.bricks.topOffset + r * (CONFIG.bricks.height + CONFIG.bricks.gap),
          w: width,
          h: CONFIG.bricks.height,
          hp,
          maxHp: hp,
          alive: true
        });
      }
    }
    return arr;
  }
  function spawnPowerup(x, y) {
    if (Math.random() > CONFIG.powerups.dropChance) return;
    const eff = randItem(CONFIG.powerups.effects);
    gameState.powerups.push({
      x, y,
      r: CONFIG.powerups.radius,
      vy: CONFIG.powerups.fallSpeed,
      type: eff.type,
      label: eff.label,
      color: eff.color,
      duration: eff.duration || 0,
      value: eff.value
    });
  }

  // Powerups
  function applyPowerup(pu) {
    switch (pu.type) {
      case 'expand':
        gameState.paddle.w = clamp(gameState.paddle.w * 1.35, CONFIG.paddle.minWidth, CONFIG.paddle.maxWidth);
        setTimedEffect('expand', pu.duration);
        break;
      case 'shrink':
        gameState.paddle.w = clamp(gameState.paddle.w * 0.7, CONFIG.paddle.minWidth, CONFIG.paddle.maxWidth);
        setTimedEffect('shrink', pu.duration);
        break;
      case 'slow':
        scaleBallSpeed(0.7);
        setTimedEffect('slow', pu.duration);
        break;
      case 'score':
        addScore(pu.value || 100);
        break;
      case 'life':
        gameState.lives++;
        livesEl.textContent = gameState.lives;
        enqueueMessage('목숨 +1', 'success');
        SFX.play('life');
        break;
    }
    if (['expand', 'shrink', 'slow'].includes(pu.type)) {
      enqueueMessage(`${pu.label} 파워업!`, 'info');
      SFX.play('power');
    }
  }
  function setTimedEffect(name, dur) {
    gameState.paddle.effectTimers[name] = (gameState.paddle.effectTimers[name] || 0) + dur;
  }
  function updateTimedEffects(dt) {
    for (const k in gameState.paddle.effectTimers) {
      gameState.paddle.effectTimers[k] -= dt;
      if (gameState.paddle.effectTimers[k] <= 0) {
        delete gameState.paddle.effectTimers[k];
        if (k === 'slow') normalizeBallSpeed();
        if (k === 'expand' || k === 'shrink')
          gameState.paddle.w = clamp(CONFIG.paddle.width, CONFIG.paddle.minWidth, CONFIG.paddle.maxWidth);
      }
    }
  }
  function scaleBallSpeed(f) {
    const b = gameState.ball;
    b.dx *= f; b.dy *= f; b.speed *= f;
  }
  function normalizeBallSpeed() {
    const b = gameState.ball;
    const target = CONFIG.ball.speed + (gameState.level - 1) * CONFIG.ball.speedIncrementPerLevel;
    const cur = Math.sqrt(b.dx*b.dx + b.dy*b.dy);
    const s = target / cur;
    b.dx *= s; b.dy *= s; b.speed = target;
  }

  // Score / Level
  function addScore(v) {
    gameState.score += v;
    scoreEl.textContent = gameState.score;
  }
  function loseLife() {
    gameState.lives--;
    livesEl.textContent = gameState.lives;
    SFX.play('lose');
    if (gameState.lives <= 0) {
      endGame(false);
    } else {
      gameState.ball = createBall();
      enqueueMessage('목숨 감소', 'danger');
    }
  }
  function nextLevel() {
    gameState.level++;
    levelEl.textContent = gameState.level;
    enqueueMessage(`레벨 ${gameState.level}`, 'info');
    SFX.play('level');
    gameState.bricks = buildBricks();
    gameState.ball = createBall();
    gameState.powerups.length = 0;
    gameState.freezeTime = 1.0;
  }
  function endGame(win) {
    gameState.running = false;
    showOverlay(win ? '승리!' : '게임 오버', `최종 점수: ${gameState.score}<br>Space 또는 시작 버튼으로 재시작`);
  }

  // Messages & Overlay
  function enqueueMessage(text, type='info') {
    gameState.messagesQueue.push({ text, timer: 2.3, type });
  }
  function updateMessages(dt) {
    gameState.messagesQueue.forEach(m => m.timer -= dt);
    gameState.messagesQueue = gameState.messagesQueue.filter(m => m.timer > 0);
  }
  function drawMessages() {
    const baseY = gameState.height - (isMobile ? 140 : 110);
    ctx.font = `${isMobile ? 22 : 14}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    gameState.messagesQueue.forEach((m,i) => {
      const a = Math.min(1, m.timer/0.35, (2.3 - m.timer)/0.35);
      ctx.globalAlpha = a;
      ctx.fillStyle =
        m.type === 'danger' ? '#ff5555' :
        m.type === 'success' ? '#7CFC00' : '#4fc3f7';
      ctx.fillText(m.text, gameState.width/2, baseY - i*(isMobile?30:20));
    });
    ctx.globalAlpha = 1;
  }
  function showOverlay(title, body) {
    msgTitle.textContent = title;
    msgBody.innerHTML = body;
    overlay.classList.remove('hidden');
  }
  function hideOverlay() { overlay.classList.add('hidden'); }
  btnCloseOverlay.addEventListener('click', hideOverlay);
  btnStart2.addEventListener('click', () => { hideOverlay(); startGame(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) hideOverlay(); });

  // Input
  document.addEventListener('keydown', (e) => {
    gameState.keys[e.key.toLowerCase()] = true;
    if (e.code === 'Space') {
      if (!gameState.running) startGame();
      else if (gameState.ball.sticky && !gameState.paused) releaseBall();
    }
    if (e.key === 'p') togglePause();
  });
  document.addEventListener('keyup', (e) => { gameState.keys[e.key.toLowerCase()] = false; });

  canvas.addEventListener('pointerdown', (e) => {
    gameState.pointer.active = true;
    updatePointer(e);
    if (!gameState.running) startGame();
    else if (gameState.ball.sticky) releaseBall();
  }, { passive: true });
  canvas.addEventListener('pointermove', (e) => {
    if (!gameState.pointer.active && !isMobile) return;
    updatePointer(e);
  }, { passive: true });
  canvas.addEventListener('pointerup', () => gameState.pointer.active = false);
  canvas.addEventListener('pointercancel', () => gameState.pointer.active = false);

  function updatePointer(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left); // 논리 좌표 (이미 CSS px)
    gameState.pointer.targetX = x;
  }

  btnStart.addEventListener('click', () => {
    if (!gameState.running) startGame(); else { resetGame(); startGame(); }
  });
  btnPause.addEventListener('click', togglePause);
  btnMode.addEventListener('click', () => {
    controlMode = controlMode === 'drag' ? 'follow' : 'drag';
    btnMode.textContent = '모드:' + (controlMode === 'drag' ? 'Drag' : 'Follow');
    enqueueMessage(`컨트롤 ${controlMode}`, 'info');
  });

  function togglePause() {
    if (!gameState.running) return;
    gameState.paused = !gameState.paused;
    enqueueMessage(gameState.paused ? '일시정지' : '재개', 'info');
    if (!gameState.paused) {
      gameState.lastTime = performance.now();
      requestAnimationFrame(loop);
    }
  }
  function releaseBall() {
    gameState.ball.sticky = false;
    enqueueMessage('발사!', 'success');
  }

  // Init / Reset
  function resetGame() {
    gameState.score = 0;
    gameState.level = 1;
    gameState.lives = CONFIG.lives;
    scoreEl.textContent = 0;
    levelEl.textContent = 1;
    livesEl.textContent = CONFIG.lives;
    gameState.bricks = buildBricks();
    gameState.paddle = createPaddle();
    gameState.ball = createBall();
    gameState.powerups = [];
    gameState.messagesQueue = [];
    gameState.freezeTime = 0;
  }
  function startGame() {
    hideOverlay();
    if (!gameState.paddle) resetGame();
    gameState.running = true;
    gameState.paused = false;
    gameState.lastTime = performance.now();
    enqueueMessage('게임 시작', 'success');
    requestAnimationFrame(loop);
  }

  // Update
  function update(dt) {
    if (gameState.freezeTime > 0) {
      gameState.freezeTime -= dt;
      return;
    }
    updateTimedEffects(dt);

    const paddle = gameState.paddle;
    const ball = gameState.ball;

    // 데스크탑 키 이동
    if (!isMobile) {
      if (gameState.keys['arrowleft'] || gameState.keys['a']) paddle.x -= paddle.speed * dt;
      if (gameState.keys['arrowright'] || gameState.keys['d']) paddle.x += paddle.speed * dt;
    }

    // Pointer 보간
    if (gameState.pointer.targetX != null) {
      let target = gameState.pointer.targetX;
      if (controlMode === 'follow') {
        target -= paddle.w / 2;
        paddle.x += (target - paddle.x) * gameState.pointer.smoothingFactor;
      } else {
        paddle.x += ((target - paddle.w / 2) - paddle.x) * gameState.pointer.smoothingFactor;
      }
    }
    paddle.x = clamp(paddle.x, 0, gameState.width - paddle.w);

    if (ball.sticky) {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - ball.r - 1;
    } else {
      ball.x += ball.dx * dt;
      ball.y += ball.dy * dt;

      // 벽
      if (ball.x - ball.r < 0) { ball.x = ball.r; ball.dx = Math.abs(ball.dx); SFX.play('bounce'); }
      if (ball.x + ball.r > gameState.width) { ball.x = gameState.width - ball.r; ball.dx = -Math.abs(ball.dx); SFX.play('bounce'); }
      if (ball.y - ball.r < 0) { ball.y = ball.r; ball.dy = Math.abs(ball.dy); SFX.play('bounce'); }

      // 패들
      if (ball.y + ball.r >= paddle.y &&
          ball.y - ball.r <= paddle.y + paddle.h &&
          ball.x >= paddle.x &&
          ball.x <= paddle.x + paddle.w &&
          ball.dy > 0) {
        const hitPos = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        const maxAngle = 75 * Math.PI / 180;
        const angle = hitPos * maxAngle;
        const speed = Math.min(CONFIG.ball.maxSpeed,
          Math.sqrt(ball.dx*ball.dx + ball.dy*ball.dy) * 1.03);
        ball.dx = speed * Math.sin(angle);
        ball.dy = -Math.abs(speed * Math.cos(angle));
        ball.speed = speed;
        ball.y = paddle.y - ball.r - 0.5;
        SFX.play('bounce');
      }

      // 바닥
      if (ball.y - ball.r > gameState.height) loseLife();
    }

    // 벽돌
    let bricksLeft = 0;
    for (const b of gameState.bricks) {
      if (!b.alive) continue;
      bricksLeft++;
      const nx = clamp(ball.x, b.x, b.x + b.w);
      const ny = clamp(ball.y, b.y, b.y + b.h);
      const dx = ball.x - nx;
      const dy = ball.y - ny;
      if (dx*dx + dy*dy <= ball.r*ball.r) {
        const overlapX = Math.min(Math.abs(ball.x - b.x), Math.abs(ball.x - (b.x + b.w)));
        const overlapY = Math.min(Math.abs(ball.y - b.y), Math.abs(ball.y - (b.y + b.h)));
        if (overlapX < overlapY) {
          ball.dx = (ball.x < b.x + b.w/2) ? -Math.abs(ball.dx) : Math.abs(ball.dx);
        } else {
          ball.dy = (ball.y < b.y + b.h/2) ? -Math.abs(ball.dy) : Math.abs(ball.dy);
        }
        b.hp--;
        addScore(10);
        SFX.play('brick');
        if (b.hp <= 0) {
          b.alive = false;
          addScore(40);
          spawnPowerup(b.x + b.w/2, b.y + b.h/2);
        }
        break;
      }
    }
    if (bricksLeft === 0) nextLevel();

    // 파워업
    for (const pu of gameState.powerups) {
      pu.y += pu.vy * dt;
      if (pu.y + pu.r >= paddle.y &&
          pu.y - pu.r <= paddle.y + paddle.h &&
          pu.x >= paddle.x &&
          pu.x <= paddle.x + paddle.w) {
        applyPowerup(pu);
        pu.collected = true;
      }
      if (pu.y - pu.r > gameState.height) pu.collected = true;
    }
    gameState.powerups = gameState.powerups.filter(p => !p.collected);
  }

  // Draw
  function draw() {
    ctx.clearRect(0, 0, gameState.width, gameState.height);
    if (CONFIG.visuals.grid) {
      ctx.save();
      ctx.globalAlpha = isMobile ? 0.04 : 0.07;
      ctx.strokeStyle = '#ffffff';
      const g = CONFIG.visuals.gridGap;
      for (let x=0; x<=gameState.width; x+=g) {
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,gameState.height); ctx.stroke();
      }
      for (let y=0; y<=gameState.height; y+=g) {
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(gameState.width,y); ctx.stroke();
      }
      ctx.restore();
    }
    drawBricks();
    drawPaddle();
    drawBall();
    drawPowerups();
    drawHUDInline();
    drawMessages();

    if (gameState.paused) {
      ctx.fillStyle = '#ffffffdd';
      ctx.font = `${isMobile ? 80 : 46}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', gameState.width/2, gameState.height/2);
    }
  }
  function drawPaddle() {
    const p = gameState.paddle;
    ctx.save();
    const grd = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    grd.addColorStop(0, '#4fc3f7'); grd.addColorStop(1, '#015f92');
    ctx.fillStyle = grd;
    roundRect(ctx, p.x, p.y, p.w, p.h, 8);
    ctx.fill();
    let offset = p.x;
    for (const k in p.effectTimers) {
      const t = p.effectTimers[k];
      const ratio = clamp(t / 12, 0, 1);
      ctx.fillStyle =
        k === 'slow' ? '#b388ff' :
        k === 'expand' ? '#4fc3f7' :
        k === 'shrink' ? '#ff8c00' : '#fff';
      ctx.globalAlpha = 0.3 + 0.7 * ratio;
      ctx.fillRect(offset, p.y - (isMobile ? 10 : 6), (p.w / 4), isMobile ? 6 : 4);
      offset += (p.w / 4) + 4;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  function drawBall() {
    const b = gameState.ball;
    ctx.save();
    const grd = ctx.createRadialGradient(b.x - b.r/3, b.y - b.r/3, 2, b.x, b.y, b.r);
    grd.addColorStop(0,'#fff'); grd.addColorStop(1,'#ff9800');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill();
    if (b.sticky) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#fffddd';
      ctx.setLineDash([6,6]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }
  function drawBricks() {
    for (const b of gameState.bricks) {
      if (!b.alive) continue;
      const hpRatio = b.hp / b.maxHp;
      const hue = 40 + 200 * hpRatio;
      ctx.fillStyle = `hsl(${hue},70%,50%)`;
      roundRect(ctx, b.x, b.y, b.w, b.h, 6);
      ctx.fill();
      ctx.fillStyle = '#0005';
      ctx.fillRect(b.x, b.y + b.h - 6, b.w, 6);
      ctx.fillStyle = '#ffffffcc';
      ctx.fillRect(b.x, b.y + b.h - 6, b.w * hpRatio, 6);
    }
  }
  function drawPowerups() {
    for (const pu of gameState.powerups) {
      ctx.save();
      ctx.fillStyle = pu.color;
      ctx.beginPath(); ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = `${isMobile ? 18 : 11}px system-ui`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(pu.label.slice(0,2), pu.x, pu.y);
      ctx.restore();
    }
  }
  function drawHUDInline() {
    ctx.save();
    ctx.font = `${isMobile ? 34 : 16}px system-ui`;
    ctx.fillStyle = '#ffffffd0';
    ctx.textAlign='left';
    ctx.fillText(`Score: ${gameState.score}`,16,isMobile?40:24);
    ctx.fillText(`Level: ${gameState.level}`,16,isMobile?80:46);
    ctx.textAlign='right';
    ctx.fillText(`Lives: ${gameState.lives}`, gameState.width-16, isMobile?40:24);
    ctx.restore();
  }

  function loop(now) {
    if (!gameState.running) return;
    const dt = Math.min(0.05, (now - gameState.lastTime)/1000);
    gameState.lastTime = now;
    if (!gameState.paused) {
      update(dt);
      updateMessages(dt);
      draw();
    }
    requestAnimationFrame(loop);
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x,y,w,h,r); return; }
    r = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);
    ctx.quadraticCurveTo(x,y,x+r,y);
  }

  // 초기 Overlay
  showOverlay('Brick Breaker', `
    디바이스: ${isMobile ? '모바일' : '데스크탑'} 감지됨.<br>
    레티나/고해상도 스케일 정상화 완료.<br>
    ${isMobile ? '드래그로 패들, 탭으로 발사.' : '마우스 이동 또는 ← →, Space 발사.'}
  `);

  // 초기 사이즈 적용
  resizeCanvas();

})();