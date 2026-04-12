const STORAGE_KEY = "zipSolverPath";
const VALID_MOVES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const GRID_SIZES = [5, 7, 9, 11];

const state = {
  moves: [],
  locked: false,
  status: "No path",
  feedback: "",
  gridSize: 11,
  startPoint: getDefaultStart(11),
  drawArmed: false,
  isPointerDown: false,
};

const elements = {
  captureArea: document.getElementById("captureArea"),
  statusBadge: document.getElementById("statusBadge"),
  moveSummary: document.getElementById("moveSummary"),
  gridSizeSelect: document.getElementById("gridSizeSelect"),
  canvas: document.getElementById("pathCanvas"),
  clearButton: document.getElementById("clearButton"),
  lockButton: document.getElementById("lockButton"),
  unlockButton: document.getElementById("unlockButton"),
  solveButton: document.getElementById("solveButton"),
  feedback: document.getElementById("feedback"),
};

const ctx = elements.canvas.getContext("2d");

initialize().catch((error) => {
  console.error("Failed to initialize popup:", error);
  setStatus("Error", "The popup could not initialize.");
});

async function initialize() {
  bindEvents();
  await hydrateFromStorage();
  render();
}

function bindEvents() {
  elements.captureArea.addEventListener("click", handleArmDrawing);
  elements.gridSizeSelect.addEventListener("change", handleGridSizeChange);
  elements.clearButton.addEventListener("click", handleClear);
  elements.lockButton.addEventListener("click", handleLock);
  elements.unlockButton.addEventListener("click", handleUnlock);
  elements.solveButton.addEventListener("click", handleSolve);
  elements.canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  elements.canvas.addEventListener("pointermove", handleCanvasPointerMove);
  elements.canvas.addEventListener("pointerup", handleCanvasPointerUp);
  elements.canvas.addEventListener("pointerleave", handleCanvasPointerUp);
}

async function hydrateFromStorage() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const savedPath = stored[STORAGE_KEY];

  if (savedPath && Array.isArray(savedPath.moves)) {
    if (GRID_SIZES.includes(savedPath.gridSize)) {
      state.gridSize = savedPath.gridSize;
    }
    state.moves = savedPath.moves.filter((move) => VALID_MOVES.has(move));
    state.locked = Boolean(savedPath.locked && state.moves.length);
    if (isValidPoint(savedPath.startPoint, state.gridSize)) {
      state.startPoint = savedPath.startPoint;
    } else {
      state.startPoint = getDefaultStart(state.gridSize);
    }
  }

  if (state.locked) {
    state.status = "Locked";
  } else if (state.moves.length) {
    state.status = "Drawing";
  }
}

function handleArmDrawing() {
  if (state.locked) {
    return;
  }

  state.drawArmed = true;
  if (!state.moves.length) {
    state.startPoint = getDefaultStart(state.gridSize);
  }
  setStatus(state.moves.length ? "Drawing" : "No path", "Click a grid cell to set the start, then drag through adjacent cells.");
  render();
}

async function handleGridSizeChange(event) {
  const nextSize = Number(event.target.value);
  if (!GRID_SIZES.includes(nextSize) || nextSize === state.gridSize) {
    render();
    return;
  }

  if (state.locked) {
    elements.gridSizeSelect.value = String(state.gridSize);
    setStatus("Locked", "Unlock and clear the current path before changing the grid size.");
    render();
    return;
  }

  state.gridSize = nextSize;
  state.moves = [];
  state.startPoint = getDefaultStart(nextSize);
  state.drawArmed = false;
  state.isPointerDown = false;
  await persistState();
  setStatus("No path", `Grid size set to ${nextSize}x${nextSize}. Click Path Capture to start drawing.`);
  render();
}

async function handleClear() {
  if (state.locked) {
    return;
  }

  state.moves = [];
  state.startPoint = getDefaultStart(state.gridSize);
  state.drawArmed = false;
  state.isPointerDown = false;
  await persistState();
  setStatus("No path", "");
  render();
}

async function handleLock() {
  if (!state.moves.length || state.locked) {
    return;
  }

  state.locked = true;
  await persistState();
  setStatus("Locked", "Path saved and ready to replay.");
  render();
}

async function handleUnlock() {
  if (!state.locked) {
    return;
  }

  state.locked = false;
  await persistState();
  state.drawArmed = false;
  setStatus(state.moves.length ? "Drawing" : "No path", "Path unlocked. You can edit it now.");
  render();
}

async function handleSolve() {
  if (!state.locked || !state.moves.length) {
    return;
  }

  setStatus("Solving", "Trying the locked path on the active tab.");
  render();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      throw new Error("Open the page you want to test and try again.");
    }

    if (!/^https?:/.test(tab.url || "")) {
      throw new Error("Open a regular website tab before using Solve.");
    }

    const response = await solveOnTab(tab.id);

    if (!response?.status) {
      throw new Error("The page did not respond to the solve request.");
    }

    if (response.status === "success") {
      setStatus("Locked", response.message || "Moves were replayed.");
    } else if (response.status === "unsupported") {
      setStatus("Unsupported", response.message || "The page appears to reject scripted key input.");
    } else {
      setStatus("Error", response.message || "The solve request could not complete.");
    }
  } catch (error) {
    const message = getSolveErrorMessage(error);
    setStatus("Error", message);
  }

  render();
}

