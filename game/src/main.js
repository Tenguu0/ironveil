// IRONVEIL — round-based tactical FPS.
// 5v5 (you + 4 Veil bots vs 5 Sentinel bots), first to 5 rounds. Win a round by
// eliminating the enemy team, or by planting the charge at Site A/B and letting it
// blow (defenders win by defusing it or running the clock out). Money between
// rounds buys weapons and gear. Accuracy beats speed: moving fire and long sprays
// bloom your spread, standing still and tapping stays tight.
// Fixed 60 Hz simulation separate from render; one state store (G) below.
// ?shot=menu|play|plant|win with &seed=N stages a deterministic frame, renders it
// twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, range, clamp } from './rng.js';
import { createWorld, collideCircle } from './world.js';
import { createPlayer } from './player.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { WEAPONS, GEAR, ECONOMY } from './weapons.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(seed * 7919 + 13);

// ---- Renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

// ---- Single state store ----
const G = {
  phase: 'menu',            // menu | buy | live | over | match
  round: 1,
  score: { veil: 0, sent: 0 },
  money: ECONOMY.startMoney,
  roundT: ECONOMY.buyTime,
  planted: false,
  plantSite: null,
  explodeT: 0,
  beepT: 0,
  overT: 0,
  overReason: '',
  matchWinner: null,
  playerAlive: true,
  playerHp: 100,
  playerArmor: 0,
  ownedWeapons: ['vesper'],
  currentWeapon: 'vesper',
  weaponState: {},          // id -> {mag, reserve}
  flash: 0, smoke: 0, kevlar: false,
  channel: null,            // player channel {kind, t, total}
  bloom: 0,
  kills: 0, deaths: 0,
  started: false,
};
for (const id of Object.keys(WEAPONS)) {
  G.weaponState[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserveMax };
}

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio();
const player = createPlayer(world.colliders);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

// Smoke blocks line of sight: wrap the world's LOS check.
const smokes = []; // {x, z, t, mesh}
const rawLOS = world.hasLOS;
world.hasLOS = (a, b) => {
  if (!rawLOS(a, b)) return false;
  for (const s of smokes) {
    if (segmentNearPoint(a, b, s.x, 1.2, s.z, 3.2)) return false;
  }
  return true;
};
function segmentNearPoint(a, b, px, py, pz, r) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1;
  let t = ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / len2;
  t = clamp(t, 0, 1);
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  return dx * dx + dy * dy + dz * dz < r * r;
}

// ---- Bots ----
const bots = createBots(scene, world, rng, {
  onBotShot(bot, from, aim) {
    spawnTracer(from, aim, bot.team === 'veil' ? 0x9fd68a : 0xff9a7a);
    if (!shot) audio.distantShot();
  },
  onBotHit(bot, target, dmg, head) {
    if (target.kind === 'player') damagePlayer(dmg, bot.name);
    else {
      const victim = target.ref;
      const killed = bots.damage(victim, dmg, head);
      if (killed) onKill(bot.name, victim.name, head, bot.team, victim.team);
    }
  },
  onChannelDone(bot, kind) {
    if (kind === 'plant') {
      plantCharge(bot.siteTarget || 'A', bot);
    } else if (kind === 'defuse') {
      defuseCharge(bot);
    }
  },
});

// ---- Viewmodel (simple gun, camera-attached) ----
const viewmodel = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x23232c, roughness: 0.6, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf2a33c, roughness: 0.5, metalness: 0.3 });
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
  barrel.position.set(0, -0.02, -0.3);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.34), dark);
  body.position.set(0, -0.02, -0.05);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.1), dark);
  grip.position.set(0, -0.14, 0.02);
  grip.rotation.x = 0.25;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.02, 0.3), accent);
  stripe.position.set(0, 0.055, -0.05);
  viewmodel.add(barrel, body, grip, stripe);
  viewmodel.position.set(0.28, -0.26, -0.5);
  camera.add(viewmodel);
}
const muzzleLight = new THREE.PointLight(0xffc36b, 0, 9, 1.6);
muzzleLight.position.set(0.28, -0.2, -0.9);
camera.add(muzzleLight);

// ---- Tracers / impacts / smoke visuals (pooled, no per-frame allocation) ----
const tracers = [];
{
  const mat = new THREE.LineBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 24; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, mat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
}
let tracerIdx = 0;
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
function spawnTracer(from, to, color) {
  const t = tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % tracers.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.9;
  t.line.visible = true;
  t.life = 0.09;
}

