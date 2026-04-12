const STORAGE_KEY = "zipSolverPath";
const VALID_MOVES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const state = {
  moves: [],
  locked: false,
  status: "No path",
  feedback: "",
};

const elements = {
  captureArea: document.getElementById("captureArea"),
  statusBadge: document.getElementById("statusBadge"),
  moveSummary: document.getElementById("moveSummary"),
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
  elements.captureArea.addEventListener("keydown", handleCaptureKeydown);
  elements.captureArea.addEventListener("click", () => elements.captureArea.focus());
  elements.clearButton.addEventListener("click", handleClear);
  elements.lockButton.addEventListener("click", handleLock);
  elements.unlockButton.addEventListener("click", handleUnlock);
  elements.solveButton.addEventListener("click", handleSolve);
}

async function hydrateFromStorage() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const savedPath = stored[STORAGE_KEY];

  if (savedPath && Array.isArray(savedPath.moves)) {
    state.moves = savedPath.moves.filter((move) => VALID_MOVES.has(move));
    state.locked = Boolean(savedPath.locked && state.moves.length);
  }

  if (state.locked) {
    state.status = "Locked";
  } else if (state.moves.length) {
    state.status = "Drawing";
  }
}

function handleCaptureKeydown(event) {
  if (state.locked || !VALID_MOVES.has(event.key)) {
    return;
  }

  event.preventDefault();
  state.moves.push(event.key);
  state.status = "Drawing";
  state.feedback = "";
  render();
}

function handleClear() {
  if (state.locked) {
    return;
  }

  state.moves = [];
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
  setStatus(state.moves.length ? "Drawing" : "No path", "Path unlocked. You can edit it now.");
  render();
}

async function handleSolve() {
  if (!state.locked || !state.moves.length) {
    return;
  }

  setStatus("Solving", "Trying the locked path on the active LinkedIn tab.");
  render();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      throw new Error("Open the LinkedIn ZIP tab and try again.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "SOLVE_PATH",
      moves: state.moves,
    });

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

  if (typeof error?.message === "string" && error.message.includes("Receiving end does not exist")) {
    return "Open a LinkedIn ZIP page before using Solve.";
  }

  return error?.message || "An unknown error occurred while solving.";
}

async function persistState() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      locked: state.locked,
      moves: state.moves,
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

  elements.lockButton.disabled = state.locked || moveCount === 0;
  elements.unlockButton.disabled = !state.locked;
  elements.solveButton.disabled = !state.locked || moveCount === 0;
  elements.clearButton.disabled = state.locked || moveCount === 0;

  elements.captureArea.setAttribute("aria-disabled", String(state.locked));
  elements.captureArea.querySelector(".capture-copy").textContent = state.locked
    ? "Unlock the saved route before recording new moves"
    : "Click here and use your keyboard arrows";

  drawPathPreview(state.moves);
}

function drawPathPreview(moves) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdfa";
  ctx.fillRect(0, 0, width, height);

  const points = [{ x: 0, y: 0 }];
  let current = { x: 0, y: 0 };

  for (const move of moves) {
    current = nextPoint(current, move);
    points.push(current);
  }

  const bounds = getBounds(points);
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const padding = 28;
  const stepX = (width - padding * 2) / spanX;
  const stepY = (height - padding * 2) / spanY;
  const step = Math.max(Math.min(stepX, stepY), 18);
  const offsetX = (width - spanX * step) / 2;
  const offsetY = (height - spanY * step) / 2;

  drawGrid(width, height, padding);

  if (!moves.length) {
    drawPoint(transformPoint({ x: 0, y: 0 }, bounds, step, offsetX, offsetY), 7, "#0f766e");
    return;
  }

  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  points.forEach((point, index) => {
    const transformed = transformPoint(point, bounds, step, offsetX, offsetY);
    if (index === 0) {
      ctx.moveTo(transformed.x, transformed.y);
    } else {
      ctx.lineTo(transformed.x, transformed.y);
    }
  });

  ctx.stroke();
  drawPoint(transformPoint(points[0], bounds, step, offsetX, offsetY), 7, "#115e59");
  drawPoint(transformPoint(points[points.length - 1], bounds, step, offsetX, offsetY), 8, "#c2410c");
}

function drawGrid(width, height, padding) {
  ctx.strokeStyle = "rgba(44, 36, 23, 0.08)";
  ctx.lineWidth = 1;

  for (let x = padding; x <= width - padding; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
  }

  for (let y = padding; y <= height - padding; y += 32) {
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
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

function getBounds(points) {
  return points.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      maxX: Math.max(acc.maxX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxY: Math.max(acc.maxY, point.y),
    }),
    {
      minX: points[0].x,
      maxX: points[0].x,
      minY: points[0].y,
      maxY: points[0].y,
    }
  );
}

function transformPoint(point, bounds, step, offsetX, offsetY) {
  return {
    x: offsetX + (point.x - bounds.minX) * step,
    y: offsetY + (point.y - bounds.minY) * step,
  };
}
