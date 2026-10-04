(() => {
'use strict';

// ---------- constants ----------
const COLS = 9, T = 48, W = COLS * T;
let IDLE_LIMIT = 16;       // seconds standing still before the eraser gets you (upgradable)
let ERASER_START = 7;       // eraser starts creeping in after this long
const WRAP = COLS + 8;       // period of looping cars / logs (in tiles)
const TRAIN_LEN = 15;
let MAX_MOVES = 10, START_MOVES = 3;
const BEST_KEY = 'mathyroad.best';
const CAR_COLORS = ['#ff5a5f', '#ffb400', '#3ddc97', '#4cc9f0', '#b388ff', '#ff8fab', '#ff7b00'];

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[ri(0, arr.length - 1)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapX = v => (((v + 4) % WRAP) + WRAP) % WRAP - 4;
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = ri(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const shadeCache = new Map();
function shade(hex, f) {
  const key = hex + f;
  let v = shadeCache.get(key);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(x => clamp(Math.round(x * f), 0, 255));
    v = `rgb(${c[0]},${c[1]},${c[2]})`;
    shadeCache.set(key, v);
  }
  return v;
}
function loadBest() { try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; } }
function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* ignore */ } }

// ---------- save data & shop ----------
const SAVE_KEY = 'mathyroad.save';
const SHOP = [
  { id: 'pocket', name: 'Bigger Pocket', desc: '+2 max stored turns', max: 5, base: 8, now: l => `Max turns ${10 + 2 * l}` },
  { id: 'head', name: 'Head Start', desc: '+1 starting turn', max: 5, base: 6, now: l => `Start with ${3 + l}` },
  { id: 'eraser', name: 'Slow Eraser', desc: '+20% eraser time', max: 5, base: 10, now: l => `Eraser time x${(1 + .2 * l).toFixed(1)}` },
  { id: 'gold', name: 'Gold Rush', desc: '+1 coin value', max: 5, base: 12, now: l => `Coin worth ${1 + l}` }
];
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') return { coins: +s.coins || 0, up: Object.assign({}, s.up) };
  } catch (e) { /* ignore */ }
  return { coins: 0, up: {} };
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
let save = loadSave();
const lvl = id => save.up[id] || 0;
const upCost = it => Math.round(it.base * Math.pow(1.7, lvl(it.id)));
function applyUpgrades() {
  MAX_MOVES = 10 + 2 * lvl('pocket');
  START_MOVES = 3 + lvl('head');
  const mul = 1 + .2 * lvl('eraser');
  IDLE_LIMIT = 16 * mul;
  ERASER_START = 7 * mul;
}

// ---------- DOM ----------
const stage = $('stage'), canvas = $('c'), ctx = canvas.getContext('2d');
const scoreEl = $('score'), streakEl = $('streak'), bestHud = $('bestHud');
const panel = $('mathPanel'), problemEl = $('problem'), ansBtns = [...document.querySelectorAll('.ans')];
const earnBtn = $('earnBtn'), turnsEl = $('turns'), turnsLabel = $('turnsLabel'), pipsEl = $('pips');
const coinHud = $('coinHud'), shopScreen = $('shopScreen');
const toastEl = $('toast'), timerFill = $('timerFill');
const startScreen = $('startScreen'), overScreen = $('overScreen');