function getSolveErrorMessage(error) {
  if (chrome.runtime.lastError?.message) {
    return chrome.runtime.lastError.message;
  }

  if (typeof error?.message === "string" && error.message.includes("executeScript")) {
    return "Reload the extension in chrome://extensions so the new permissions are applied, then refresh the page and try again.";
  }

  if (typeof error?.message === "string" && error.message.includes("Receiving end does not exist")) {
    return "Refresh the page after reloading the extension, then try Solve again.";
  }

  return error?.message || "An unknown error occurred while solving.";
}

async function persistState() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      locked: state.locked,
      moves: state.moves,
      gridSize: state.gridSize,
      startPoint: state.startPoint,
    },
  });
}

function setStatus(status, feedback) {
  state.status = status;
  state.feedback = feedback;
}

function render() {
  const moveCount = state.moves.length;

  elements.statusBadge.textContent = state.status;
  elements.moveSummary.textContent = `${moveCount} move${moveCount === 1 ? "" : "s"} recorded.`;
  elements.feedback.textContent = state.feedback;
  elements.gridSizeSelect.value = String(state.gridSize);

  elements.lockButton.disabled = state.locked || moveCount === 0;
  elements.unlockButton.disabled = !state.locked;
  elements.solveButton.disabled = !state.locked || moveCount === 0;
  elements.clearButton.disabled = state.locked || moveCount === 0;
  elements.gridSizeSelect.disabled = state.locked;

  elements.captureArea.setAttribute("aria-disabled", String(state.locked));
  elements.captureArea.querySelector(".capture-copy").textContent = state.locked
    ? "Unlock the saved route before drawing new moves"
    : state.drawArmed
      ? "Drawing mode armed. Use the grid below."
      : "Click to arm drawing mode for the grid below";

  drawPathPreview();
}

function drawPathPreview() {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const cellSize = width / state.gridSize;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdfa";
  ctx.fillRect(0, 0, width, height);
  drawGrid(width, height, cellSize);

  const points = getGridPoints();
  const transformedPoints = points.map((point) => ({
    x: point.x * cellSize + cellSize / 2,
    y: point.y * cellSize + cellSize / 2,
  }));

  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  transformedPoints.forEach((transformed, index) => {
    if (index === 0) {
      ctx.moveTo(transformed.x, transformed.y);
    } else {
      ctx.lineTo(transformed.x, transformed.y);
    }
  });

  ctx.stroke();
  highlightCell(state.startPoint, cellSize, "rgba(17, 94, 89, 0.16)");
  if (state.drawArmed && !state.locked) {
    outlineCell(state.startPoint, cellSize, "#115e59");
  }
  drawPoint(transformedPoints[0], 7, "#115e59");
  drawPoint(transformedPoints[transformedPoints.length - 1], 8, "#c2410c");
}

