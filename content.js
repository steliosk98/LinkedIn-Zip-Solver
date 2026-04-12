const SOLVE_DELAY_MS = 12;
const SOLVE_SETTLE_MS = 24;
const VALID_MOVES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SOLVE_PATH") {
    return undefined;
  }

  solvePath(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        status: "error",
        message: error?.message || "The solve flow failed.",
      });
    });

  return true;
});

async function solvePath(payload) {
  const moves = payload?.moves;

  if (!Array.isArray(moves) || moves.length === 0 || moves.some((move) => !VALID_MOVES.has(move))) {
    return {
      status: "error",
      message: "The locked path is empty or invalid.",
    };
  }

  const target = findGameTarget();
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
      message: "The game could not be focused. Click inside the puzzle and try again.",
    };
  }

  const beforeSignal = captureAcceptanceSignal();
  window.dispatchEvent(new CustomEvent("zip-solver-run", {
    detail: {
      moves,
      gridSize: payload?.gridSize,
      startPoint: payload?.startPoint,
    },
  }));
  for (const move of moves) {
    dispatchArrow(target, move);
    await delay(SOLVE_DELAY_MS);
  }
  await delay(SOLVE_SETTLE_MS);
  const afterSignal = captureAcceptanceSignal();

  if (signalsMatch(beforeSignal, afterSignal)) {
    return {
      status: "unsupported",
      message: "The page did not show any response to scripted arrow keys. This site may block synthetic input here.",
    };
  }

  return {
    status: "success",
    message: `Replayed ${moves.length} moves on the current page.`,
  };
}

function findGameTarget() {
  const selectors = [
    "[data-zip-solver-target='true']",
    "[role='application']",
    "[role='grid']",
    "[tabindex='0']",
    "main",
    "body",
  ];

  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    const candidate = nodes.find((node) => isVisible(node));
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function isVisible(node) {
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function dispatchArrow(target, key) {
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

  target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
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

function captureAcceptanceSignal() {
  return {
    activeTag: document.activeElement?.tagName || "",
    title: document.title,
    bodyText: document.body?.innerText?.slice(0, 1200) || "",
    focusSignature: focusableSignature(),
  };
}

function focusableSignature() {
  return Array.from(document.querySelectorAll("[aria-label], [data-test-id], [class]"))
    .slice(0, 25)
    .map((node) => {
      const label = node.getAttribute("aria-label") || "";
      const testId = node.getAttribute("data-test-id") || "";
      const className = typeof node.className === "string" ? node.className : "";
      return `${node.tagName}:${label}:${testId}:${className}`;
    })
    .join("|");
}

function signalsMatch(beforeSignal, afterSignal) {
  return JSON.stringify(beforeSignal) === JSON.stringify(afterSignal);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
