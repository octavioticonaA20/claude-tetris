'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

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

const SCORES_KEY = 'tetris:scores';
const MAX_SCORES = 5;

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
const overlaySummary = document.getElementById('overlay-summary');
const overlayLeaderboard = document.getElementById('overlay-leaderboard');
const saveScoreForm = document.getElementById('save-score-form');
const playerNameInput = document.getElementById('player-name');
const saveScoreBtn = document.getElementById('save-score-btn');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const resetScoresBtn = document.getElementById('reset-scores-btn');

let board, current, next, score, lines, level, combo, maxCombo, maxLinesAtOnce, started, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let scoresCache = null;
let pendingEntry = null;

// ---- Tabla de récords (localStorage, con fallback en memoria) ----

function loadScores() {
  if (scoresCache !== null) return scoresCache;
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    scoresCache = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    scoresCache = [];
  }
  return scoresCache;
}

function persistScores(scores) {
  scoresCache = scores;
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
  } catch (e) {
    // localStorage no disponible (file://, navegación privada, etc.):
    // scoresCache sigue sirviendo como fallback en memoria.
  }
}

function addScore(entry) {
  const scores = loadScores().slice();
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  const top = scores.slice(0, MAX_SCORES);
  persistScores(top);
  return top;
}

function clearScores() {
  persistScores([]);
}

function qualifiesForTop(scoreValue) {
  const scores = loadScores();
  if (scores.length < MAX_SCORES) return true;
  return scoreValue > scores[scores.length - 1].score;
}

function renderLeaderboard(highlightEntry) {
  const scores = loadScores();
  overlayLeaderboard.innerHTML = '';

  if (scores.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'leaderboard-empty';
    empty.textContent = 'Sin récords todavía';
    overlayLeaderboard.appendChild(empty);
  } else {
    scores.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = 'leaderboard-row' + (entry === highlightEntry ? ' highlight' : '');

      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = `${i + 1}.`;

      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = entry.name;

      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'lb-score';
      scoreSpan.textContent = entry.score.toLocaleString();

      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(scoreSpan);
      overlayLeaderboard.appendChild(li);
    });
  }

  if (scores.length === 0) {
    overlaySummary.textContent = '';
  } else {
    const bestCombo = scores.reduce((m, e) => Math.max(m, e.maxCombo || 0), 0);
    const bestLines = scores.reduce((m, e) => Math.max(m, e.maxLinesAtOnce || 0), 0);
    overlaySummary.textContent = `Mejor combo: ${bestCombo}  ·  Máx. líneas a la vez: ${bestLines}`;
  }
}

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
  return cleared;
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
  const cleared = clearLines();
  combo = cleared > 0 ? combo + 1 : 0;
  maxCombo = Math.max(maxCombo, combo);
  maxLinesAtOnce = Math.max(maxLinesAtOnce, cleared);
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

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function setOverlayButtons({ leaderboard, summary, saveForm, start, restart, resetScores }) {
  overlayLeaderboard.classList.toggle('hidden', !leaderboard);
  overlaySummary.classList.toggle('hidden', !summary);
  saveScoreForm.classList.toggle('hidden', !saveForm);
  startBtn.classList.toggle('hidden', !start);
  restartBtn.classList.toggle('hidden', !restart);
  resetScoresBtn.classList.toggle('hidden', !resetScores);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);

  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  pendingEntry = { score, lines, maxCombo, maxLinesAtOnce };
  const qualifies = qualifiesForTop(score);

  setOverlayButtons({
    leaderboard: true,
    summary: true,
    saveForm: qualifies,
    start: false,
    restart: true,
    resetScores: false,
  });
  renderLeaderboard(null);

  if (qualifies) {
    playerNameInput.value = '';
    playerNameInput.focus();
  }

  overlay.classList.remove('hidden');
}

function saveScoreEntry() {
  if (!pendingEntry) return;
  const rawName = playerNameInput.value.trim();
  const name = (rawName || 'Jugador').slice(0, 12);
  const entry = {
    name,
    score: pendingEntry.score,
    lines: pendingEntry.lines,
    maxCombo: pendingEntry.maxCombo,
    maxLinesAtOnce: pendingEntry.maxLinesAtOnce,
    date: new Date().toISOString(),
  };
  const top = addScore(entry);
  renderLeaderboard(top.includes(entry) ? entry : null);
  saveScoreForm.classList.add('hidden');
  pendingEntry = null;
}

function showStartScreen() {
  cancelAnimationFrame(animId);
  started = false;
  gameOver = false;
  paused = false;

  overlayTitle.textContent = 'TETRIS';
  overlayScore.textContent = '';

  setOverlayButtons({
    leaderboard: true,
    summary: true,
    saveForm: false,
    start: true,
    restart: false,
    resetScores: true,
  });
  renderLeaderboard(null);
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (!started || gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    setOverlayButtons({
      leaderboard: false,
      summary: false,
      saveForm: false,
      start: false,
      restart: true,
      resetScores: false,
    });
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
  combo = 0;
  maxCombo = 0;
  maxLinesAtOnce = 0;
  started = true;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  pendingEntry = null;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (!started || paused || gameOver) return;
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

startBtn.addEventListener('click', init);
restartBtn.addEventListener('click', init);
saveScoreBtn.addEventListener('click', saveScoreEntry);
playerNameInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Enter') saveScoreEntry();
});
resetScoresBtn.addEventListener('click', () => {
  if (confirm('¿Borrar todos los récords guardados?')) {
    clearScores();
    renderLeaderboard(null);
  }
});

showStartScreen();