const impacts = [];
{
  const geo = new THREE.TetrahedronGeometry(0.09);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  for (let i = 0; i < 16; i += 1) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    impacts.push({ mesh: m, life: 0, vel: new THREE.Vector3() });
  }
}
let impactIdx = 0;
function spawnImpact(point, normal) {
  const s = impacts[impactIdx];
  impactIdx = (impactIdx + 1) % impacts.length;
  s.mesh.position.copy(point);
  s.vel.set(normal.x + range(rng, -1, 1), Math.abs(normal.y) + range(rng, 0.5, 1.5), normal.z + range(rng, -1, 1)).multiplyScalar(2.2);
  s.mesh.visible = true;
  s.life = 0.35;
}

const smokeMeshes = [];
{
  const geo = new THREE.SphereGeometry(1, 12, 10);
  for (let i = 0; i < 10; i += 1) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8f8a96, transparent: true, opacity: 0.5, roughness: 1 }));
    m.visible = false;
    m.castShadow = false;
    scene.add(m);
    smokeMeshes.push(m);
  }
}
function spawnSmoke(x, z) {
  const mesh = smokeMeshes.find((m) => !m.visible);
  const s = { x, z, t: 12 };
  smokes.push(s);
  if (mesh) {
    mesh.position.set(x, 1.6, z);
    mesh.scale.set(2.6, 2.0, 2.6);
    mesh.visible = true;
    s.mesh = mesh;
  }
  return s;
}
function clearSmokes() {
  for (const s of smokes) if (s.mesh) s.mesh.visible = false;
  smokes.length = 0;
}

// Charge mesh (appears when planted).
const chargeGroup = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0xf2a33c, roughness: 0.4, metalness: 0.4, emissive: 0x662200 }));
  box.position.y = 0.18;
  const light = new THREE.PointLight(0xf2a33c, 6, 10, 1.8);
  light.position.y = 0.8;
  chargeGroup.add(box, light);
  chargeGroup.visible = false;
  scene.add(chargeGroup);
}

// ---- Input ----
const keys = new Set();
const input = { lookX: 0, lookY: 0, firing: false, locked: false, zoom: false };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyB' && (G.phase === 'buy' || G.phase === 'live') && !shot) toggleBuy();
  if (e.code === 'KeyR') reloadWeapon();
  if (e.code === 'KeyM') { const m = audio.toggleMute(); hud.toast(m ? 'Sound muted' : 'Sound on'); }
  if (e.code === 'KeyG') throwFlash();
  if (e.code === 'KeyH') throwSmoke();
  if (e.code === 'Digit1') equipWeapon(0);
  if (e.code === 'Digit2') equipWeapon(1);
  if (e.code === 'Digit3') equipWeapon(2);
  if (e.code === 'Digit4') equipWeapon(3);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); input.firing = false; });
window.addEventListener('mousemove', (e) => {
  if (!input.locked) return;
  input.lookX += e.movementX;
  input.lookY += e.movementY;
});
window.addEventListener('mousedown', (e) => {
  if (input.locked && e.button === 0) input.firing = true;
  if (input.locked && e.button === 2) input.zoom = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.firing = false;
  if (e.button === 2) input.zoom = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  input.locked = document.pointerLockElement === renderer.domElement;
  if (!input.locked) { keys.clear(); input.firing = false; }
  if (!shot) onLockChange(input.locked);
});
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (G.phase === 'match') { resetMatch(); }
  if (G.phase === 'menu') { startMatch(); }
  renderer.domElement.requestPointerLock();
});

function onLockChange(locked) {
  if (locked) { hud.hideOverlay(); hud.showBuy(false); }
  else if (G.phase === 'menu') hud.showOverlay('start');
  else if (G.phase === 'match') hud.showOverlay('match', { title: matchTitle(), sub: matchSub() });
  else if (G.phase !== 'over') hud.showOverlay('paused');
}

// ---- Shooting ----
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
let lastShotT = 0;
let reloadUntil = 0;
let now = 0;

function currentWeaponDef() { return WEAPONS[G.currentWeapon]; }
function currentWeaponState() { return G.weaponState[G.currentWeapon]; }

