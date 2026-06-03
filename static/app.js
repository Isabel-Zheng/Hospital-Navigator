let LOCATIONS = [];
let selectedId = null;

const search = document.getElementById("search");
const results = document.getElementById("results");
const routeBtn = document.getElementById("routeBtn");
const stepsEl = document.getElementById("steps");

const img = document.getElementById("map");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const returnBtn = document.getElementById("returnBtn");
const resetBtn = document.getElementById("resetBtn");

let currentStart = "front_desk";
let currentGoal = null;   // last destination we routed to
const floorSelect = document.getElementById("floorSelect");
let lastRouteData = null;

function resizeCanvas() {
  const wrap = document.querySelector(".mapWrap");
  const rect = wrap.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
}

let lastDrawnNodes = null;
window.addEventListener("resize", () => {
  resizeCanvas();
  if (lastDrawnNodes) drawPath(lastDrawnNodes);
});
img.addEventListener("load", () => { resizeCanvas(); });

function normalizeText(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matches(loc, q) {
  const nq = normalizeText(q);
  if (!nq) return false;
  if (normalizeText(loc.name).includes(nq)) return true;
  return (loc.tags || []).some(t => normalizeText(t).includes(nq));
}

function renderResults(list) {
  results.innerHTML = "";
  if (!list || list.length === 0) {
    results.style.display = "none";
    return;
  }
  results.style.display = "block";

  list.slice(0, 10).forEach(loc => {
    const div = document.createElement("div");
    div.className = "result";
    div.textContent = loc.name;
    div.onclick = () => {
      selectedId = loc.id;
      routeBtn.disabled = false;
      [...results.children].forEach(x => x.classList.remove("selected"));
      div.classList.add("selected");
      results.style.display = "none";
      search.value = loc.name;
    };
    results.appendChild(div);
  });
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
}

async function loadLocations() {
  const res = await fetch("/api/locations");
  LOCATIONS = await res.json();
}

search.addEventListener("input", () => {
  const q = search.value;
  if (!q) { results.innerHTML = ""; return; }
  const filtered = LOCATIONS.filter(l => matches(l, q));
  renderResults(filtered);
});

async function fetchRoute(start, goal) {
  stepsEl.innerHTML = "";

  const res = await fetch("/api/route", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ start, goal })
  });

  const data = await res.json();
  if (data.error) {
    stepsEl.innerHTML = `<li>${data.error}</li>`;
    drawPath([]);
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

  if (data.floorImage) {
    const shownFloor = data.destFloor;

    const onImgLoad = () => {
      img.removeEventListener("load", onImgLoad);
      resizeCanvas();
      const floorNodes = data.pathNodes.filter(n => n.floor === shownFloor);
      lastDrawnNodes = floorNodes;
      drawPath(lastDrawnNodes);
    };

    img.addEventListener("load", onImgLoad);
    img.src = "/static/" + data.floorImage;
  } else {
    lastDrawnNodes = data.pathNodes;
    drawPath(lastDrawnNodes);
  }

  lastRouteData = data;
  floorSelect.value = String(data.destFloor);
}

routeBtn.addEventListener("click", async () => {
  if (!selectedId) return;

  const data = await fetchRoute("front_desk", selectedId);
  if (!data) return;

  renderRoute(data);

  currentStart = "front_desk";
  currentGoal = selectedId;
  returnBtn.disabled = false;
});

returnBtn.addEventListener("click", async () => {
  if (!currentGoal) return;

  const data = await fetchRoute(currentGoal, "front_desk");
  if (!data) return;

  renderRoute(data);

  currentGoal = "front_desk";
});

resetBtn.addEventListener("click", () => {
  selectedId = null;
  currentGoal = null;
  lastDrawnNodes = null;
  routeBtn.disabled = true;
  returnBtn.disabled = true;
  search.value = "";
  results.innerHTML = "";
  stepsEl.innerHTML = "";
  img.src = "/static/floor1.png";
  drawPath([]);
});

function getImageBox() {
  const wrap = document.querySelector(".mapWrap");
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;

  const nW = img.naturalWidth;
  const nH = img.naturalHeight;
  if (!nW || !nH) return { x: 0, y: 0, w: W, h: H };

  const scale = Math.min(W / nW, H / nH);
  const w = nW * scale;
  const h = nH * scale;

  const x = (W - w) / 2;
  const y = (H - h) / 2;

  return { x, y, w, h };
}

floorSelect.addEventListener("change", () => {
  const floor = parseInt(floorSelect.value, 10);

  // choose which image to show
  let imgName = null;

  // If we have floorImages from the last route, use it
  if (lastRouteData && lastRouteData.floorImages && lastRouteData.floorImages[floor]) {
    imgName = lastRouteData.floorImages[floor];
  } else {
    // fallback: assume naming like floor1.png, floor2.png...
    imgName = `floor${floor}.png`;
  }

  const onLoad = () => {
    img.removeEventListener("load", onLoad);
    resizeCanvas();

    // If we have a route, draw only nodes on this floor
    if (lastRouteData) {
      const floorNodes = lastRouteData.pathNodes.filter(n => n.floor === floor);
      drawPath(floorNodes);
    } else {
      drawPath([]);
    }
  };

  img.addEventListener("load", onLoad);
  img.src = "/static/" + imgName;
});

loadLocations();