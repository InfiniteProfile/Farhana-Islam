"use strict";

/* =====================================================================
   INFINITE PROFILES — Farhana Islam edition
   - Profile numbers are BigInt: no upper limit.
   - Every profile is computed from its number (seeded PRNG), never stored.
   - Only a handful of DOM rows exist at any time; they are recycled.
   - Browsers cap element height (~17–33M px), so the scroll track is a
     finite "window" of V rows that is silently re-centered on the logical
     profile universe (see recenterWindow). The user never sees the seam.
   ===================================================================== */

/* ---------- Photo library (the complete supplied collection) ---------- */
const PHOTO_BASE = "https://raw.githubusercontent.com/InfiniteProfile/Farhana-Islam/main/Profile%20Photo/";
const FB_IDS = [
  "1791396799917", "1791396798881", "1791396797161", "1791396795800", "1791396793513",
  "1791397098179", "1791397096504", "1791397094847", "1791397092866", "1791397091498",
  "1791397089892", "1791397088331", "1791397118010", "1791397116640", "1791397115345",
  "1791397113457", "1791397112009", "1791397110540", "1791397109225", "1791397107813",
  "1791397135514", "1791397133986", "1791397129303", "1791397127609", "1791397126308",
  "1791397124689", "1791397123195", "1791397121643", "1791397119542", "1791397149223",
  "1791397148173", "1791397146979", "1791397145574", "1791397143839", "1791397142230",
  "1791397140422", "1791397139093", "1791397137625", "1791397172847", "1791397172176",
  "1791397170641", "1791397169464", "1791397167946", "1791397166547", "1791397164563",
  "1791397162315", "1791397161409", "1791397159603", "1791397157822", "1791397156465",
  "1791397187306", "1791397181975", "1791397178576", "1791397177125", "1791397176126",
  "1791397174312"
];
const PHOTO_LIBRARY = [
  ...FB_IDS.map((id) => `${PHOTO_BASE}FB_IMG_${id}.jpg`),
  `${PHOTO_BASE}Screenshot_2026_1008_002000.jpg`
];

/* ---------- Names ---------- */
const PRIMARY_NAME = "Farhana Islam";
const PRIMARY_WEIGHT = 0.68; // ≈ 68% of all profiles
const OTHER_NAMES = [
  "Nusrat Jahan", "Jannatul Ferdous", "Sumaiya Akter", "Tanjila Rahman", "Sadia Ahmed",
  "Mim Akter", "Mahiya Islam", "Tasnim Jahan", "Nabila Rahman", "Faria Islam",
  "Samia Ahmed", "Riya Islam", "Lamia Akter", "Rafia Jahan", "Maliha Khatun",
  "Anika Tabassum", "Sabrina Sultana", "Jarin Tasnim", "Ishrat Jahan", "Raisa Chowdhury",
  "Tahmina Akter", "Afrin Jahan", "Shirin Akter"
];

/* ---------- Layout / virtualization constants ---------- */
const INFO_H = 112;        // must match --info-h
const GAP = 32;            // must match --gap
const PHOTO_RATIO = 1.25;  // photo frame is always 4:5 → stable row height
const VIRTUAL_ROWS = 3000; // rows in the finite scroll window
const SHIFT_ROWS = 1000;   // how far the window slides when re-centering
const EDGE_ROWS = 700;     // re-center when this close to either edge
const BUFFER_ROWS = 2;     // extra rows rendered above/below the viewport
const START_HALF = 1500;   // row index a jumped-to profile is placed at
const POOL_MAX = 12;

/* ---------- DOM ---------- */
const root = document.documentElement;
const bar = document.getElementById("bar");
const track = document.getElementById("track");
const currentEl = document.getElementById("current");
const msgEl = document.getElementById("msg");
const searchForm = document.getElementById("searchForm");
const queryInput = document.getElementById("q");
const themeBtn = document.getElementById("themeBtn");
const topBtn = document.getElementById("topBtn");
const subBar = msgEl.parentElement;