function spreadNow() {
  const w = currentWeaponDef();
  const move = clamp(player.state.speed / 4.6, 0, 1);
  let s = w.spread + w.moveSpread * move + G.bloom;
  if (player.state.aiming) s *= 0.55;
  if (player.state.crouched) s *= 0.8;
  return s;
}

function shoot() {
  const w = currentWeaponDef();
  const st = currentWeaponState();
  if (now < reloadUntil) return;
  if (now - lastShotT < w.fireInterval) return;
  if (st.mag <= 0) { audio.dryClick(); reloadWeapon(); return; }
  lastShotT = now;
  st.mag -= 1;
  G.bloom = Math.min(0.05, G.bloom + (w.kind === 'sniper' ? 0.035 : 0.006));
  player.eyePos(_eye);
  camera.getWorldDirection(_dir);
  const sp = spreadNow();
  _dir.x += (rng() * 2 - 1) * sp;
  _dir.y += (rng() * 2 - 1) * sp;
  _dir.z += (rng() * 2 - 1) * sp;
  _dir.normalize();
  const muzzle = _eye.clone().addScaledVector(_dir, 0.6);
  // Raycast against world + bot hitboxes.
  scene.updateMatrixWorld(true);
  raycaster.set(_eye, _dir);
  const targets = world.shootables.concat(bots.list.flatMap((b) => b.alive ? [b.body, b.head] : []));
  const hit = raycaster.intersectObjects(targets, false)[0];
  const end = hit ? hit.point : _eye.clone().addScaledVector(_dir, w.range);
  spawnTracer(muzzle, end, 0xffe9b0);
  muzzleLight.intensity = 14;
  setTimeout(() => { muzzleLight.intensity = 0; }, 40);
  audio.shot(w.kind);
  player.recoil(w.recoil * (player.state.aiming ? 0.6 : 1), (rng() * 2 - 1) * w.recoil * 0.4);
  viewmodel.position.z = -0.44;
  if (hit) {
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const head = hit.object.userData.part === 'head';
      const dmg = w.damage * (head ? w.headMult : 1);
      const killed = bots.damage(bot, dmg, head);
      hud.hitMarker(killed);
      audio.hit(killed);
      if (killed) onKill('You', bot.name, head, 'veil', 'sentinel');
    } else {
      spawnImpact(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));
    }
  }
  hud.setAmmo(st.mag, st.reserve, w.name);
}

function reloadWeapon() {
  const w = currentWeaponDef();
  const st = currentWeaponState();
  if (now < reloadUntil || st.mag === w.mag || st.reserve <= 0) return;
  reloadUntil = now + w.reloadTime;
  audio.reload();
  const need = w.mag - st.mag;
  const take = Math.min(need, st.reserve);
  st.mag += take;
  st.reserve -= take;
  setTimeout(() => hud.setAmmo(st.mag, st.reserve, w.name), w.reloadTime * 1000);
}

function equipWeapon(idx) {
  const ids = G.ownedWeapons;
  if (idx < 0 || idx >= ids.length) return;
  G.currentWeapon = ids[idx];
  const st = currentWeaponState();
  hud.setAmmo(st.mag, st.reserve, currentWeaponDef().name);
  hud.toast(`${currentWeaponDef().name} equipped`);
}

// ---- Damage / kills ----
function damagePlayer(dmg, fromName) {
  if (!G.playerAlive || G.phase !== 'live') return;
  let remaining = dmg;
  if (G.playerArmor > 0) {
    const absorbed = Math.min(G.playerArmor, remaining * 0.5);
    G.playerArmor -= absorbed;
    remaining -= absorbed;
  }
  G.playerHp -= remaining;
  hud.damageFlash();
  audio.hurt();
  hud.setHealth(G.playerHp, G.playerArmor);
  if (G.playerHp <= 0) {
    G.playerHp = 0;
    G.playerAlive = false;
    G.deaths += 1;
    hud.toast(`Eliminated by ${fromName}`);
    hud.setHealth(0, G.playerArmor);
    checkRoundEnd();
  }
}

function onKill(killer, victim, headshot, killerTeam, victimTeam) {
  hud.killfeed(killer, victim, headshot, killerTeam);
  if (killer === 'You') {
    G.money += ECONOMY.killReward;
    G.kills += 1;
    hud.setMoney(G.money);
  }
  checkRoundEnd();
}

