// Brick Breaker Game
// Author: Example
// 구조: Game Loop + State 관리 + 엔티티(공, 패들, 벽돌, 파워업)

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // UI elements
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const livesEl = document.getElementById('lives');
  const overlay = document.getElementById('overlay');
  const msgTitle = document.getElementById('messageTitle');
  const msgBody = document.getElementById('messageBody');
  const btnCloseOverlay = document.getElementById('btnCloseOverlay');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnMute = document.getElementById('btnMute');

  // Config
  const CONFIG = {
    paddle: {
      width: 120,
      height: 18,
      speed: 520,
      minWidth: 60,
      maxWidth: 280
    },
    ball: {
      radius: 9,
      speed: 320,
      speedIncrementPerLevel: 25,
      maxSpeed: 880
    },
    bricks: {
      rowsStart: 5,
      cols: 10,
      gap: 6,
      topOffset: 70,
      sideMargin: 40,
      height: 28,
      baseWidth: () => {
        const playableWidth = canvas.width - 2 * CONFIG.bricks.sideMargin;
        return Math.floor((playableWidth - (CONFIG.bricks.cols - 1) * CONFIG.bricks.gap) / CONFIG.bricks.cols);
      },
      hpBase: 1
    },
    powerups: {
      dropChance: 0.18,
      fallSpeed: 150,
      radius: 12,
      effects: [
        { type: 'expand', label: '확장', color: '#4fc3f7', duration: 12 },
        { type: 'shrink', label: '축소', color: '#ff8c00', duration: 12 },
        { type: 'slow', label: '슬로우', color: '#b388ff', duration: 8 },
        { type: 'score', label: '+점수', color: '#ffd54f', value: 150 },
        { type: 'life', label: '목숨+', color: '#81c784' }
      ]
    },
    lives: 3,
    sounds: true
  };

  // Game state
  let gameState = {
    running: false,
    paused: false,
    score: 0,
    level: 1,
    lives: CONFIG.lives,
    bricks: [],
    paddle: null,
    ball: null,
    keys: {},
    powerups: [],
    lastTime: 0,
    width: canvas.width,
    height: canvas.height,
    messagesQueue: [],
    freezeTime: 0
  };

  // Sound Manager
  const SFX = {
    enabled: CONFIG.sounds,
    sounds: {
      bounce: makeBeep(220, 0.04),
      brick: makeBeep(440, 0.05),
      lose: makeBeep(140, 0.5),
      power: makeBeep(660, 0.15),
      life: makeBeep(880, 0.2),
      level: makeBeep(520, 0.3)
    },
    play(name) {
      if (!this.enabled) return;
      const s = this.sounds[name];
      if (s) s();
    },
    toggle() {
      this.enabled = !this.enabled;
      btnMute.textContent = this.enabled ? '음소거' : '소리켜기';
    }
  };

  btnMute.addEventListener('click', () => SFX.toggle());

  function makeBeep(freq, duration) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let audioCtx;
    try { audioCtx = new AudioCtx(); } catch { return () => {}; }
    return () => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    };
  }

  // Utility
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Entity creation
  function createPaddle() {
    return {
      x: (gameState.width - CONFIG.paddle.width) / 2,
      y: gameState.height - 50,
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
      x: gameState.width / 2,
      y: gameState.height - 70,
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
    const effect = rand(CONFIG.powerups.effects);
    gameState.powerups.push({
      x, y,
      r: CONFIG.powerups.radius,
      vy: CONFIG.powerups.fallSpeed,
      type: effect.type,
      label: effect.label,
      color: effect.color,
      duration: effect.duration || 0,
      value: effect.value
    });
  }

  // Effects
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
        gameState.ball.dx *= 0.7;
        gameState.ball.dy *= 0.7;
        gameState.ball.speed *= 0.7;
        setTimedEffect('slow', pu.duration);
        break;
      case 'score':
        addScore(pu.value || 100);
        break;
      case 'life':
        gameState.lives++;
        livesEl.textContent = gameState.lives;
        SFX.play('life');
        enqueueMessage('목숨 추가!', 'success');
        break;
    }
    if (['expand', 'shrink', 'slow'].includes(pu.type)) {
      SFX.play('power');
      enqueueMessage(pu.label + ' 파워업!', 'info');
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
        if (k === 'slow') {
          normalizeBallSpeed();
        } else if (k === 'expand' || k === 'shrink') {
          gameState.paddle.w = clamp(CONFIG.paddle.width, CONFIG.paddle.minWidth, CONFIG.paddle.maxWidth);
        }
      }
    }
  }

  function normalizeBallSpeed() {
    const b = gameState.ball;
    const speedTarget = CONFIG.ball.speed + (gameState.level - 1) * CONFIG.ball.speedIncrementPerLevel;
    const currentSpeed = Math.sqrt(b.dx * b.dx + b.dy * b.dy);
    const scale = speedTarget / currentSpeed;
    b.dx *= scale;
    b.dy *= scale;
    b.speed = speedTarget;
  }

  // Score / Lives / Level
  function addScore(val) {
    gameState.score += val;
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
      gameState.ball.sticky = true;
      enqueueMessage('목숨 감소! 남은 목숨: ' + gameState.lives, 'danger');
    }
  }

  function nextLevel() {
    gameState.level++;
    levelEl.textContent = gameState.level;
    enqueueMessage('레벨 ' + gameState.level + ' 시작!', 'info');
    SFX.play('level');
    gameState.bricks = buildBricks();
    gameState.ball = createBall();
    gameState.ball.sticky = true;
    gameState.powerups.length = 0;
    gameState.freezeTime = 1.2;
  }

  function endGame(win) {
    gameState.running = false;
    showOverlay(win ? '승리!' : '게임 오버', '최종 점수: ' + gameState.score + '<br>다시 시작하려면 시작 버튼 또는 Space.');
  }

  // Overlay & Messaging
  function showOverlay(title, body) {
    msgTitle.textContent = title;
    msgBody.innerHTML = body;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  btnCloseOverlay.addEventListener('click', hideOverlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideOverlay();
  });

  function enqueueMessage(text, type = 'info') {
    gameState.messagesQueue.push({ text, timer: 2.6, type });
  }

  function drawMessages(dt) {
    const baseY = gameState.height - 110;
    gameState.messagesQueue = gameState.messagesQueue.filter(m => {
      m.timer -= dt;
      return m.timer > 0;
    });
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    gameState.messagesQueue.forEach((m, i) => {
      const alpha = Math.min(1, m.timer / 0.4, (2.6 - m.timer) / 0.4);
      ctx.globalAlpha = alpha;
      const color = m.type === 'danger' ? '#ff5555'
                    : m.type === 'success' ? '#7CFC00'
                    : '#4fc3f7';
      ctx.fillStyle = color;
      ctx.fillText(m.text, gameState.width / 2, baseY - i * 20);
      ctx.globalAlpha = 1;
    });
  }

  // Input
  document.addEventListener('keydown', (e) => {
    gameState.keys[e.key.toLowerCase()] = true;
    if (e.key === ' ' || e.code === 'Space') {
      if (!gameState.running) startGame();
      else if (gameState.ball.sticky && !gameState.paused) releaseBall();
    }
    if (e.key === 'p' || e.key === 'P') togglePause();
  });
  document.addEventListener('keyup', (e) => {
    gameState.keys[e.key.toLowerCase()] = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!gameState.running) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scaleX;
    gameState.paddle.x = clamp(x - gameState.paddle.w / 2, 0, gameState.width - gameState.paddle.w);
    if (gameState.ball.sticky) {
      gameState.ball.x = gameState.paddle.x + gameState.paddle.w / 2;
    }
  });

  canvas.addEventListener('click', () => {
    if (!gameState.running) {
      startGame();
    } else if (gameState.ball.sticky && !gameState.paused) {
      releaseBall();
    }
  });

  canvas.addEventListener('touchstart', handleTouch, { passive: false });
  canvas.addEventListener('touchmove', handleTouch, { passive: false });
  function handleTouch(e) {
    e.preventDefault();
    if (!gameState.running) startGame();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    for (let touch of e.touches) {
      const x = (touch.clientX - rect.left) * scaleX;
      if (x < gameState.width / 2) {
        gameState.keys['arrowleft'] = true;
        gameState.keys['arrowright'] = false;
      } else {
        gameState.keys['arrowright'] = true;
        gameState.keys['arrowleft'] = false;
      }
      if (gameState.ball.sticky && !gameState.paused) releaseBall();
    }
  }
  canvas.addEventListener('touchend', () => {
    gameState.keys['arrowleft'] = false;
    gameState.keys['arrowright'] = false;
  });

  btnStart.addEventListener('click', () => {
    if (!gameState.running) startGame();
    else {
      resetGame();
      startGame();
    }
  });
  btnPause.addEventListener('click', togglePause);

  function togglePause() {
    if (!gameState.running) return;
    gameState.paused = !gameState.paused;
    if (gameState.paused) {
      enqueueMessage('일시정지', 'info');
    } else {
      enqueueMessage('재개', 'info');
      gameState.lastTime = performance.now();
      requestAnimationFrame(loop);
    }
  }

  function releaseBall() {
    gameState.ball.sticky = false;
    enqueueMessage('발사!', 'success');
  }

  // Game start/reset
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
    enqueueMessage('게임 시작!', 'success');
    requestAnimationFrame(loop);
  }

  // Physics & update
  function update(dt) {
    if (gameState.freezeTime > 0) {
      gameState.freezeTime -= dt;
      return;
    }
    updateTimedEffects(dt);
    const paddle = gameState.paddle;
    const ball = gameState.ball;

    if (gameState.keys['arrowleft'] || gameState.keys['a']) {
      paddle.x -= paddle.speed * dt;
    }
    if (gameState.keys['arrowright'] || gameState.keys['d']) {
      paddle.x += paddle.speed * dt;
    }
    paddle.x = clamp(paddle.x, 0, gameState.width - paddle.w);
    if (ball.sticky) {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - ball.r - 1;
    } else {
      ball.x += ball.dx * dt;
      ball.y += ball.dy * dt;
      if (ball.x - ball.r < 0) {
        ball.x = ball.r;
        ball.dx = Math.abs(ball.dx);
        SFX.play('bounce');
      } else if (ball.x + ball.r > gameState.width) {
        ball.x = gameState.width - ball.r;
        ball.dx = -Math.abs(ball.dx);
        SFX.play('bounce');
      }
      if (ball.y - ball.r < 0) {
        ball.y = ball.r;
        ball.dy = Math.abs(ball.dy);
        SFX.play('bounce');
      }

      if (ball.y + ball.r >= paddle.y &&
          ball.y - ball.r <= paddle.y + paddle.h &&
          ball.x >= paddle.x &&
          ball.x <= paddle.x + paddle.w &&
          ball.dy > 0) {
        const hitPos = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        const maxBounceAngle = 75 * Math.PI / 180;
        const bounceAngle = hitPos * maxBounceAngle;
        const speed = Math.min(CONFIG.ball.maxSpeed,
          Math.sqrt(ball.dx * ball.dx + ball.dy * ball.dy) * 1.03);
        ball.dx = speed * Math.sin(bounceAngle);
        ball.dy = -Math.abs(speed * Math.cos(bounceAngle));
        ball.speed = speed;
        ball.y = paddle.y - ball.r - 0.5;
        SFX.play('bounce');
      }

      if (ball.y - ball.r > gameState.height) {
        loseLife();
      }
    }

    let bricksLeft = 0;
    for (const b of gameState.bricks) {
      if (!b.alive) continue;
      bricksLeft++;
      const nearestX = clamp(ball.x, b.x, b.x + b.w);
      const nearestY = clamp(ball.y, b.y, b.y + b.h);
      const dx = ball.x - nearestX;
      const dy = ball.y - nearestY;
      if (dx * dx + dy * dy <= ball.r * ball.r) {
        const overlapX = Math.min(Math.abs(ball.x - (b.x)), Math.abs(ball.x - (b.x + b.w)));
        const overlapY = Math.min(Math.abs(ball.y - (b.y)), Math.abs(ball.y - (b.y + b.h)));
        if (overlapX < overlapY) {
          ball.dx = (ball.x < b.x + b.w / 2) ? -Math.abs(ball.dx) : Math.abs(ball.dx);
        } else {
          ball.dy = (ball.y < b.y + b.h / 2) ? -Math.abs(ball.dy) : Math.abs(ball.dy);
        }

        b.hp--;
        addScore(10);
        SFX.play('brick');
        if (b.hp <= 0) {
          b.alive = false;
          addScore(40);
          spawnPowerup(b.x + b.w / 2, b.y + b.h / 2);
        }
        break;
      }
    }

    if (bricksLeft === 0) {
      nextLevel();
    }

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

    ctx.save();
    ctx.globalAlpha = 0.07;
    const gridSize = 40;
    ctx.strokeStyle = '#ffffff';
    for (let x = 0; x <= gameState.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gameState.height);
      ctx.stroke();
    }
    for (let y = 0; y <= gameState.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gameState.width, y);
      ctx.stroke();
    }
    ctx.restore();

    drawBricks();
    drawPaddle();
    drawBall();
    drawPowerups();
    drawHUDInline();
    drawMessages(0);

    if (gameState.paused) {
      ctx.fillStyle = '#ffffffcc';
      ctx.font = 'bold 40px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', gameState.width / 2, gameState.height / 2);
    }
  }

  function drawPaddle() {
    const p = gameState.paddle;
    ctx.save();
    const gradient = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    gradient.addColorStop(0, '#4fc3f7');
    gradient.addColorStop(1, '#0277bd');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, p.w, p.h, 8);
    ctx.fill();

    let offsetX = p.x;
    for (const k in p.effectTimers) {
      const t = p.effectTimers[k];
      const ratio = clamp(t / 12, 0, 1);
      ctx.fillStyle = k === 'slow' ? '#b388ff'
                     : k === 'expand' ? '#4fc3f7'
                     : k === 'shrink' ? '#ff8c00'
                     : '#fff';
      ctx.globalAlpha = 0.3 + 0.7 * ratio;
      ctx.fillRect(offsetX, p.y - 6, (p.w / 4), 4);
      offsetX += (p.w / 4) + 4;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawBall() {
    const b = gameState.ball;
    ctx.save();
    const gradient = ctx.createRadialGradient(b.x - b.r / 3, b.y - b.r / 3, 2, b.x, b.y, b.r);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(1, '#ff9800');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();

    if (b.sticky) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#fffddd';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBricks() {
    for (const b of gameState.bricks) {
      if (!b.alive) continue;
      const hpRatio = b.hp / b.maxHp;
      const hue = 40 + 200 * hpRatio;
      ctx.fillStyle = `hsl(${hue},70%,50%)`;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 6);
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
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pu.label.slice(0, 2), pu.x, pu.y);
      ctx.restore();
    }
  }

  function drawHUDInline() {
    ctx.save();
    ctx.font = 'bold 16px system-ui';
    ctx.fillStyle = '#ffffffcc';
    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${gameState.score}`, 16, 24);
    ctx.fillText(`Level: ${gameState.level}`, 16, 46);
    ctx.textAlign = 'right';
    ctx.fillText(`Lives: ${gameState.lives}`, gameState.width - 16, 24);
    ctx.restore();
  }

  function loop(now) {
    if (!gameState.running) return;
    const dt = Math.min(0.045, (now - gameState.lastTime) / 1000);
    gameState.lastTime = now;
    if (!gameState.paused) {
      update(dt);
      draw();
      updateMessages(dt);
    }
    requestAnimationFrame(loop);
  }

  function updateMessages(dt) {
    gameState.messagesQueue.forEach(m => m.timer -= dt);
    gameState.messagesQueue = gameState.messagesQueue.filter(m => m.timer > 0);
  }

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const radius = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : r;
      this.beginPath();
      this.moveTo(x + radius.tl, y);
      this.lineTo(x + w - radius.tr, y);
      this.quadraticCurveTo(x + w, y, x + w, y + radius.tr);
      this.lineTo(x + w, y + h - radius.br);
      this.quadraticCurveTo(x + w, y + h, x + w - radius.br, y + h);
      this.lineTo(x + radius.bl, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - radius.bl);
      this.lineTo(x, y + radius.tl);
      this.quadraticCurveTo(x, y, x + radius.tl, y);
      this.closePath();
      return this;
    };
  }

  showOverlay('Brick Breaker', 'Space 또는 Canvas 클릭으로 시작하세요.<br>← → 또는 마우스/터치로 패들을 움직입니다.<br>파워업을 잡아 보세요!');
})();