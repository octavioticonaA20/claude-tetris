'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const THEMES = {
  retro: {
    name: 'Retro',
    board: '#1a1a25',
    grid: '#22222e',
    ghostAlpha: 0.2,
    colors: [
      null,
      '#4dd0e1', // I - cyan
      '#ffd54f', // O - yellow
      '#ba68c8', // T - purple
      '#81c784', // S - green
      '#e57373', // Z - red
      '#7986cb', // J - indigo
      '#ffb74d', // L - orange
    ],
  },
  neon: {
    name: 'Neón',
    board: '#000000',
    grid: '#001414',
    glow: true,
    ghostAlpha: 0.2,
    colors: [
      null,
      '#00fff7', // I - cyan
      '#faff00', // O - yellow
      '#e000ff', // T - purple
      '#00ff66', // S - green
      '#ff003c', // Z - red
      '#3d5cff', // J - indigo
      '#ff9100', // L - orange
    ],
  },
  pastel: {
    name: 'Pastel',
    board: '#f7f3ee',
    grid: '#e3dccf',
    rounded: true,
    ghostAlpha: 0.4,
    colors: [
      null,
      '#a8d8ea', // I - cyan
      '#fff2b2', // O - yellow
      '#d9b8e0', // T - purple
      '#b8e0c4', // S - green
      '#f4b8b8', // Z - red
      '#b8c4e0', // J - indigo
      '#f4d4b8', // L - orange
    ],
  },
  pixel: {
    name: 'Pixel art',
    board: '#101014',
    grid: '#2a2a30',
    pixelPattern: true,
    ghostAlpha: 0.2,
    colors: [
      null,
      '#33e0d9', // I - cyan
      '#f7c948', // O - yellow
      '#c04fd6', // T - purple
      '#5fd66f', // S - green
      '#ff5252', // Z - red
      '#5c6fe0', // J - indigo
      '#ff8a3d', // L - orange
    ],
  },
};

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeSelect = document.getElementById('theme-select');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function loadThemeKey() {
  try {
    const saved = localStorage.getItem('tetris:skin');
    if (saved && THEMES[saved]) return saved;
  } catch (err) {
    // localStorage unavailable (e.g. private mode); fall back to default
  }
  return 'retro';
}

let currentTheme = loadThemeKey();
if (themeSelect) themeSelect.value = currentTheme;
document.body.dataset.skin = currentTheme;
applyCanvasBackground(THEMES[currentTheme]);

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function fillRoundedRect(context, x, y, w, h, r) {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, w, h, r);
  } else {
    // manual arc-based fallback for browsers without ctx.roundRect
    const rr = Math.min(r, w / 2, h / 2);
    context.moveTo(x + rr, y);
    context.lineTo(x + w - rr, y);
    context.arcTo(x + w, y, x + w, y + rr, rr);
    context.lineTo(x + w, y + h - rr);
    context.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    context.lineTo(x + rr, y + h);
    context.arcTo(x, y + h, x, y + h - rr, rr);
    context.lineTo(x, y + rr);
    context.arcTo(x, y, x + rr, y, rr);
    context.closePath();
  }
  context.fill();
}

function drawPixelPattern(context, px, py, s) {
  const cell = Math.max(2, Math.floor(s / 4));
  context.fillStyle = 'rgba(0,0,0,0.18)';
  for (let ry = 0; ry < s; ry += cell) {
    for (let rx = 0; rx < s; rx += cell) {
      if (((rx / cell) + (ry / cell)) % 2 === 0) {
        context.fillRect(px + rx, py + ry, cell, cell);
      }
    }
  }
}

function getActiveTheme() {
  return THEMES[currentTheme] || THEMES.retro;
}

function drawBlock(context, x, y, colorIndex, size, alpha, theme) {
  if (!colorIndex) return;
  theme = theme || getActiveTheme();
  const color = theme.colors[colorIndex];
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;

  context.globalAlpha = alpha ?? 1;

  if (theme.glow) {
    context.shadowBlur = 10;
    context.shadowColor = color;
  }

  context.fillStyle = color;
  if (theme.rounded) {
    fillRoundedRect(context, px, py, s, s, 6);
  } else {
    context.fillRect(px, py, s, s);
  }

  // shadow must not bleed into anything drawn after this block
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';

  if (theme.pixelPattern) {
    drawPixelPattern(context, px, py, s);
  }

  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  if (theme.rounded) {
    fillRoundedRect(context, px, py, s, 4, 2);
  } else {
    context.fillRect(px, py, s, 4);
  }

  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
}

function drawGrid() {
  const theme = getActiveTheme();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  const theme = getActiveTheme();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK, undefined, theme);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, theme.ghostAlpha ?? 0.2, theme);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK, undefined, theme);
}

function drawNext() {
  const theme = getActiveTheme();
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB, undefined, theme);
}

function applyCanvasBackground(theme) {
  canvas.style.background = theme.board;
  nextCanvas.style.background = theme.board;
}

function applyTheme(themeKey) {
  if (!THEMES[themeKey]) themeKey = 'retro';
  currentTheme = themeKey;
  try {
    localStorage.setItem('tetris:skin', themeKey);
  } catch (err) {
    // localStorage unavailable; theme still applies in-memory via currentTheme
  }
  document.body.dataset.skin = themeKey;
  applyCanvasBackground(getActiveTheme());
  // re-render immediately regardless of running/paused/game-over state
  draw();
  drawNext();
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

if (themeSelect) {
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
}

init();