// ---- Plant / defuse ----
function nearSite(x, z, siteId) {
  const s = world.sites[siteId];
  return Math.hypot(x - s.x, z - s.z) < 3.2;
}

function plantCharge(siteId, byBot) {
  if (G.planted || G.phase !== 'live') return;
  G.planted = true;
  G.plantSite = siteId;
  G.explodeT = ECONOMY.explodeTime;
  G.phase = 'live';
  const s = world.sites[siteId];
  chargeGroup.position.set(s.x, 0, s.z);
  chargeGroup.visible = true;
  world.sites[siteId].ring.material.color.setHex(0xff4444);
  audio.plantDone();
  hud.banner('CHARGE PLANTED', `Site ${siteId} — Sentinels must defuse it`, 3000);
  if (byBot) hud.toast(`${byBot.name} planted the charge at Site ${siteId}`);
  else { G.money += ECONOMY.plantReward; hud.setMoney(G.money); }
}

function defuseCharge(byBot) {
  if (!G.planted) return;
  G.planted = false;
  chargeGroup.visible = false;
  world.sites[G.plantSite].ring.material.color.setHex(0xf2a33c);
  endRound('sent', `Charge defused by ${byBot ? byBot.name : 'Sentinels'}`);
}

function explodeCharge() {
  G.planted = false;
  chargeGroup.visible = false;
  world.sites[G.plantSite].ring.material.color.setHex(0xf2a33c);
  audio.explosion();
  hud.flashWhite();
  endRound('veil', `Charge detonated at Site ${G.plantSite}`);
}

// ---- Rounds ----
function startMatch() {
  G.score = { veil: 0, sent: 0 };
  G.round = 1;
  G.money = ECONOMY.startMoney;
  G.ownedWeapons = ['vesper'];
  G.currentWeapon = 'vesper';
  for (const id of Object.keys(WEAPONS)) G.weaponState[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserveMax };
  G.kills = 0; G.deaths = 0;
  G.started = true;
  startRound();
}

function resetMatch() { startMatch(); }

function startRound() {
  G.phase = 'buy';
  G.roundT = ECONOMY.buyTime;
  G.planted = false;
  G.plantSite = null;
  G.channel = null;
  clearSmokes();
  chargeGroup.visible = false;
  for (const id of ['A', 'B']) world.sites[id].ring.material.color.setHex(0xf2a33c);
  bots.resetRound(G.round);
  // Respawn player at attacker spawn.
  const spawn = world.attackerSpawns[1];
  player.state.position.x = spawn[0];
  player.state.position.z = spawn[1];
  player.state.yaw = 0; // yaw 0 faces -z, toward the defender side
  player.state.pitch = 0;
  G.playerAlive = true;
  G.playerHp = 100;
  G.playerArmor = G.kevlar ? 100 : 0;
  // Refill current weapon reserve partially between rounds.
  const st = currentWeaponState();
  st.reserve = Math.max(st.reserve, currentWeaponDef().reserveMax);
  hud.setHealth(G.playerHp, G.playerArmor);
  hud.setAmmo(st.mag, st.reserve, currentWeaponDef().name);
  hud.setMoney(G.money);
  hud.setScore(G.score.veil, G.score.sent);
  hud.setAlive(bots.aliveCount('veil') + 1, bots.aliveCount('sentinel'));
  document.getElementById('buy-round').textContent = String(G.round);
  if (!shot) {
    hud.buildBuy(G.money, { weapons: G.ownedWeapons, kevlar: G.kevlar, flash: G.flash, smoke: G.smoke }, buyItem);
    hud.showBuy(true);
    hud.banner(`ROUND ${G.round}`, 'Buy phase — press B to close the shop', 2400);
  }
}

function endRound(winner, reason) {
  if (G.phase === 'over' || G.phase === 'match') return;
  G.phase = 'over';
  G.overT = 4.5;
  G.overReason = reason;
  G.score[winner] += 1;
  const playerWon = winner === 'veil';
  G.money += playerWon ? ECONOMY.winReward : ECONOMY.lossReward;
  hud.setMoney(G.money);
  hud.setScore(G.score.veil, G.score.sent);
  hud.banner(playerWon ? 'ROUND WON' : 'ROUND LOST', reason, 4200);
  if (playerWon) audio.roundWin(); else audio.roundLose();
  hud.showBuy(false);
  hud.setChannel(null);
  hud.setPrompt(null);
}

