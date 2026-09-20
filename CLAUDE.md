# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A classic Tetris implementation in vanilla JavaScript, HTML5 Canvas, and CSS. No dependencies, no build process, no package.json — just three files that cooperate directly. The README is in Spanish, so game UI text and issue-triage comments follow suit.

## Running the game

There is no build/lint/test tooling. To run:

```bash
# Open directly
start index.html          # Windows

# Or serve locally (recommended, avoids file:// quirks)
python3 -m http.server 8000
npx serve .
php -S localhost:8000
```

Then open `http://localhost:8000`. To verify changes, open the page in a browser and play — there are no automated tests.

## Architecture

Three files, each with a single responsibility:

- **`index.html`** — DOM structure only: `<canvas id="board">` (300×600, the play field), `<canvas id="next-canvas">` (120×120, next-piece preview), the HUD panel (`#score`/`#lines`/`#level`), and a shared `#overlay` div used for both Pause and Game Over.
- **`style.css`** — dark/retro arcade visual theme (flexbox layout, monospace HUD, `backdrop-filter` on overlays). Purely presentational.
- **`game.js`** — all game logic, in one file, no modules or classes. Everything below refers to this file.

### Core data model

- `board`: a `ROWS × COLS` matrix (20×10); each cell is `0` (empty) or `1–7` (color index of a locked piece).
- `PIECES`: the 7 tetrominoes as square matrices of color indices. `current` and `next` are `{ type, shape, x, y }` objects; `shape` is a fresh copy of a `PIECES` entry so it can be mutated by rotation independent of the template.
- Rotation (`rotateCW`) transposes + reverses rows — there is no separate rotation-state table (no SRS), so wall kicks are approximated in `tryRotate` by trying offsets `[0, -1, 1, -2, 2]` against `collide()` until one doesn't collide.
- `collide(shape, ox, oy)` is the single source of truth for both board-boundary and piece-overlap checks; nearly every movement function (`tryRotate`, `softDrop`, `hardDrop`, `ghostY`, keydown handlers) calls it before mutating position.

### Game loop and timing

- `loop(ts)` runs via `requestAnimationFrame`, accumulating elapsed time in `dropAccum`; when it exceeds `dropInterval` the piece drops one row (or locks if it can't).
- `dropInterval` starts at 1000ms and is recalculated in `clearLines()` as `max(100, 1000 - (level - 1) * 90)` whenever the level changes.
- Pause (`togglePause`) and Game Over (`endGame`) both work by calling `cancelAnimationFrame(animId)` and reusing the same `#overlay` element with different title text — resuming re-seeds `lastTime` and restarts the loop via `requestAnimationFrame(loop)`.
- All module-level game state (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, timing vars) lives in top-level `let` bindings reset by `init()`; there is no encapsulation/class structure.

### Rendering

- `draw()` clears and redraws the whole board every frame: grid lines → locked board cells → ghost piece (`ghostY()` projects `current` straight down via repeated `collide` checks, drawn at `globalAlpha = 0.2`) → the active piece on top.
- `drawNext()` renders `next.shape` centered in a 4×4 cell on the separate preview canvas.
- `drawBlock()` is the shared cell-rendering primitive for both canvases (fill + a lighter top strip for a beveled look).

### Scoring

- Line clears use the classic table `LINE_SCORES = [0, 100, 300, 500, 800]` (indexed by lines cleared at once), multiplied by `level`.
- Hard drop adds 2 points per row dropped; soft drop adds 1 point per row.
- Level increments every 10 total lines cleared (`Math.floor(lines / 10) + 1`).

### Input

All input is a single `keydown` listener that ignores everything except `KeyP` while `paused`/`gameOver` are true, then dispatches on `e.code` (arrows for move/soft-drop, `ArrowUp`/`KeyX` for rotate, `Space` for hard drop, with `preventDefault`). The restart button just calls `init()`.

## Tunable constants (top of `game.js`)

`COLS`, `ROWS`, `BLOCK`, `COLORS`, `LINE_SCORES`, initial `dropInterval`. If `COLS`/`ROWS`/`BLOCK` change, the `#board` canvas `width`/`height` in `index.html` must be updated to match (`COLS × BLOCK`, `ROWS × BLOCK`).

## Issue triage

`.github/workflows/claude-issue-triage.yml` runs Claude on every issue opened/edited to classify it and apply labels from a fixed taxonomy (`bug`/`enhancement`/`question`/`documentation` + `area: *` + optional `priority: *`), posting a short triage comment. It does not analyze source code or propose implementations — that's left for a follow-up session.