/* ---------- Mutable state (tiny; never grows with profile count) ---------- */
const state = {
  base: 1n,            // profile number at virtual row 0
  rowH: 0,
  headH: 0,
  cardW: 0,
  lastW: 0,
  lastH: 0,
  rows: new Map(),     // virtual row index -> element (only the rendered window)
  pool: [],            // recycled elements
  highlight: null,     // profile number string to flash after a jump
  frame: 0,
  hashTimer: 0,
  msgTimer: 0,
  shownCurrent: ""
};

/* =====================================================================
   Deterministic randomness
   ===================================================================== */

/** String -> four 32-bit seeds (cyrb128). Works for numbers of any size. */
function hashSeed(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** Small fast PRNG (sfc32). Returns a function yielding floats in [0, 1). */
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Seeded generator for one profile number (BigInt-safe via its decimal string). */
function seededRandom(profileNumber) {
  const [a, b, c, d] = hashSeed("infinite-profile:" + profileNumber.toString());
  const rng = sfc32(a, b, c, d);
  for (let i = 0; i < 12; i++) rng(); // warm up
  return rng;
}

/* Fixed shuffled order of the photo library, so "favourite" photos are not just the first ones. */
const PHOTO_ORDER = (() => {
  const idx = PHOTO_LIBRARY.map((_, i) => i);
  const [a, b, c, d] = hashSeed("photo-order-v1");
  const rng = sfc32(a, b, c, d);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
})();

/* =====================================================================
   Profile generation (pure function of the profile number)
   ===================================================================== */

function getProfileName(rng, profileNumber) {
  const roll = rng();
  const pick = rng();
  if (profileNumber === 1n || roll < PRIMARY_WEIGHT) return PRIMARY_NAME;
  return OTHER_NAMES[Math.floor(pick * OTHER_NAMES.length)];
}

function getProfilePhoto(rng) {
  // Skewed pick: some photos naturally appear more often. Repeats are intended.
  const skewed = Math.pow(rng(), 1.45);
  const slot = Math.min(PHOTO_ORDER.length - 1, Math.floor(skewed * PHOTO_ORDER.length));
  return PHOTO_LIBRARY[PHOTO_ORDER[slot]];
}

function getProfileData(profileNumber) {
  const rng = seededRandom(profileNumber);
  const name = getProfileName(rng, profileNumber);
  const photo = getProfilePhoto(rng);
  return {
    number: profileNumber,
    numberText: profileNumber.toString(),
    name,
    photo,
    posX: 35 + rng() * 30,     // object-position x (%)
    posY: 8 + rng() * 34,      // object-position y (%) — keeps faces in frame
    scale: 1 + rng() * 0.07,   // very subtle zoom
    shape: Math.floor(rng() * 5),
    tone: Math.floor(rng() * 3)
  };
}

/* =====================================================================
   Rendering
   ===================================================================== */

/** Builds the (empty) DOM skeleton for one profile row. */
function createProfile() {
  const row = document.createElement("article");
  row.className = "row";
  row.setAttribute("aria-setsize", "-1");

  const card = document.createElement("div");
  card.className = "card";

  const photo = document.createElement("div");
  photo.className = "photo";

  const mark = document.createElement("span");
  mark.className = "ph-mark";
  mark.setAttribute("aria-hidden", "true");

  const img = document.createElement("img");
  img.decoding = "async";
  img.loading = "lazy";
  img.draggable = false;
  img.referrerPolicy = "no-referrer";

  photo.append(mark, img);

  const info = document.createElement("div");
  info.className = "info";

  const name = document.createElement("h2");
  name.className = "name";

  const num = document.createElement("p");
  num.className = "num";
  const label = document.createElement("span");
  label.className = "num-label";
  label.textContent = "Profile";
  const hash = document.createElement("span");
  hash.className = "hash";
  hash.textContent = " #";
  const digits = document.createElement("span");
  digits.className = "digits";
  num.append(label, hash, digits);

  info.append(name, num);
  card.append(photo, info);
  row.append(card);
  return row;
}

function numberSizeClass(len) {
  if (len <= 12) return "n-lg";
  if (len <= 24) return "n-md";
  if (len <= 48) return "n-sm";
  return "n-xs";
}

/** Fills a row element with the data of one profile. */
function renderProfile(row, data) {
  const card = row.firstElementChild;
  const photo = card.firstElementChild;
  const img = photo.querySelector("img");
  const info = card.lastElementChild;

  card.className = `card shape-${data.shape} tone-${data.tone} ${numberSizeClass(data.numberText.length)}`;
  row.dataset.num = data.numberText;
  row.setAttribute("aria-label", `${data.name}, profile ${data.numberText}`);

  info.querySelector(".name").textContent = data.name;
  info.querySelector(".digits").textContent = data.numberText;
  info.querySelector(".num").scrollTop = 0;
  photo.querySelector(".ph-mark").textContent = data.name.charAt(0);

  img.alt = `Portrait for ${data.name}, profile ${data.numberText}`;
  img.style.objectPosition = `${data.posX.toFixed(1)}% ${data.posY.toFixed(1)}%`;
  img.style.transformOrigin = `${data.posX.toFixed(1)}% ${data.posY.toFixed(1)}%`;
  img.style.transform = `scale(${data.scale.toFixed(3)})`;

  img.dataset.tries = "0";
  photo.classList.remove("failed", "loaded");
  img.dataset.url = data.photo;
  img.src = data.photo;

  row.classList.toggle("found", state.highlight === data.numberText);
}

function placeRow(row, index) {
  row.dataset.idx = String(index);
  row.style.transform = `translate3d(0, ${index * state.rowH}px, 0)`;
}

function bindRow(row, index) {
  placeRow(row, index);
  renderProfile(row, getProfileData(state.base + BigInt(index)));
}

function releaseRow(index, row) {
  state.rows.delete(index);
  row.remove();
  row.classList.remove("found");
  // Free the image so detached nodes don't hold decoded bitmaps (low-RAM phones).
  const img = row.querySelector("img");
  img.removeAttribute("src");
  img.dataset.url = "";
  if (state.pool.length < POOL_MAX) state.pool.push(row);
}

/* =====================================================================
   Virtualization
   ===================================================================== */

/** Renders only the rows near the viewport; recycles everything else. */
function virtualizeProfiles() {
  const H = state.rowH;
  const top = window.scrollY - state.headH;
  const bottom = top + window.innerHeight;
  const first = Math.max(0, Math.floor(top / H) - BUFFER_ROWS);
  const last = Math.min(VIRTUAL_ROWS - 1, Math.floor(bottom / H) + BUFFER_ROWS);

  for (const [index, row] of state.rows) {
    if (index < first || index > last) releaseRow(index, row);
  }

  let added = false;
  for (let i = first; i <= last; i++) {
    if (state.rows.has(i)) continue;
    const row = state.pool.pop() || createProfile();
    bindRow(row, i);
    state.rows.set(i, row);
    added = true;
  }

  if (added) {
    // Keep DOM order == profile order (screen readers, keyboard order).
    let prev = null;
    for (let i = first; i <= last; i++) {
      const row = state.rows.get(i);
      if (row.previousElementSibling !== prev) {
        track.insertBefore(row, prev ? prev.nextSibling : track.firstChild);
      }
      prev = row;
    }
  }
}

/**
 * Slides the finite scroll window along the infinite number line when the user
 * gets close to either edge. Rows keep their content; only their virtual index
 * and the scroll offset change by the same amount, so nothing moves on screen.
 */
function recenterWindow() {
  const H = state.rowH;
  const sy = window.scrollY;
  const center = Math.floor((sy - state.headH + window.innerHeight / 2) / H);
  let shift = 0;

  if (center > VIRTUAL_ROWS - EDGE_ROWS) {
    shift = SHIFT_ROWS;
  } else if (center < EDGE_ROWS && state.base > 1n) {
    const room = state.base - 1n;
    shift = -Number(room < BigInt(SHIFT_ROWS) ? room : BigInt(SHIFT_ROWS));
  }
  if (!shift) return;

  state.base += BigInt(shift);
  window.scrollTo(0, sy - shift * H);

  const moved = new Map();
  for (const [index, row] of state.rows) {
    const next = index - shift;
    placeRow(row, next);
    moved.set(next, row);
  }
  state.rows = moved;
}

function clearRows() {
  for (const [index, row] of state.rows) releaseRow(index, row);
}

/** Current profile = the one under the upper part of the viewport. */
function getCurrentNumber() {
  const row = Math.floor((window.scrollY - state.headH + window.innerHeight * 0.4) / state.rowH);
  const clamped = Math.max(0, Math.min(VIRTUAL_ROWS - 1, row));
  return state.base + BigInt(clamped);
}

function updateCurrent() {
  const num = getCurrentNumber();
  const text = num.toString();
  if (text !== state.shownCurrent) {
    state.shownCurrent = text;
    currentEl.textContent = "#" + text;
  }
  topBtn.hidden = num <= 2n;
}

function scheduleHashUpdate() {
  clearTimeout(state.hashTimer);
  state.hashTimer = setTimeout(() => {
    try { history.replaceState(null, "", "#" + state.shownCurrent); } catch (e) { /* ignore */ }
  }, 300);
}

function tick() {
  state.frame = 0;
  recenterWindow();
  virtualizeProfiles();
  updateCurrent();
  scheduleHashUpdate();
}

function requestTick() {
  if (!state.frame) state.frame = requestAnimationFrame(tick);
}

/* =====================================================================
   Layout (row height must be exact and stable for virtualization)
   ===================================================================== */

function measureLayout() {
  const w = root.clientWidth;
  state.headH = bar.offsetHeight;
  const heightCap = (window.innerHeight - state.headH - INFO_H - GAP) / PHOTO_RATIO;
  const cardW = Math.round(Math.max(240, Math.min(w - 28, 460, heightCap)));
  const photoH = Math.round(cardW * PHOTO_RATIO);
  const rowH = photoH + INFO_H + GAP;

  root.style.setProperty("--head-h", state.headH + "px");
  root.style.setProperty("--card-w", cardW + "px");
  root.style.setProperty("--photo-h", photoH + "px");
  root.style.setProperty("--row-h", rowH + "px");

  state.cardW = cardW;
  state.lastW = w;
  state.lastH = window.innerHeight;
  return rowH;
}

function applyLayout(preservePosition) {
  const oldH = state.rowH;
  const rowsScrolled = oldH ? window.scrollY / oldH : 0;
  state.rowH = measureLayout();
  track.style.height = VIRTUAL_ROWS * state.rowH + "px";
  for (const [index, row] of state.rows) placeRow(row, index);
  if (preservePosition && oldH) window.scrollTo(0, rowsScrolled * state.rowH);
}

function onResize() {
  const widthChanged = root.clientWidth !== state.lastW;
  const heightJump = Math.abs(window.innerHeight - state.lastH) > 150; // ignore mobile toolbar jitter
  if (!widthChanged && !heightJump) return;
  applyLayout(true);
  requestTick();
}

/* =====================================================================
   Jump / search (works for any size of number — no previous profiles needed)
   ===================================================================== */

function jumpToProfile(target, options = {}) {
  let index;
  if (target <= BigInt(START_HALF)) {
    state.base = 1n;
    index = Number(target - 1n);
  } else {
    state.base = target - BigInt(START_HALF);
    index = START_HALF;
  }

  clearRows();
  state.highlight = options.highlight ? target.toString() : null;
  window.scrollTo(0, index * state.rowH);
  tick();

  if (options.highlight) {
    setTimeout(() => {
      state.highlight = null;
      for (const row of state.rows.values()) row.classList.remove("found");
    }, 2600);
  }
}

/** Accepts "1,234", "1 234", Bengali digits, etc. Returns BigInt > 0 or null. */
function parseProfileNumber(raw) {
  const cleaned = String(raw)
    .replace(/[\u09E6-\u09EF]/g, (d) => String(d.charCodeAt(0) - 0x09E6))
    .replace(/[\s,_']/g, "")
    .replace(/^#/, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = BigInt(cleaned);
  return n > 0n ? n : null;
}

function say(text, isError) {
  clearTimeout(state.msgTimer);
  msgEl.textContent = text;
  msgEl.classList.toggle("error", !!isError);
  subBar.classList.toggle("has-msg", !!text);
  if (text) {
    state.msgTimer = setTimeout(() => say(""), 3200);
  }
}

function onSearch(event) {
  event.preventDefault();
  const n = parseProfileNumber(queryInput.value);
  if (n === null) {
    say("Enter a whole number greater than 0.", true);
    return;
  }
  jumpToProfile(n, { highlight: true });
  say("Found profile.");
  queryInput.blur();
}

/* =====================================================================
   Images: delegated load/error handling (no per-profile listeners)
   ===================================================================== */

function initializeImageHandling() {
  track.addEventListener("load", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const photo = img.parentElement;
    photo.classList.remove("failed");
    photo.classList.add("loaded");
  }, true);

  track.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.url) return;
    const photo = img.parentElement;
    photo.classList.remove("loaded");
    photo.classList.add("failed");

    // Retry a couple of times in case the network was only briefly down.
    const tries = Number(img.dataset.tries || 0);
    if (tries >= 2) return;
    img.dataset.tries = String(tries + 1);
    const url = img.dataset.url;
    setTimeout(() => {
      if (img.dataset.url === url && photo.classList.contains("failed")) {
        img.src = url + "?retry=" + Date.now();
      }
    }, 3000 * (tries + 1));
  }, true);
}