function checkRoundEnd() {
  if (G.phase !== 'live' && G.phase !== 'buy') return;
  const veilAlive = bots.aliveCount('veil') + (G.playerAlive ? 1 : 0);
  const sentAlive = bots.aliveCount('sentinel');
  hud.setAlive(veilAlive, sentAlive);
  if (sentAlive === 0) endRound('veil', 'Sentinels eliminated');
  else if (veilAlive === 0) endRound('sent', 'Veil eliminated');
}

function matchTitle() {
  return G.score.veil > G.score.sent ? 'VEIL WINS THE MATCH' : 'SENTINELS WIN THE MATCH';
}
function matchSub() {
  return `Final score ${G.score.veil} – ${G.score.sent} · ${G.kills} eliminations · ${G.deaths} deaths`;
}

// ---- Buy ----
function toggleBuy() {
  const menu = document.getElementById('buy-menu');
  const open = menu.hidden;
  if (open && G.phase !== 'buy') { hud.toast('The shop only opens between rounds'); return; }
  if (open) hud.buildBuy(G.money, { weapons: G.ownedWeapons, kevlar: G.kevlar, flash: G.flash, smoke: G.smoke }, buyItem);
  hud.showBuy(open);
}

function buyItem(key) {
  const w = WEAPONS[key];
  if (w) {
    if (G.ownedWeapons.includes(key)) { equipWeapon(G.ownedWeapons.indexOf(key)); return; }
    if (G.money < w.price) { hud.toast('Not enough money'); return; }
    G.money -= w.price;
    G.ownedWeapons.push(key);
    G.currentWeapon = key;
    audio.buy();
    hud.toast(`${w.name} purchased`);
  } else if (key === 'kevlar') {
    if (G.kevlar || G.money < GEAR.kevlar.price) { hud.toast(G.kevlar ? 'Kevlar already owned' : 'Not enough money'); return; }
    G.money -= GEAR.kevlar.price;
    G.kevlar = true;
    G.playerArmor = 100;
    hud.setHealth(G.playerHp, G.playerArmor);
    audio.buy();
    hud.toast('Kevlar vest equipped');
  } else if (key === 'flash' || key === 'smoke') {
    const g = GEAR[key];
    if (G.money < g.price) { hud.toast('Not enough money'); return; }
    G.money -= g.price;
    if (key === 'flash') G.flash += 1; else G.smoke += 1;
    audio.buy();
    hud.toast(`${g.name} purchased`);
  }
  hud.setMoney(G.money);
  hud.updateBuyMoney(G.money);
  hud.buildBuy(G.money, { weapons: G.ownedWeapons, kevlar: G.kevlar, flash: G.flash, smoke: G.smoke }, buyItem);
  const st = currentWeaponState();
  hud.setAmmo(st.mag, st.reserve, currentWeaponDef().name);
}

// ---- Grenades ----
function throwFlash() {
  if (G.phase !== 'live' || !G.playerAlive || G.flash <= 0) return;
  G.flash -= 1;
  player.eyePos(_eye);
  camera.getWorldDirection(_dir);
  const px = _eye.x + _dir.x * 14, pz = _eye.z + _dir.z * 14;
  let flashed = 0;
  for (const b of bots.list) {
    if (!b.alive || b.team !== 'sentinel') continue;
    const d = Math.hypot(b.pos.x - px, b.pos.z - pz);
    if (d < 22) { b.flashed = range(rng, 2, 4); flashed += 1; }
  }
  hud.toast(flashed ? `Flash! ${flashed} Sentinel${flashed > 1 ? 's' : ''} blinded` : 'Flash thrown — no one looking');
  audio.beep(false);
}

function throwSmoke() {
  if (G.phase !== 'live' || !G.playerAlive || G.smoke <= 0) return;
  G.smoke -= 1;
  player.eyePos(_eye);
  camera.getWorldDirection(_dir);
  const px = _eye.x + _dir.x * 16, pz = _eye.z + _dir.z * 16;
  const cx = clamp(px, -30, 30), cz = clamp(pz, -20, 20);
  spawnSmoke(cx, cz);
  hud.toast('Smoke deployed');
}

