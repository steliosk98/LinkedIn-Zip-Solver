const VALID_MOVES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const state = {
  gridSize: 11,
  startPoint: getDefaultStart(11),
  currentPoint: getDefaultStart(11),
  pathPoints: [getDefaultStart(11)],
  movesSeen: 0,
  startedAt: performance.now(),
  finishedAt: null,
};

const elements = {
  timer: document.getElementById("timer"),
  gridSizeLabel: document.getElementById("gridSizeLabel"),
  movesSeen: document.getElementById("movesSeen"),
  boardStatus: document.getElementById("boardStatus"),
  board: document.getElementById("board"),
  eventLog: document.getElementById("eventLog"),
};

initialize();

function initialize() {
  buildBoard();
  render();
  elements.board.focus();
  window.addEventListener("keydown", handleKeydown, true);
  window.addEventListener("zip-solver-run", handleSolverRun);
  window.setInterval(updateTimer, 100);
  updateTimer();
}

function handleSolverRun(event) {
  const detail = event.detail || {};
  if (!Number.isInteger(detail.gridSize)) {
    return;
  }

  const nextGridSize = clamp(detail.gridSize, 5, 21);
  const nextStart = isValidPoint(detail.startPoint, nextGridSize)
    ? detail.startPoint
    : getDefaultStart(nextGridSize);

  resetBoard(nextGridSize, nextStart);
  elements.boardStatus.textContent = "Replaying";
  elements.eventLog.textContent = `Replay armed at ${formatElapsed(performance.now() - state.startedAt)} with a ${nextGridSize}x${nextGridSize} board.`;
  elements.board.focus();
}

function handleKeydown(event) {
  if (!VALID_MOVES.has(event.key)) {
    return;
  }

  if (state.finishedAt !== null) {
    return;
  }

  const nextPoint = movePoint(state.currentPoint, event.key);
  if (!isValidPoint(nextPoint, state.gridSize)) {
    elements.boardStatus.textContent = "Blocked";
    elements.eventLog.textContent = `Ignored ${event.key} because it would leave the board.`;
    return;
  }

  state.currentPoint = nextPoint;
  state.pathPoints.push(nextPoint);
  state.movesSeen += 1;
  elements.boardStatus.textContent = event.isTrusted ? "Manual" : "Solved";
  elements.eventLog.textContent = `${event.isTrusted ? "Manual" : "Synthetic"} ${event.key} received at ${formatElapsed(performance.now() - state.startedAt)}.`;
  maybeFinishBoard();
  render();
}

function resetBoard(gridSize, startPoint) {
  state.gridSize = gridSize;
  state.startPoint = { ...startPoint };
  state.currentPoint = { ...startPoint };
  state.pathPoints = [{ ...startPoint }];
  state.movesSeen = 0;
  state.finishedAt = null;
  buildBoard();
  render();
}

function buildBoard() {
  elements.board.innerHTML = "";
  elements.board.style.setProperty("--grid-size", String(state.gridSize));

  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      elements.board.appendChild(cell);
    }
  }
}

function render() {
  elements.gridSizeLabel.textContent = `${state.gridSize}x${state.gridSize}`;
  elements.movesSeen.textContent = String(state.movesSeen);

  const visited = new Set(state.pathPoints.map((point) => `${point.x},${point.y}`));
  const endKey = `${state.currentPoint.x},${state.currentPoint.y}`;
  const startKey = `${state.startPoint.x},${state.startPoint.y}`;

  for (const cell of elements.board.children) {
    const key = `${cell.dataset.x},${cell.dataset.y}`;
    cell.className = "cell";

    if (visited.has(key)) {
      cell.classList.add("path");
    }
    if (key === startKey) {
      cell.classList.add("start");
    }
    if (key === endKey) {
      cell.classList.add("end");
    }
  }
}

function updateTimer() {
  const endTime = state.finishedAt ?? performance.now();
  elements.timer.textContent = formatElapsed(endTime - state.startedAt);
}

function formatElapsed(milliseconds) {
  const totalTenths = Math.floor(milliseconds / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function getDefaultStart(gridSize) {
  return {
    x: Math.floor(gridSize / 2),
    y: Math.floor(gridSize / 2),
  };
}

function movePoint(point, move) {
  if (move === "ArrowUp") {
    return { x: point.x, y: point.y - 1 };
  }
  if (move === "ArrowDown") {
    return { x: point.x, y: point.y + 1 };
  }
  if (move === "ArrowLeft") {
    return { x: point.x - 1, y: point.y };
  }
  return { x: point.x + 1, y: point.y };
}

function isValidPoint(point, gridSize) {
  return Number.isInteger(point?.x)
    && Number.isInteger(point?.y)
    && point.x >= 0
    && point.x < gridSize
    && point.y >= 0
    && point.y < gridSize;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function maybeFinishBoard() {
  const visitedCells = new Set(state.pathPoints.map((point) => `${point.x},${point.y}`)).size;
  const totalCells = state.gridSize * state.gridSize;

  if (visitedCells === totalCells) {
    state.finishedAt = performance.now();
    elements.boardStatus.textContent = "Complete";
    elements.eventLog.textContent = `Board filled in ${formatElapsed(state.finishedAt - state.startedAt)}.`;
  }
}