// ---------- sizing ----------
let scale = 1, H = 720, dpr = 1;
function resize() {
  const iw = window.innerWidth, ih = window.innerHeight;
  scale = iw / W;
  H = ih / scale;
  if (H > 900) { H = 900; scale = ih / H; }
  if (H < 560) { H = 560; scale = ih / H; }
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = W * scale, ch = H * scale;
  stage.style.width = cw + 'px';
  stage.style.height = ch + 'px';
  stage.style.setProperty('--u', scale + 'px');
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------- game state ----------
let moves = START_MOVES, lanes, genR, player, camRow, score, streak, correctCount, best, idleT, time = 0;
let state = 'menu', dead = null, shake = 0, panelOpen = false, problem = null, choices = [];
let runCoins = 0, floats = [];
let overShown = false, overAt = 0, toastTimer = 0, warned = false, playerScreen = { x: 0, y: 0 };
best = loadBest();

function setState(s) { state = s; stage.dataset.state = s; }

function resetWorld() {
  applyUpgrades();
  runCoins = 0; floats = [];
  lanes = {};
  genR = -10;
  player = { row: 0, px: 4, offX: 0, offRow: 0, hopP: 1, fwd: false, sq: 0, cool: 0, face: 0 };
  moves = START_MOVES; camRow = 0; score = 0; streak = 0; correctCount = 0; idleT = 0;
  dead = null; shake = 0; warned = false; overShown = false;
  closePanel();
  ensureLanes(30);
  updateHud();
}

function start() {
  bestAtStart = best;
  resetWorld();
  startScreen.hidden = true;
  overScreen.hidden = true;
  setState('play');
}

// ---------- world generation ----------
function ensureLanes(n) {
  while (genR <= n) { lanes[genR] = genLane(genR); genR++; }
}

function genLane(r) {
  let lane;
  if (r <= 0) lane = makeGrass(r, r < 0 ? rnd(.2, .35) : 0);
  else if (r <= 2) lane = makeGrass(r, .1);
  else {
    const prev = lanes[r - 1];
    const w = { grass: 3, road: 3.6, river: r >= 5 ? 2.2 : 0, rail: r >= 8 ? 1.6 : 0 };
    if (prev.type === 'river' && prev.run >= 3) w.river = 0;
    if (prev.type === 'road' && prev.run >= 4) w.road = 0;
    if (prev.type === 'rail' && prev.run >= 2) w.rail = 0;
    if (prev.type === 'grass' && prev.run >= 2) w.grass = .5;
    let tot = 0; for (const k in w) tot += w[k];
    let t = Math.random() * tot, type = 'grass';
    for (const k in w) { if ((t -= w[k]) < 0) { type = k; break; } }
    lane = type === 'grass' ? makeGrass(r, rnd(.12, .28))
      : type === 'road' ? makeRoad(r)
      : type === 'river' ? makeRiver(r) : makeRail(r);
  }
  if (r >= 3 && (lane.type === 'grass' || lane.type === 'road') && Math.random() < .25) {
    const free = [];
    for (let c = 0; c < COLS; c++) if (lane.type !== 'grass' || !lane.trees[c]) free.push(c);
    if (free.length) lane.coin = pick(free);
  }
  lane.r = r;
  const prev = lanes[r - 1];
  lane.run = prev && prev.type === lane.type ? prev.run + 1 : 1;
  return lane;
}

function makeGrass(r, dens) {
  const trees = [];
  for (let c = 0; c < COLS; c++) trees.push(Math.random() < dens);
  const prev = lanes[r - 1];
  // Guarantee that every free stretch of the previous grass row has a way forward.
  if (r > 0 && prev && prev.type === 'grass') {
    let c = 0;
    while (c < COLS) {
      if (prev.trees[c]) { c++; continue; }
      const s = c;
      while (c < COLS && !prev.trees[c]) c++;
      let ok = false;
      for (let k = s; k < c; k++) if (!trees[k]) ok = true;
      if (!ok) trees[s + ri(0, c - s - 1)] = false;
    }
  }
  const decor = [];
  for (let i = 0; i < 6; i++) decor.push({ x: rnd(0, W), y: rnd(.1, .75), c: pick(['#fff', '#ffe066', '#ff9fb5']) });
  return { type: 'grass', trees, decor };
}

function makeRoad(r) {
  const d = Math.min(1, r / 80);
  const dir = Math.random() < .5 ? 1 : -1;
  const speed = rnd(1.6, 3) * (1 + .7 * d);
  const n = d < .25 ? ri(1, 2) : ri(2, 3);
  const S = WRAP / n, ph = rnd(0, WRAP);
  const objs = [];
  for (let i = 0; i < n; i++) {
    const truck = Math.random() < .3;
    objs.push({ x0: ph + i * S + rnd(-.5, .5), w: truck ? 2.2 : 1.35, truck, color: pick(CAR_COLORS) });
  }
  return { type: 'road', dir, speed, off: 0, objs };
}

function makeRiver(r) {
  const d = Math.min(1, r / 80);
  const dir = Math.random() < .5 ? 1 : -1;
  const speed = rnd(1, 2) * (1 + .5 * d);
  const n = d < .6 ? 4 : 3;
  const S = WRAP / n, ph = rnd(0, WRAP);
  const objs = [];
  for (let i = 0; i < n; i++) {
    objs.push({ x0: ph + i * S + rnd(-.3, .3), w: n === 4 ? rnd(2.3, 2.9) : rnd(2.6, 3.2) });
  }
  return { type: 'river', dir, speed, off: 0, objs };
}

function makeRail(r) {
  return { type: 'rail', dir: Math.random() < .5 ? 1 : -1, state: 'idle', timer: rnd(.5, 4), x: 0, speed: 26 };
}

function updateLane(l, dt) {
  if (l.type === 'road' || l.type === 'river') {
    l.off = (l.off + l.dir * l.speed * dt) % WRAP;
  } else if (l.type === 'rail') {
    if (l.state === 'idle') {
      l.timer -= dt;
      if (l.timer <= 0) { l.state = 'warn'; l.timer = 1.8; }
    } else if (l.state === 'warn') {
      l.timer -= dt;
      if (l.timer <= 0) { l.state = 'pass'; l.x = l.dir > 0 ? -TRAIN_LEN : COLS; }
    } else {
      l.x += l.dir * l.speed * dt;
      if (l.dir > 0 ? l.x > COLS : l.x < -TRAIN_LEN) { l.state = 'idle'; l.timer = rnd(3.5, 7); }
    }
  }
}

// ---------- math problems ----------
function makeProblem(sc) {
  const r = Math.random();
  let kind;
  if (sc < 30) kind = r < .5 ? 'add' : 'sub';
  else if (sc < 45) kind = r < .5 ? 'mul' : r < .75 ? 'add' : 'sub';
  else if (sc < 60) kind = r < .6 ? 'mul' : r < .8 ? 'add' : 'sub';
  else kind = r < .35 ? 'div' : r < .7 ? 'mul' : r < .85 ? 'add' : 'sub';
  const maxAS = sc < 10 ? 10 : sc < 20 ? 20 : sc < 45 ? 50 : 100;
  const maxF = sc < 45 ? 6 : sc < 60 ? 9 : 12;
  let a, b, ans, text;
  if (kind === 'add') { a = ri(1, maxAS); b = ri(1, maxAS); ans = a + b; text = `${a} + ${b}`; }
  else if (kind === 'sub') { a = ri(2, maxAS); b = ri(1, a - 1); ans = a - b; text = `${a} − ${b}`; }
  else if (kind === 'mul') { a = ri(2, maxF); b = ri(2, maxF); ans = a * b; text = `${a} × ${b}`; }
  else { b = ri(2, maxF); const q = ri(2, maxF); a = b * q; ans = q; text = `${a} ÷ ${b}`; }
  return { text, ans, kind, a, b };
}

function makeChoices(p) {
  const offs = [1, -1, 2, -2, 3, -3];
  if (p.ans >= 20) offs.push(10, -10);
  if (p.kind === 'mul') offs.push(p.a, -p.a, p.b, -p.b);
  shuffle(offs);
  const set = new Set();
  for (const o of offs) {
    const v = p.ans + o;
    if (v >= 0 && v !== p.ans) set.add(v);
    if (set.size >= 3) break;
  }
  for (let k = 4; set.size < 3; k++) set.add(p.ans + k);
  return shuffle([p.ans, ...set]);
}

// ---------- panel ----------
function openProblem() {
  problem = makeProblem(score);
  choices = makeChoices(problem);
  problemEl.textContent = problem.text + ' = ?';
  ansBtns.forEach((b, i) => { b.lastElementChild.textContent = choices[i]; });
  panel.hidden = false;
  panelOpen = true;
}
function closePanel() { panel.hidden = true; panelOpen = false; }

function answer(i) {
  if (state !== 'play' || !panelOpen || i < 0 || i > 3) return;
  if (choices[i] === problem.ans) {
    moves = Math.min(MAX_MOVES, moves + 1);
    streak++; correctCount++;
    updateHud();
    if (moves >= MAX_MOVES) { closePanel(); toast('Turns full! Go hop!', 1400); }
    else {
      openProblem();
      panel.classList.remove('wrong', 'right');
      void panel.offsetWidth;
      panel.classList.add('right');
    }
  } else {
    streak = 0;
    updateHud();
    panel.classList.remove('wrong', 'right');
    void panel.offsetWidth;
    panel.classList.add('wrong');
    openProblem();
  }
}

function requestEarn() {
  if (state !== 'play') return;
  if (panelOpen) { closePanel(); return; }
  if (moves >= MAX_MOVES) { toast('Turns are full (10)!'); return; }
  openProblem();
}
ansBtns.forEach((b, i) => b.addEventListener('click', () => { answer(i); b.blur(); }));

// ---------- player actions ----------
function rendered() {
  const e = player.hopP;
  return {
    x: player.px + player.offX * (1 - e),
    row: player.row + player.offRow * (1 - e),
    lift: Math.sin(Math.PI * e) * (player.fwd ? .55 : .3) * T
  };
}

function toast(msg, ms = 1200) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastTimer = ms / 1000;
}

