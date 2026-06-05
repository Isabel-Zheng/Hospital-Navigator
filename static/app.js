let LOCATIONS = [];

const startSearch  = document.getElementById("startSearch");
const startResults = document.getElementById("startResults");
const destSearch   = document.getElementById("destSearch");
const destResults  = document.getElementById("destResults");

const routeBtn  = document.getElementById("routeBtn");
const returnBtn = document.getElementById("returnBtn");
const resetBtn  = document.getElementById("resetBtn");
const stepsEl   = document.getElementById("steps");

const floorSelect = document.getElementById("floorSelect");

const img = document.getElementById("map");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

// App state
let startSelectedId = "front_desk";
let destSelectedId = null;
let currentGoal = null;       // where the last route ended
let lastRouteData = null;     // last /api/route response
let lastDrawnNodes = null;    // nodes drawn on the current floor

// You-are-here pin
const youAreHereImg = new Image();
youAreHereImg.src = "/static/you_are_here_pin.svg";
let youAreHereReady = false;
youAreHereImg.onload = () => {
  youAreHereReady = true;
  if (lastDrawnNodes) drawPath(lastDrawnNodes);
};

// ---------- Canvas sizing + coordinate helpers ----------
function resizeCanvas() {
  const wrap = document.querySelector(".mapWrap");
  const rect = wrap.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
}

window.addEventListener("resize", () => {
  resizeCanvas();
  if (lastDrawnNodes) drawPath(lastDrawnNodes);
});

img.addEventListener("load", () => {
  resizeCanvas();
  if (lastDrawnNodes) drawPath(lastDrawnNodes);
});

function getImageBox() {
  const wrap = document.querySelector(".mapWrap");
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;

  const nW = img.naturalWidth;
  const nH = img.naturalHeight;
  if (!nW || !nH) return { x: 0, y: 0, w: W, h: H };

  // object-fit: contain math
  const scale = Math.min(W / nW, H / nH);
  const w = nW * scale;
  const h = nH * scale;
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  return { x, y, w, h };
}

// ---------- Search helpers ----------
function normalizeText(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matches(loc, q) {
  const nq = normalizeText(q);
  if (!nq) return false;
  if (normalizeText(loc.name).includes(nq)) return true;
  return (loc.tags || []).some(t => normalizeText(t).includes(nq));
}

function isInternalNode(loc) {
  const id = (loc.id || "").toLowerCase();
  return id.includes("jct") || id.includes("wing") || id.includes("core") || id.includes("courtyard");
}

function renderResultsTo(container, list, onPick) {
  container.innerHTML = "";
  if (!list || list.length === 0) {
    container.style.display = "none";
    return;
  }
  container.style.display = "block";

  list.slice(0, 10).forEach(loc => {
    const div = document.createElement("div");
    div.className = "result";
    div.textContent = loc.name;
    div.onclick = () => {
      container.style.display = "none";
      onPick(loc);
    };
    container.appendChild(div);
  });
}

// ---------- Drawing ----------
function drawYouAreHereImage(node) {
  if (!node || !youAreHereReady) return;

  const box = getImageBox();
  const x = box.x + node.x * box.w;
  const y = box.y + node.y * box.h;

  const w = 28;
  const h = 28;

  // pin points at bottom center
  ctx.drawImage(youAreHereImg, x - w / 2, y - h, w, h);
}

function drawPath(pathNodes) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!pathNodes || pathNodes.length < 2) return;

  const box = getImageBox();

  ctx.lineWidth = 6;
  ctx.beginPath();

  pathNodes.forEach((n, i) => {
    const x = box.x + n.x * box.w;
    const y = box.y + n.y * box.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  // start marker
  drawYouAreHereImage(pathNodes[0]);
}

function drawStartMarkerIfOnCurrentFloor() {
  const floor = parseInt(floorSelect.value, 10);
  const startLoc = LOCATIONS.find(l => l.id === startSelectedId);
  if (!startLoc) return;

  // only draw if the start node is on the currently displayed floor
  if (parseInt(startLoc.floor, 10) !== floor) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawYouAreHereImage(startLoc);
}

// ---------- API ----------
async function loadLocations() {
  const res = await fetch("/api/locations");
  LOCATIONS = await res.json();

  // default start display text
  const fd = LOCATIONS.find(l => l.id === "front_desk");
  if (fd) startSearch.value = fd.name;

  resizeCanvas();
  drawStartMarkerIfOnCurrentFloor();
}

async function fetchRoute(start, goal) {
  stepsEl.innerHTML = "";

  const res = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, goal })
  });

  const data = await res.json();
  if (data.error) {
    stepsEl.innerHTML = `<li>${data.error}</li>`;
    lastDrawnNodes = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return null;
  }
  return data;
}