// ---- Bot objective behaviour (driven from main tick) ----
let objectiveT = 0;
function objectiveTick(dt) {
  objectiveT -= dt;
  if (objectiveT > 0 || G.phase !== 'live') return;
  objectiveT = 1;
  // Attacker bots plant when they reach a site unopposed.
  if (!G.planted) {
    for (const b of bots.list) {
      if (!b.alive || b.team !== 'veil' || b.channel) continue;
      for (const siteId of ['A', 'B']) {
        if (nearSite(b.pos.x, b.pos.z, siteId)) {
          b.siteTarget = siteId;
          bots.startPlant(b, siteId);
          hud.toast(`${b.name} is planting at Site ${siteId}`);
          return;
        }
      }
    }
  } else {
    // A defender bot defuses when it reaches the planted charge.
    for (const b of bots.list) {
      if (!b.alive || b.team !== 'sentinel' || b.channel) continue;
      if (nearSite(b.pos.x, b.pos.z, G.plantSite)) {
        bots.startDefuse(b);
        hud.toast(`${b.name} is defusing the charge!`);
        return;
      }
    }
  }
}

// ---- Player channel (plant) ----
function channelTick(dt) {
  // Player planting: hold E near a site.
  const nearA = G.playerAlive && nearSite(player.state.position.x, player.state.position.z, 'A');
  const nearB = G.playerAlive && nearSite(player.state.position.x, player.state.position.z, 'B');
  const site = nearA ? 'A' : nearB ? 'B' : null;
  if (G.phase === 'live' && !G.planted && site) {
    hud.setPrompt(`Hold <b>E</b> to plant the charge — Site ${site}`);
    if (keys.has('KeyE')) {
      if (!G.channel) G.channel = { kind: 'plant', t: 0, total: ECONOMY.plantTime, site };
      G.channel.t += dt;
      hud.setChannel('PLANTING CHARGE', G.channel.t / G.channel.total);
      if (Math.floor(G.channel.t * 2) !== Math.floor((G.channel.t - dt) * 2)) audio.beep(false);
      if (G.channel.t >= G.channel.total) {
        plantCharge(site, null);
        G.channel = null;
        hud.setChannel(null);
      }
      return;
    }
  }
  if (G.channel) { G.channel = null; hud.setChannel(null); }
  if (G.phase === 'live' && G.planted) {
    const s = world.sites[G.plantSite];
    const d = Math.hypot(player.state.position.x - s.x, player.state.position.z - s.z);
    hud.setPrompt(d < 6 ? 'Charge planted — defend it!' : `Charge live at Site ${G.plantSite} — ${Math.ceil(G.explodeT)}s to detonation`);
  } else if (G.phase === 'live' && !site) {
    hud.setPrompt(null);
  }
}

// ---- Main loop ----
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;
let hudT = 0;
let minimapT = 0;