function treeAt(lane, col) { return lane.type === 'grass' && lane.trees[col]; }

function requestForward() {
  if (state !== 'play') return;
  if (panelOpen) { toast('Answer or close the question first!'); return; }
  const next = lanes[player.row + 1];
  if (treeAt(next, clamp(Math.round(player.px), 0, COLS - 1))) { toast('A tree is in the way!'); shake = Math.max(shake, .12); return; }
  if (moves <= 0) {
    toast('Out of turns! Answer to earn more.', 1500);
    if (!panelOpen) openProblem();
    return;
  }
  doForward();
}

function doForward() {
  const cur = lanes[player.row], next = lanes[player.row + 1];
  const tx = cur.type === 'river' ? clamp(Math.round(player.px), 0, COLS - 1) : player.px;
  if (treeAt(next, tx)) { toast('A tree is in the way!'); return; }
  const r = rendered();
  player.offX = r.x - tx;
  player.offRow = r.row - (player.row + 1);
  player.px = tx;
  player.row++;
  player.hopP = 0; player.fwd = true; player.cool = .1; player.sq = 0;
  score = player.row;
  moves--;
  idleT = 0; warned = false;
  updateHud();
}

function moveSide(dir) {
  if (state !== 'play' || player.cool > 0 || panelOpen) return;
  const l = lanes[player.row];
  let tx;
  if (l.type === 'river') {
    tx = player.px + dir;
    if (tx < -.4 || tx > COLS - .6) return;
  } else {
    tx = Math.round(player.px) + dir;
    if (tx < 0 || tx >= COLS) return;
    if (treeAt(l, tx)) return;
  }
  const r = rendered();
  player.offX = r.x - tx;
  player.offRow = r.row - player.row;
  player.px = tx;
  player.hopP = 0; player.fwd = false; player.cool = .09; player.sq = 0;
  player.face = dir;
}