function renderSteps(steps) {
  stepsEl.innerHTML = "";
  steps.forEach(s => {
    const li = document.createElement("li");
    li.textContent = s;
    stepsEl.appendChild(li);
  });
}

function renderRoute(data) {
  renderSteps(data.steps);
  lastRouteData = data;

  const shownFloor = data.destFloor;
  floorSelect.value = String(shownFloor);

  const onImgLoad = () => {
    img.removeEventListener("load", onImgLoad);
    resizeCanvas();

    const floorNodes = data.pathNodes.filter(n => parseInt(n.floor, 10) === shownFloor);
    lastDrawnNodes = floorNodes;
    drawPath(lastDrawnNodes);
  };

  img.addEventListener("load", onImgLoad);
  img.src = "/static/" + data.floorImage;
}

// ---------- Start/Destination search wiring ----------
startSearch.addEventListener("input", () => {
  const q = startSearch.value;
  if (!q) {
    startResults.style.display = "none";
    startResults.innerHTML = "";
    return;
  }

  const filtered = LOCATIONS
    .filter(l => !isInternalNode(l))     // don’t let users pick junctions
    .filter(l => matches(l, q));

  renderResultsTo(startResults, filtered, (loc) => {
    startSelectedId = loc.id;
    startSearch.value = loc.name;

    // If no route yet, show marker immediately (on the current floor if applicable)
    if (!lastRouteData) {
      drawStartMarkerIfOnCurrentFloor();
    }
  });
});

destSearch.addEventListener("input", () => {
  const q = destSearch.value;
  if (!q) {
    destResults.style.display = "none";
    destResults.innerHTML = "";
    return;
  }

  const filtered = LOCATIONS.filter(l => matches(l, q));

  renderResultsTo(destResults, filtered, (loc) => {
    destSelectedId = loc.id;
    destSearch.value = loc.name;
    routeBtn.disabled = false;
  });
});

// ---------- Buttons ----------
routeBtn.addEventListener("click", async () => {
  if (!startSelectedId || !destSelectedId) return;

  const data = await fetchRoute(startSelectedId, destSelectedId);
  if (!data) return;

  renderRoute(data);

  currentGoal = destSelectedId;
  returnBtn.disabled = false;
});

returnBtn.addEventListener("click", async () => {
  if (!currentGoal) return;

  const data = await fetchRoute(currentGoal, startSelectedId);
  if (!data) return;

  renderRoute(data);

  currentGoal = startSelectedId;
});

resetBtn.addEventListener("click", () => {
  // reset state
  currentGoal = null;
  lastRouteData = null;
  lastDrawnNodes = null;

  startSelectedId = "front_desk";
  destSelectedId = null;

  // reset UI
  routeBtn.disabled = true;
  returnBtn.disabled = true;

  startSearch.value = "";
  startResults.innerHTML = "";
  startResults.style.display = "none";

  destSearch.value = "";
  destResults.innerHTML = "";
  destResults.style.display = "none";

  stepsEl.innerHTML = "";

  floorSelect.value = "1";
  img.src = "/static/Floor1.png";

  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// ---------- Floor switching ----------
floorSelect.addEventListener("change", () => {
  const floor = parseInt(floorSelect.value, 10);

  // pick floor image: prefer server-provided mapping, else fallback to Floor{n}.png
  const imgName =
    (lastRouteData && lastRouteData.floorImages && lastRouteData.floorImages[floor])
      ? lastRouteData.floorImages[floor]
      : `Floor${floor}.png`;

  const onLoad = () => {
    img.removeEventListener("load", onLoad);
    resizeCanvas();

    if (lastRouteData) {
      const floorNodes = lastRouteData.pathNodes.filter(n => parseInt(n.floor, 10) === floor);
      lastDrawnNodes = floorNodes;
      drawPath(lastDrawnNodes);
    } else {
      drawStartMarkerIfOnCurrentFloor();
    }
  };

  img.addEventListener("load", onLoad);
  img.src = "/static/" + imgName;
});

loadLocations();