function syncCamera() {
  const s = player.state;
  camera.position.set(s.position.x, s.position.y + s.eye, s.position.z);
  camera.rotation.set(s.pitch + s.recoilPitch, s.yaw + s.recoilYaw, 0, 'YXZ');
  // Zoom (right mouse / sniper scope feel).
  const targetFov = input.zoom ? 74 / currentWeaponDef().zoom : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

function step(dt) {
  now += dt;
  if (G.phase === 'buy') {
    G.roundT -= dt;
    if (G.roundT <= 0) {
      G.phase = 'live';
      G.roundT = ECONOMY.roundTime;
      hud.showBuy(false);
      hud.banner(`ROUND ${G.round} — GO`, 'Plant the charge or eliminate the Sentinels', 2200);
      audio.beep(true);
    }
  } else if (G.phase === 'live') {
    G.roundT -= dt;
    if (G.planted) {
      G.explodeT -= dt;
      G.beepT -= dt;
      if (G.beepT <= 0) { G.beepT = 1; audio.beep(false); }
      if (G.explodeT <= 0) { explodeCharge(); return; }
    } else if (G.roundT <= 0) {
      endRound('sent', 'Time expired — charge never planted');
      return;
    }
    channelTick(dt);
    objectiveTick(dt);
  } else if (G.phase === 'over') {
    G.overT -= dt;
    if (G.overT <= 0) {
      if (G.score.veil >= ECONOMY.roundsToWin || G.score.sent >= ECONOMY.roundsToWin) {
        G.phase = 'match';
        hud.showOverlay('match', { title: matchTitle(), sub: matchSub() });
        if (document.pointerLockElement) document.exitPointerLock();
      } else {
        G.round += 1;
        startRound();
      }
    }
  }

  const frozenPlayer = G.phase === 'menu' || G.phase === 'over' || G.phase === 'match' || !G.playerAlive;
  player.step(dt, keys, frozenPlayer);
  // Look + fire.
  const look = { x: input.lookX, y: input.lookY };
  input.lookX = 0; input.lookY = 0;
  if (G.playerAlive && (G.phase === 'live' || G.phase === 'buy')) player.look(look.x, look.y);
  if (input.firing && G.phase === 'live' && G.playerAlive && !shot) shoot();
  else if (input.firing && shot) { /* shot mode drives its own shots */ }

  // Weapon reload timing + bloom decay.
  if (now >= reloadUntil && reloadUntil > 0) { reloadUntil = 0; }
  G.bloom = Math.max(0, G.bloom - dt * 0.03);
  viewmodel.position.z += (-0.5 - viewmodel.position.z) * Math.min(1, dt * 14);

  bots.step(dt, player.state, G.playerAlive && G.phase === 'live', G);

  // Tracers / impacts / smoke decay.
  for (const t of tracers) {
    if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9; if (t.life <= 0) t.line.visible = false; }
  }
  for (const s of impacts) {
    if (s.life > 0) {
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.y -= 6 * dt;
      s.mesh.rotation.x += dt * 9;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }
  for (let i = smokes.length - 1; i >= 0; i -= 1) {
    const s = smokes[i];
    s.t -= dt;
    if (s.mesh) s.mesh.material.opacity = clamp(s.t / 12, 0, 1) * 0.4;
    if (s.t <= 0) { if (s.mesh) s.mesh.visible = false; smokes.splice(i, 1); }
  }
  chargeGroup.rotation.y += dt * 0.8;

  // HUD at 10 Hz.
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.1;
    hud.setTimer(G.phase === 'buy' ? G.roundT : G.phase === 'live' ? (G.planted ? G.explodeT : G.roundT) : G.roundT, G.phase === 'buy' ? 'buy' : G.phase === 'live' ? (G.planted ? 'planted' : 'live') : 'over');
    hud.setSpread(6 + spreadNow() * 900);
    hud.setAlive(bots.aliveCount('veil') + (G.playerAlive ? 1 : 0), bots.aliveCount('sentinel'));
  }
  minimapT -= dt;
  if (minimapT <= 0) {
    minimapT = 0.12;
    hud.drawMinimap(world, player.state.position, player.state.yaw, bots.list, G.planted, G.plantSite);
  }
  hud.tick(dt);
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - lastTime) / 1000, 0.1);
  lastTime = t;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const s = player.state;
  const dx = point.x - s.position.x;
  const dy = point.y - (s.position.y + s.eye);
  const dz = point.z - s.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  s.yaw = Math.atan2(-dx, -dz);
  s.pitch = Math.asin(clamp(dy / len, -1, 1));
  syncCamera();
}