function die(type) {
  if (state !== 'play') return;
  setState('dead');
  dead = { type, t: 0 };
  shake = type === 'drown' || type === 'swept' ? .15 : .4;
  closePanel();
  if (score > best) { best = score; saveBest(best); }
  updateHud();
}

function showOver() {
  overShown = true;
  const msg = {
    car: 'Flattened by a car!', train: 'Hit by a train!', drown: 'Splash! You fell in the river.',
    swept: 'Swept away downstream!', erased: 'Erased! Keep moving next time.'
  };
  $('overCause').textContent = msg[dead.type] || '';
  $('overScore').textContent = score;
  $('overBest').textContent = best;
  $('overCorrect').textContent = correctCount;
  $('overCoins').textContent = runCoins;
  $('newBest').hidden = !(score > 0 && score === best && score > bestAtStart);
  overScreen.hidden = false;
  overAt = performance.now();
}
let bestAtStart = best;

// ---------- update ----------
function updateHud() {
  scoreEl.textContent = score;
  streakEl.textContent = streak >= 3 ? `🔥 Streak ${streak}` : `Streak ${streak}`;
  streakEl.classList.toggle('hot', streak >= 3);
  turnsLabel.textContent = `Turns ${moves}/${MAX_MOVES}`;
  turnsEl.classList.toggle('low', moves === 0);
  while (pipsEl.children.length < MAX_MOVES) pipsEl.appendChild(document.createElement('i'));
  while (pipsEl.children.length > MAX_MOVES) pipsEl.lastChild.remove();
  [...pipsEl.children].forEach((p, i) => p.classList.toggle('on', i < moves));
  earnBtn.classList.toggle('pulse', moves === 0 && state === 'play');
  earnBtn.disabled = moves >= MAX_MOVES;
  coinHud.textContent = '\ud83e\ude99 ' + save.coins;
  $('startCoins').textContent = save.coins;
  bestHud.textContent = 'Best ' + Math.max(best, score);
  $('startBest').textContent = best;
}

function update(dt) {
  time += dt;
  const wdt = state === 'play' && panelOpen ? 0 : dt;   // time freezes while a question is open
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) toastEl.hidden = true;
  if (shake > 0) shake = Math.max(0, shake - dt);

  ensureLanes(Math.ceil(camRow) + Math.ceil(H / T) + 4);
  const lo = Math.floor(camRow) - 14, hi = Math.floor(camRow) + 18;
  for (let r = lo; r <= hi; r++) if (lanes[r]) updateLane(lanes[r], wdt);

  // player animation
  if (player.hopP < 1) {
    player.hopP = Math.min(1, player.hopP + dt / (player.fwd ? .17 : .11));
    if (player.hopP >= 1) player.sq = .3;
  } else if (player.sq > 0) player.sq = Math.max(0, player.sq - dt);
  if (player.cool > 0) player.cool -= dt;
  camRow += (player.row - camRow) * (1 - Math.exp(-dt * 7));

  if (state === 'dead') {
    dead.t += dt;
    if (dead.type === 'erased') idleT += dt;
    if (!overShown && dead.t >= (dead.type === 'erased' ? 1.2 : .95)) showOver();
  }
  if (state !== 'play') { updateTimerBar(); return; }

  // eraser timer
  idleT += wdt;
  if (idleT >= ERASER_START && !warned) { warned = true; toast('Hop! The eraser is coming!', 1500); }
  if (idleT >= IDLE_LIMIT) { die('erased'); updateTimerBar(); return; }
  updateTimerBar();

  // coins
  for (const f of floats) f.t += dt;
  floats = floats.filter(f => f.t < .9);
  const cl = lanes[player.row];
  if (cl.coin != null && !cl.taken && Math.round(player.px) === cl.coin) {
    cl.taken = true;
    const v = 1 + lvl('gold');
    save.coins += v; runCoins += v; persist();
    floats.push({ row: player.row, x: player.px, t: 0, text: '+' + v });
    updateHud();
  }

  // hazards
  const l = lanes[player.row];
  const left = player.px + .2, right = player.px + .8;
  if (l.type === 'road') {
    for (const o of l.objs) {
      const x = wrapX(o.x0 + l.off);
      if (left < x + o.w && right > x) { die('car'); return; }
    }
  } else if (l.type === 'rail') {
    if (l.state === 'pass' && left < l.x + TRAIN_LEN && right > l.x) { die('train'); return; }
  } else if (l.type === 'river') {
    player.px += l.dir * l.speed * wdt;   // ride along with the water
    const cx = player.px + .5;
    let onLog = false;
    for (const o of l.objs) {
      const x = wrapX(o.x0 + l.off);
      if (cx > x - .15 && cx < x + o.w + .15) { onLog = true; break; }
    }
    if (player.px < -.55 || player.px > COLS - .45) { die('swept'); return; }
    if (!onLog) { die('drown'); return; }
  }
}