function drawGrid(width, height, cellSize) {
  ctx.strokeStyle = "rgba(44, 36, 23, 0.08)";
  ctx.lineWidth = 1;

  for (let x = 0; x <= width; x += cellSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = 0; y <= height; y += cellSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawPoint(point, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function nextPoint(point, move) {
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

function getGridPoints() {
  const points = [{ ...state.startPoint }];
  let current = { ...state.startPoint };

  for (const move of state.moves) {
    current = nextPoint(current, move);
    points.push(current);
  }

  return points;
}

function handleCanvasPointerDown(event) {
  if (state.locked || !state.drawArmed) {
    return;
  }

  const cell = getCellFromEvent(event);
  if (!cell) {
    return;
  }

  elements.canvas.setPointerCapture(event.pointerId);
  state.isPointerDown = true;

  if (!state.moves.length) {
    state.startPoint = cell;
    setStatus("Drawing", "Start point set. Drag through adjacent cells to build the path.");
  } else {
    const currentEnd = getCurrentEndpoint();
    if (!pointsEqual(cell, currentEnd)) {
      state.moves = [];
      state.startPoint = cell;
      setStatus("Drawing", "New start point set. Drag through adjacent cells to build the path.");
    }
  }

  render();
}

function handleCanvasPointerMove(event) {
  if (state.locked || !state.drawArmed || !state.isPointerDown) {
    return;
  }

  const cell = getCellFromEvent(event);
  if (!cell) {
    return;
  }

  const currentEnd = getCurrentEndpoint();
  if (pointsEqual(cell, currentEnd)) {
    return;
  }

  const move = getMoveBetween(currentEnd, cell);
  if (!move) {
    return;
  }

  state.moves.push(move);
  setStatus("Drawing", `Drawing path. ${state.moves.length} move${state.moves.length === 1 ? "" : "s"} recorded.`);
  render();
}

function handleCanvasPointerUp() {
  state.isPointerDown = false;
}

function getCellFromEvent(event) {
  const rect = elements.canvas.getBoundingClientRect();
  const scaleX = elements.canvas.width / rect.width;
  const scaleY = elements.canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const cellX = Math.floor(x / (elements.canvas.width / state.gridSize));
  const cellY = Math.floor(y / (elements.canvas.height / state.gridSize));
  const point = { x: clamp(cellX, 0, state.gridSize - 1), y: clamp(cellY, 0, state.gridSize - 1) };

  return isValidPoint(point, state.gridSize) ? point : null;
}

function getCurrentEndpoint() {
  return state.moves.reduce((point, move) => nextPoint(point, move), { ...state.startPoint });
}

function getMoveBetween(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    return null;
  }
  if (dx === 1) {
    return "ArrowRight";
  }
  if (dx === -1) {
    return "ArrowLeft";
  }
  if (dy === 1) {
    return "ArrowDown";
  }
  return "ArrowUp";
}

function highlightCell(point, cellSize, color) {
  ctx.fillStyle = color;
  ctx.fillRect(point.x * cellSize, point.y * cellSize, cellSize, cellSize);
}

function outlineCell(point, cellSize, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(point.x * cellSize + 1, point.y * cellSize + 1, cellSize - 2, cellSize - 2);
}

function pointsEqual(a, b) {
  return a.x === b.x && a.y === b.y;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getDefaultStart(gridSize) {
  return {
    x: Math.floor(gridSize / 2),
    y: Math.floor(gridSize / 2),
  };
}

function isValidPoint(point, gridSize) {
  return Number.isInteger(point?.x)
    && Number.isInteger(point?.y)
    && point.x >= 0
    && point.x < gridSize
    && point.y >= 0
    && point.y < gridSize;
}

async function solveOnTab(tabId) {
  if (chrome.scripting?.executeScript) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: runSolveOnPage,
      args: [{
        moves: state.moves,
        gridSize: state.gridSize,
        startPoint: state.startPoint,
      }],
    });
    return result?.result;
  }

  return chrome.tabs.sendMessage(tabId, {
    type: "SOLVE_PATH",
    moves: state.moves,
    gridSize: state.gridSize,
    startPoint: state.startPoint,
  });
}

async function runSolveOnPage(payload) {
  const validMoves = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  const solveDelayMs = 12;
  const solveSettleMs = 24;
  const moves = payload?.moves;
  const gridSize = payload?.gridSize;
  const startPoint = payload?.startPoint;

  if (!Array.isArray(moves) || moves.length === 0 || moves.some((move) => !validMoves.has(move))) {
    return {
      status: "error",
      message: "The locked path is empty or invalid.",
    };
  }

  const target = findTarget();
  if (!target) {
    return {
      status: "error",
      message: "A focusable target was not found on this page.",
    };
  }

  target.focus({ preventScroll: true });

  if (document.activeElement !== target) {
    return {
      status: "error",
      message: "The page could not be focused. Click inside the page and try again.",
    };
  }

  const beforeSignal = captureSignal();
  window.dispatchEvent(new CustomEvent("zip-solver-run", {
    detail: {
      moves,
      gridSize,
      startPoint,
    },
  }));
  for (const move of moves) {
    dispatchArrow(target, move);
    await delay(solveDelayMs);
  }
  await delay(solveSettleMs);
  const afterSignal = captureSignal();

  if (JSON.stringify(beforeSignal) === JSON.stringify(afterSignal)) {
    return {
      status: "unsupported",
      message: "The page did not show any response to scripted arrow keys. This site may block synthetic input here.",
    };
  }

  return {
    status: "success",
    message: `Replayed ${moves.length} moves on the current page.`,
  };

  function findTarget() {
    const selectors = [
      ":focus",
      "input",
      "textarea",
      "[contenteditable='true']",
      "[data-zip-solver-target='true']",
      "[role='application']",
      "[role='grid']",
      "[tabindex='0']",
      "main",
      "body",
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const candidate = nodes.find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  function dispatchArrow(targetNode, key) {
    const keyCode = keyToCode(key);
    const eventInit = {
      key,
      code: key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
    };

    targetNode.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    targetNode.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  }

  function keyToCode(key) {
    if (key === "ArrowUp") {
      return 38;
    }
    if (key === "ArrowDown") {
      return 40;
    }
    if (key === "ArrowLeft") {
      return 37;
    }
    return 39;
  }

  function captureSignal() {
    return {
      activeTag: document.activeElement?.tagName || "",
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 1200) || "",
      focusSignature: Array.from(document.querySelectorAll("[aria-label], [data-test-id], [class]"))
        .slice(0, 25)
        .map((node) => {
          const label = node.getAttribute("aria-label") || "";
          const testId = node.getAttribute("data-test-id") || "";
          const className = typeof node.className === "string" ? node.className : "";
          return `${node.tagName}:${label}:${testId}:${className}`;
        })
        .join("|"),
    };
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}