// ---- Deterministic captures ----
function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  // Tag bot meshes for raycasts.
  tagBotMeshes();
  if (name === 'menu') {
    startMatch();
    G.phase = 'buy';
    G.roundT = ECONOMY.buyTime;
    player.state.position.x = 0; player.state.position.z = 18;
    player.state.yaw = 0; player.state.pitch = 0.02;
    settle(30);
    aimAt(new THREE.Vector3(8, 2.5, -12));
    hud.buildBuy(800, { weapons: ['vesper'], kevlar: false, flash: 0, smoke: 0 }, () => {});
    hud.showBuy(true);
    hud.setMoney(800);
    hud.setHealth(100, 0);
    hud.setAmmo(12, 48, 'Vesper P9');
    hud.setTimer(12, 'buy');
  } else if (name === 'play') {
    startMatch();
    G.phase = 'live';
    G.roundT = 78;
    G.money = 3500;
    G.ownedWeapons = ['vesper', 'halberd'];
    G.currentWeapon = 'halberd';
    G.weaponState.halberd = { mag: 24, reserve: 90 };
    player.state.position.x = -2; player.state.position.z = 6;
    player.state.yaw = 0; player.state.pitch = 0;
    settle(60);
    // Advance bots into mid so the firefight is visible, then stage shots.
    const foes = bots.list.filter((b) => b.team === 'sentinel' && b.alive);
    const friends = bots.list.filter((b) => b.team === 'veil' && b.alive);
    if (foes[0]) { foes[0].pos.set(-4, 0, -4); foes[0].mesh.group.position.set(-4, 0, -4); }
    if (foes[1]) { foes[1].pos.set(3, 0, -8); foes[1].mesh.group.position.set(3, 0, -8); }
    if (friends[0]) { friends[0].pos.set(-6, 0, 10); friends[0].mesh.group.position.set(-6, 0, 10); }
    settle(40);
    aimAt(new THREE.Vector3(-4, 1.4, -4));
    shoot();
    settle(6);
    aimAt(new THREE.Vector3(3, 1.4, -8));
    shoot();
    settle(10);
    G.playerHp = 76;
    hud.setHealth(76, 0);
    hud.setMoney(3500);
    hud.setAmmo(24, 90, 'Halberd AR');
    hud.setTimer(78, 'live');
    hud.killfeed('Ash', 'Fenn', false, 'veil');
    hud.killfeed('You', 'Grit', true, 'veil');
    hud.hitMarker(false);
    hud.setScore(0, 0);
    hud.setAlive(5, 3);
  } else if (name === 'plant') {
    startMatch();
    G.phase = 'live';
    G.roundT = 41;
    G.ownedWeapons = ['vesper', 'halberd'];
    G.currentWeapon = 'halberd';
    player.state.position.x = -18.5; player.state.position.z = -11;
    player.state.yaw = 0; player.state.pitch = 0;
    settle(30);
    spawnSmoke(-26, -9);
    const friends = bots.list.filter((b) => b.team === 'veil' && b.alive);
    if (friends[0]) { friends[0].pos.set(-24, 0, -16); friends[0].mesh.group.position.set(-24, 0, -16); }
    if (friends[1]) { friends[1].pos.set(-16, 0, -18); friends[1].mesh.group.position.set(-16, 0, -18); }
    aimAt(new THREE.Vector3(-22, 1.0, -14));
    G.channel = { kind: 'plant', t: 2.2, total: ECONOMY.plantTime, site: 'A' };
    hud.setChannel('PLANTING CHARGE', 2.2 / ECONOMY.plantTime);
    hud.setPrompt('Hold <b>E</b> to plant the charge — Site A');
    hud.setMoney(2100);
    hud.setAmmo(30, 120, 'Halberd AR');
    hud.setTimer(41, 'live');
    G.score.veil = 1;
  } else if (name === 'win') {
    startMatch();
    G.phase = 'over';
    G.overT = 60; // frozen capture: keep the round-over state from advancing
    G.score.veil = 1; G.score.sent = 0;
    G.round = 1;
    G.planted = false;
    const foes = bots.list.filter((b) => b.team === 'sentinel');
    if (foes[0]) { bots.damage(foes[0], 999, true); }
    if (foes[1]) { foes[1].pos.set(4, 0, -6); foes[1].mesh.group.position.set(4, 0, -6); }
    const allies = bots.list.filter((b) => b.team === 'veil' && b.alive);
    if (allies[0]) { allies[0].pos.set(-8, 0, -4); allies[0].mesh.group.position.set(-8, 0, -4); }
    if (allies[1]) { allies[1].pos.set(6, 0, -2); allies[1].mesh.group.position.set(6, 0, -2); }
    player.state.position.x = 0; player.state.position.z = 8;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -14));
    spawnSmoke(-16, -16);
    hud.setScore(1, 0);
    hud.setMoney(4050);
    hud.setAmmo(18, 90, 'Halberd AR');
    hud.setTimer(0, 'over');
    hud.setAlive(4, 0);
    hud.killfeed('You', 'Fenn', true, 'veil');
    hud.banner('ROUND WON', 'Sentinels eliminated — Site A is ours', 60000);
  }
  hud.setScore(G.score.veil, G.score.sent);
  paintTwiceThenReady();
}

function tagBotMeshes() {
  for (const b of bots.list) {
    b.body.userData.bot = b; b.body.userData.part = 'body';
    b.head.userData.bot = b; b.head.userData.part = 'head';
  }
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Boot ----
window.__ironveil = { G, player, bots, world, keys };
bots.resetRound(1);
tagBotMeshes();
syncCamera();
hud.setHealth(100, 0);
hud.setAmmo(12, 48, 'Vesper P9');
hud.setMoney(800);
hud.setScore(0, 0);
hud.setAlive(5, 5);
hud.setTimer(100, 'live');
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