/* =====================================================================
   Theme
   ===================================================================== */

function applyTheme(theme) {
  root.dataset.theme = theme;
  themeBtn.setAttribute("aria-pressed", String(theme === "light"));
  themeBtn.setAttribute("aria-label", theme === "light" ? "Switch to dark theme" : "Switch to light theme");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f8eedd" : "#150810");
  try { localStorage.setItem("infinite-theme", theme); } catch (e) { /* ignore */ }
}

function initializeTheme() {
  let saved = null;
  try { saved = localStorage.getItem("infinite-theme"); } catch (e) { /* ignore */ }
  applyTheme(saved === "light" ? "light" : "dark");
  themeBtn.addEventListener("click", () => {
    applyTheme(root.dataset.theme === "light" ? "dark" : "light");
  });
}

/* =====================================================================
   Infinite scroll bootstrap
   ===================================================================== */

function readHashNumber() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
  return raw ? parseProfileNumber(raw) : null;
}

function isTypingTarget(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function initializeInfiniteScroll() {
  applyLayout(false);

  window.addEventListener("scroll", requestTick, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(onResize, 200));

  window.addEventListener("hashchange", () => {
    const n = readHashNumber();
    if (n !== null && n.toString() !== state.shownCurrent) jumpToProfile(n, { highlight: true });
  });

  searchForm.addEventListener("submit", onSearch);
  topBtn.addEventListener("click", () => jumpToProfile(1n));

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/" && !isTypingTarget(e.target)) {
      e.preventDefault();
      queryInput.focus();
      queryInput.select();
    } else if (e.key === "Home" && !isTypingTarget(e.target)) {
      e.preventDefault();
      jumpToProfile(1n);
    }
  });

  initializeImageHandling();

  // First profile is rendered synchronously — no loading screen.
  jumpToProfile(readHashNumber() || 1n, { highlight: false });
}

initializeTheme();
initializeInfiniteScroll();