function updateTimerBar() {
  const p = clamp(idleT / IDLE_LIMIT, 0, 1);
  timerFill.style.width = ((1 - p) * 100) + '%';
  timerFill.style.background = panelOpen && state === 'play' ? '#7cc8ff' : p < .45 ? '#4cd964' : p < .7 ? '#ffcc00' : '#ff3b30';
}

// ---------- drawing ----------
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function block(x, y, w, h, color, depth = 5, r = 4) {
  ctx.fillStyle = shade(color, .72);
  rr(x, y + depth, w, h, r); ctx.fill();
  ctx.fillStyle = color;
  rr(x, y, w, h, r); ctx.fill();
}

function drawLaneBg(l, y) {
  const top = y - T / 2;
  switch (l.type) {
    case 'grass':
      ctx.fillStyle = l.r & 1 ? '#7ad94f' : '#6fcf47';
      ctx.fillRect(0, top, W, T);
      for (const d of l.decor) { ctx.fillStyle = d.c; ctx.fillRect(d.x, top + d.y * T, 4, 4); }
      ctx.fillStyle = '#5db83c'; ctx.fillRect(0, top + T - 5, W, 5);
      break;
    case 'road': {
      ctx.fillStyle = '#585e6e'; ctx.fillRect(0, top, W, T);
      const above = lanes[l.r + 1];
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      if (above && above.type === 'road') for (let x = 8; x < W; x += 48) ctx.fillRect(x, top - 2, 26, 4);
      else ctx.fillRect(0, top - 1, W, 3);
      ctx.fillStyle = '#464b59'; ctx.fillRect(0, top + T - 5, W, 5);
      break;
    }
    case 'river': {
      ctx.fillStyle = '#43b3f0'; ctx.fillRect(0, top, W, T);
      ctx.fillStyle = 'rgba(255,255,255,.32)';
      const sh = (time * 14 * l.dir) % 64;
      for (let i = -1; i < 9; i++) {
        const x = i * 64 + sh + (l.r % 3) * 20;
        ctx.fillRect(x, top + 12 + (i & 1) * 16, 22, 3);
      }
      ctx.fillStyle = '#2f98d6'; ctx.fillRect(0, top + T - 5, W, 5);
      break;
    }
    case 'rail': {
      ctx.fillStyle = '#c9b78f'; ctx.fillRect(0, top, W, T);
      ctx.fillStyle = '#8a6b45';
      for (let x = 0; x < W; x += 18) ctx.fillRect(x, top + 6, 8, T - 14);
      ctx.fillStyle = '#9aa0a8';
      ctx.fillRect(0, y - 12, W, 4); ctx.fillRect(0, y + 6, W, 4);
      if (l.state === 'warn' && Math.floor(time * 4) % 2 === 0) { ctx.fillStyle = 'rgba(255,50,50,.2)'; ctx.fillRect(0, top, W, T); }
      ctx.fillStyle = '#a89572'; ctx.fillRect(0, top + T - 5, W, 5);
      break;
    }
  }
}

function drawTree(c, y) {
  const x = c * T;
  ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(x + 6, y + 12, T - 12, 8);
  ctx.fillStyle = '#8a5a2b'; ctx.fillRect(x + T * .4, y - 2, T * .2, T * .42);
  ctx.fillStyle = '#2a8a37'; ctx.fillRect(x + 4, y - 38, T - 8, 40);
  ctx.fillStyle = '#35a843'; ctx.fillRect(x + 4, y - 38, T - 18, 40);
  ctx.fillStyle = '#52c75c'; ctx.fillRect(x + 4, y - 38, T - 8, 11);
}

function drawCar(o, x, y, dir) {
  const px = x * T, w = o.w * T, h = 24, top = y - 14;
  const frontR = dir > 0;
  if (o.truck) {
    const cabW = w * .32;
    const cabX = frontR ? px + w - cabW : px;
    const cargoX = frontR ? px : px + cabW;
    block(cargoX, top - 2, w - cabW, h + 2, '#f1f3f8');
    block(cabX, top, cabW, h, o.color);
    ctx.fillStyle = '#cfeeff';
    ctx.fillRect(frontR ? cabX + cabW - 9 : cabX + 3, top + 4, 6, 9);
  } else {
    block(px, top, w, h, o.color);
    ctx.fillStyle = shade(o.color, 1.15);
    rr(px + w * .25, top + 3, w * .5, h - 6, 3); ctx.fill();
    ctx.fillStyle = '#cfeeff';
    rr(px + w * .3, top + 5, w * .4, h - 10, 2); ctx.fill();
  }
  ctx.fillStyle = '#ffee88';
  ctx.fillRect(frontR ? px + w - 3 : px, top + 3, 3, 5);
  ctx.fillRect(frontR ? px + w - 3 : px, top + h - 8, 3, 5);
  ctx.fillStyle = '#25252e';
  ctx.fillRect(px + w * .15, top + h + 2, 9, 4);
  ctx.fillRect(px + w * .72, top + h + 2, 9, 4);
}

function drawLog(x, y, w) {
  const px = x * T, pw = w * T, h = 32;
  block(px, y - h / 2, pw, h, '#9b6a3c', 5, 9);
  ctx.fillStyle = '#845a31';
  for (let i = 1; i < 4; i++) ctx.fillRect(px + pw * i / 4, y - 9, 14, 3);
  ctx.fillStyle = '#c99a63';
  ctx.beginPath(); ctx.ellipse(px + 7, y, 6, 12, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(px + pw - 7, y, 6, 12, 0, 0, 7); ctx.fill();
}

function drawTrain(l, y) {
  const dir = l.dir;
  const segW = 3.1 * T, locoW = 2.8 * T;
  let x = l.x * T;
  const total = TRAIN_LEN * T;
  // draw from rear to front; front = leading end in direction of travel
  const cars = [];
  let used = 0;
  while (used + segW <= total - locoW + 1) { cars.push(segW); used += segW + 4; }
  const parts = [...cars.map(w => ({ w, loco: false })), { w: locoW, loco: true }];
  let cx = dir > 0 ? x : x + total;
  const colors = ['#4cc9f0', '#ffb400', '#b388ff', '#3ddc97'];
  parts.forEach((p, i) => {
    const px = dir > 0 ? cx : cx - p.w;
    if (p.loco) {
      block(px, y - 18, p.w, 34, '#ff5a5f', 6, 6);
      ctx.fillStyle = '#ffe066'; ctx.fillRect(px, y - 4, p.w, 5);
      ctx.fillStyle = '#cfeeff'; ctx.fillRect(dir > 0 ? px + p.w - 28 : px + 8, y - 13, 20, 10);
      ctx.fillStyle = '#ffee88'; ctx.fillRect(dir > 0 ? px + p.w - 4 : px, y - 10, 4, 8);
    } else {
      block(px, y - 17, p.w, 32, colors[i % colors.length], 6, 5);
      ctx.fillStyle = '#cfeeff';
      for (let k = 0; k < 4; k++) ctx.fillRect(px + 10 + k * (p.w - 20) / 4, y - 11, 18, 9);
    }
    cx += dir > 0 ? p.w + 4 : -(p.w + 4);
  });
}

function drawSignal(l, y) {
  const x = W - 20, blink = l.state === 'warn' ? Math.floor(time * 5) % 2 : -1;
  ctx.fillStyle = '#333'; ctx.fillRect(x - 3, y - 20, 4, 26);
  block(x - 8, y - 30, 16, 24, '#2b2d42', 3, 3);
  ctx.fillStyle = blink === 0 ? '#ff3b30' : '#5a2a2a';
  ctx.beginPath(); ctx.arc(x - 0, y - 24, 4, 0, 7); ctx.fill();
  ctx.fillStyle = blink === 1 ? '#ff3b30' : '#5a2a2a';
  ctx.beginPath(); ctx.arc(x - 0, y - 14, 4, 0, 7); ctx.fill();
}

function drawCoin(c, y) {
  const cx = c * T + T / 2, cy = y + 4 + Math.sin(time * 4 + c) * 2;
  ctx.fillStyle = 'rgba(0,0,0,.2)';
  ctx.beginPath(); ctx.ellipse(cx, y + 17, 9, 3, 0, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(Math.max(.18, Math.abs(Math.cos(time * 3 + c))), 1);
  ctx.fillStyle = '#ffcf33'; ctx.strokeStyle = '#c98f00'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffe680';
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill();
  ctx.restore();
}

function drawPencil(cx, gy, sx, sy, face, lift) {
  // shadow
  const sh = 1 - Math.min(.5, lift / 60);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(cx, gy, 11 * sh * sx, 4 * sh, 0, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(cx, gy - lift);
  ctx.scale(sx, sy);
  const u = T * .92;
  ctx.fillStyle = '#f2c48d';
  ctx.beginPath(); ctx.moveTo(-.24 * u, -.2 * u); ctx.lineTo(.24 * u, -.2 * u); ctx.lineTo(0, 0); ctx.fill();
  ctx.fillStyle = '#3a3a46';
  ctx.beginPath(); ctx.moveTo(-.08 * u, -.06 * u); ctx.lineTo(.08 * u, -.06 * u); ctx.lineTo(0, 0); ctx.fill();
  ctx.fillStyle = '#ffd93b'; ctx.fillRect(-.24 * u, -.8 * u, .48 * u, .6 * u);
  ctx.fillStyle = '#f5b800'; ctx.fillRect(.07 * u, -.8 * u, .17 * u, .6 * u);
  ctx.fillStyle = '#ffe980'; ctx.fillRect(-.24 * u, -.8 * u, .06 * u, .6 * u);
  ctx.fillStyle = '#c3cbd6'; ctx.fillRect(-.24 * u, -.9 * u, .48 * u, .1 * u);
  ctx.fillStyle = '#9aa4b2'; ctx.fillRect(-.24 * u, -.86 * u, .48 * u, .02 * u);
  ctx.fillStyle = '#ff8fa8'; rr(-.24 * u, -1.03 * u, .48 * u, .13 * u, 4); ctx.fill();
  // eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-.09 * u, -.52 * u, .075 * u, 0, 7); ctx.arc(.09 * u, -.52 * u, .075 * u, 0, 7); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc((-.09 + face * .025) * u, -.52 * u, .035 * u, 0, 7); ctx.arc((.09 + face * .025) * u, -.52 * u, .035 * u, 0, 7); ctx.fill();
  ctx.strokeStyle = '#7a4a00'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, -.4 * u, .06 * u, .1, Math.PI - .1); ctx.stroke();
  ctx.restore();
}

function drawPlayer(y0, r) {
  const x = r.x * T + T / 2;
  let gy = y0 + .3 * T, sx = 1, sy = 1, lift = r.lift;
  if (state === 'dead' && dead.type !== 'erased') {
    if (dead.type === 'car' || dead.type === 'train') {
      const k = Math.min(1, dead.t * 8);
      sy = 1 - .82 * k; sx = 1 + .6 * k; lift = 0;
    } else {
      // sinking
      const k = Math.min(1, dead.t * 1.4);
      ctx.save();
      ctx.beginPath(); ctx.rect(x - 40, gy - 70, 80, 70 - k * 0 + 4 - 0); ctx.clip();
      ctx.globalAlpha = 1 - k * .8;
      drawPencil(x, gy + k * 44, 1, 1, player.face, 0);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const rad = (dead.t * 40 + i * 10) % 34;
        ctx.globalAlpha = 1 - rad / 34;
        ctx.beginPath(); ctx.ellipse(x, gy + 2, rad, rad * .4, 0, 0, 7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
  } else if (player.sq > 0) {
    const k = player.sq / .3;
    sy = 1 - .3 * k * Math.cos((1 - k) * Math.PI * 1.5);
    sx = 1 + (1 - sy) * .8;
  }
  const bob = lanes[player.row].type === 'river' && state === 'play' ? Math.sin(time * 5) * 1.5 : 0;
  playerScreen = { x, y: y0 };
  drawPencil(x, gy + bob, sx, sy, player.face, lift);
}

function drawEraser(pY) {
  if (idleT < ERASER_START) return;
  const p = clamp((idleT - ERASER_START) / (IDLE_LIMIT - ERASER_START), 0, 1.4);
  const startY = H + 10, endY = pY - T * 1.25;
  const top = startY + (endY - startY) * p;
  const wob = Math.sin(time * 14) * 3 * Math.min(1, p);
  ctx.save();
  ctx.translate(wob, 0);
  // top face
  ctx.fillStyle = '#ffc2d0'; ctx.fillRect(-20, top - 22, W + 40, 24);
  // front face
  ctx.fillStyle = '#ff8da1'; ctx.fillRect(-20, top + 2, W + 40, H);
  // sleeve
  ctx.fillStyle = '#3b6fe0'; ctx.fillRect(-20, top + 52, W + 40, 60);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 30px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('E R A S E R', W / 2, top + 92);
  // crumbs
  ctx.fillStyle = '#ffb5c4';
  for (let i = 0; i < 12; i++) ctx.fillRect(i * 41 + (i * 17) % 13, top - 30 - (i * 7) % 11, 6, 5);
  ctx.restore();
  if (state === 'play' && !panelOpen && idleT > ERASER_START && Math.floor(time * 4) % 2 === 0) {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d6203a'; ctx.lineWidth = 5;
    ctx.font = '900 30px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.strokeText('KEEP MOVING!', W / 2, pY + T * 3.2);
    ctx.fillText('KEEP MOVING!', W / 2, pY + T * 3.2);
  }
}

function draw() {
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.fillStyle = '#6fcf47'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - .5) * shake * 30, (Math.random() - .5) * shake * 30);
  const pY = H * .66;
  const rMin = Math.floor(camRow - (H - pY) / T) - 2, rMax = Math.ceil(camRow + pY / T) + 2;
  const yOf = r => pY + (camRow - r) * T;
  for (let r = rMin; r <= rMax; r++) if (lanes[r]) drawLaneBg(lanes[r], yOf(r));
  const pr = rendered();
  for (let r = rMax; r >= rMin; r--) {
    const l = lanes[r];
    if (!l) continue;
    const y = yOf(r);
    if (l.type === 'grass') {
      for (let c = 0; c < COLS; c++) if (l.trees[c]) drawTree(c, y);
    } else if (l.type === 'road') {
      for (const o of l.objs) drawCar(o, wrapX(o.x0 + l.off), y, l.dir);
    } else if (l.type === 'river') {
      for (const o of l.objs) drawLog(wrapX(o.x0 + l.off), y, o.w);
    } else if (l.type === 'rail') {
      drawSignal(l, y);
      if (l.state === 'pass') drawTrain(l, y);
    }
    if (l.coin != null && !l.taken) drawCoin(l.coin, y);
    if (r === player.row) drawPlayer(pY + (camRow - pr.row) * T, pr);
  }
  drawEraser(pY);
  for (const f of floats) {
    ctx.globalAlpha = 1 - f.t / .9;
    ctx.fillStyle = '#ffe066'; ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = 4;
    ctx.font = '900 24px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    const fy = yOf(f.row) - 30 - f.t * 40;
    ctx.strokeText(f.text, f.x * T + T / 2, fy); ctx.fillText(f.text, f.x * T + T / 2, fy);
    ctx.globalAlpha = 1;
  }
  if (panelOpen && state === 'play') {
    ctx.fillStyle = 'rgba(120,190,255,.16)'; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2b6fb8'; ctx.lineWidth = 5;
    ctx.font = '900 22px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.strokeText('TIME FROZEN', W / 2, pY + T * 3.2); ctx.fillText('TIME FROZEN', W / 2, pY + T * 3.2);
  }
  ctx.restore();
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- shop ui ----------
function renderShop() {
  $('shopCoins').textContent = save.coins;
  const list = $('shopList');
  list.textContent = '';
  for (const it of SHOP) {
    const l = lvl(it.id), maxed = l >= it.max, c = upCost(it);
    const row = document.createElement('div'); row.className = 'shopRow';
    const info = document.createElement('div'); info.className = 'info';
    const nm = document.createElement('b'); nm.textContent = it.name;
    const ds = document.createElement('span'); ds.textContent = it.desc + ' \u00b7 ' + it.now(l);
    const pp = document.createElement('div'); pp.className = 'lv';
    for (let i = 0; i < it.max; i++) { const p = document.createElement('i'); if (i < l) p.className = 'on'; pp.appendChild(p); }
    info.append(nm, ds, pp);
    const btn = document.createElement('button'); btn.className = 'buy';
    btn.textContent = maxed ? 'MAX' : '\ud83e\ude99 ' + c;
    btn.disabled = maxed || save.coins < c;
    btn.addEventListener('click', () => {
      if (maxed || save.coins < c) return;
      save.coins -= c; save.up[it.id] = l + 1; persist();
      renderShop(); updateHud();
    });
    row.append(info, btn);
    list.appendChild(row);
  }
}
function openShop() { renderShop(); shopScreen.hidden = false; }
function closeShop() { shopScreen.hidden = true; applyUpgrades(); }

// ---------- input ----------
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (!shopScreen.hidden) { if (k === 'escape') closeShop(); return; }
  const menuOpen = !startScreen.hidden || !overScreen.hidden;
  if (menuOpen) {
    if ((k === 'enter' || k === ' ') && (!startScreen.hidden || performance.now() - overAt > 600)) {
      e.preventDefault();
      start();
    }
    return;
  }
  if (state !== 'play') return;
  if (k === 'arrowleft' || k === 'a') { e.preventDefault(); moveSide(-1); }
  else if (k === 'arrowright' || k === 'd') { e.preventDefault(); moveSide(1); }
  else if (k === 'arrowup' || k === 'w') { e.preventDefault(); requestForward(); }
  else if (k === 'e' || k === ' ') { e.preventDefault(); requestEarn(); }
  else if (k === 'escape' && panelOpen) closePanel();
  else if (k >= '1' && k <= '4') answer(+k - 1);
});

let ptr = null;
stage.addEventListener('pointerdown', e => {
  if (e.target.closest('button') || e.target.closest('.screen')) return;
  ptr = { x: e.clientX, y: e.clientY };
});
stage.addEventListener('pointercancel', () => { ptr = null; });
stage.addEventListener('pointerup', e => {
  if (!ptr) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  ptr = null;
  if (state !== 'play') return;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > 28 && ax > ay * 1.2) { moveSide(dx < 0 ? -1 : 1); return; }
  if (dy < -28 && ay > ax) { requestForward(); return; }
  if (ax < 16 && ay < 16) {
    const rect = stage.getBoundingClientRect();
    const tx = (e.clientX - rect.left) / scale, ty = (e.clientY - rect.top) / scale;
    if (ty < playerScreen.y - T * .7) requestForward();
    else if (Math.abs(ty - playerScreen.y) <= T * 1.1) moveSide(tx < playerScreen.x ? -1 : 1);
  }
});
document.addEventListener('contextmenu', e => e.preventDefault());

earnBtn.addEventListener('click', () => { requestEarn(); earnBtn.blur(); });
$('closeBtn').addEventListener('click', closePanel);
$('shopBtn').addEventListener('click', openShop);
$('shopBtn2').addEventListener('click', openShop);
$('shopBack').addEventListener('click', closeShop);
$('playBtn').addEventListener('click', start);
$('againBtn').addEventListener('click', start);

// ---------- boot ----------
resetWorld();
bestAtStart = best;
requestAnimationFrame(frame);
})();
