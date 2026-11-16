// Ironveil HUD: all DOM, updated from the single game state in main.js.
// Crosshair spread is dynamic (moves/fire bloom it); the minimap is a 2D canvas
// redrawn from the world + live positions. Buy menu is a real DOM panel.
import { WEAPONS, GEAR } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    hp: $('hp-value'), armor: $('armor-value'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money-value'), timer: $('timer-value'), roundLabel: $('round-label'),
    scoreVeil: $('score-veil'), scoreSent: $('score-sent'),
    aliveVeil: $('alive-veil'), aliveSent: $('alive-sent'),
    killfeed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    prompt: $('prompt'), channel: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    buy: $('buy-menu'), buyMoney: $('buy-money'), buyGrid: $('buy-grid'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'), playBtn: $('play'),
    minimap: $('minimap'), toast: $('toast'),
    flash: $('flash'), damage: $('damage-vignette'),
  };
  const mm = el.minimap.getContext('2d');
  let hitTimer = 0, bannerTimer = 0, toastTimer = 0;
  let lastMag = -1, lastReserve = -1;

  function setHealth(hp, armor) {
    el.hp.textContent = Math.max(0, Math.ceil(hp));
    el.armor.textContent = Math.max(0, Math.ceil(armor));
    el.hp.parentElement.classList.toggle('low', hp <= 30);
  }
  function setAmmo(mag, reserve, name) {
    if (mag !== lastMag || reserve !== lastReserve) {
      el.ammoMag.textContent = mag;
      el.ammoReserve.textContent = `/ ${reserve}`;
      el.ammoMag.parentElement.classList.toggle('empty', mag === 0);
      lastMag = mag; lastReserve = reserve;
    }
    if (name) el.weaponName.textContent = name;
  }
  function setMoney(m) { el.money.textContent = `$${m.toLocaleString('en-US')}`; }
  function setTimer(seconds, phase) {
    const s = Math.max(0, Math.ceil(seconds));
    el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.timer.classList.toggle('urgent', s <= 10 && phase === 'live');
    el.roundLabel.textContent = phase === 'buy' ? 'BUY PHASE' : phase === 'live' ? 'ROUND LIVE' : phase === 'planted' ? 'CHARGE PLANTED' : 'ROUND OVER';
  }
  function setScore(v, s) { el.scoreVeil.textContent = v; el.scoreSent.textContent = s; }
  function setAlive(v, s) { el.aliveVeil.textContent = `●`.repeat(v) + `○`.repeat(Math.max(0, 5 - v)); el.aliveSent.textContent = `●`.repeat(s) + `○`.repeat(Math.max(0, 5 - s)); }
  function setSpread(px) {
    el.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
  }
  function hitMarker(kill) {
    el.hitmarker.classList.add('on');
    el.hitmarker.classList.toggle('kill', kill);
    hitTimer = kill ? 0.28 : 0.14;
  }
  function killfeed(killer, victim, headshot, killerTeam) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    row.innerHTML = `<span class="${killerTeam === 'veil' ? 'team-veil' : 'team-sent'}">${escapeHtml(killer)}</span> <span class="kf-x">${headshot ? '⌖' : '✕'}</span> <span class="${killerTeam === 'veil' ? 'team-sent' : 'team-veil'}">${escapeHtml(victim)}</span>`;
    el.killfeed.prepend(row);
    while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 4200);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function banner(title, sub, ms = 2600) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || '';
    el.banner.hidden = false;
    el.banner.classList.add('show');
    bannerTimer = ms / 1000;
  }
  function hideBanner() { el.banner.classList.remove('show'); el.banner.hidden = true; }
  function setPrompt(text) {
    if (text) { el.prompt.innerHTML = text; el.prompt.hidden = false; }
    else el.prompt.hidden = true;
  }
  function setChannel(label, frac) {
    if (label == null) { el.channel.hidden = true; return; }
    el.channel.hidden = false;
    el.channelLabel.textContent = label;
    el.channelFill.style.width = `${Math.round(frac * 100)}%`;
  }
  function toast(text, ms = 2600) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    toastTimer = ms / 1000;
  }
  function flashWhite() {
    el.flash.style.opacity = '0.85';
    setTimeout(() => { el.flash.style.opacity = '0'; }, 120);
  }
  function damageFlash() {
    el.damage.style.opacity = '0.7';
    setTimeout(() => { el.damage.style.opacity = '0'; }, 220);
  }
  function tick(dt) {
    if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) el.hitmarker.classList.remove('on', 'kill'); }
    if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) hideBanner(); }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) el.toast.hidden = true; }
  }

  // ---- Buy menu ----
  let buyHandler = null;
  function buildBuy(money, owned, onBuy) {
    buyHandler = onBuy;
    el.buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
    el.buyGrid.innerHTML = '';
    const entries = [
      ...Object.values(WEAPONS).filter((w) => w.price > 0).map((w) => ({
        key: w.id, name: w.name, price: w.price, owned: owned.weapons.includes(w.id),
        desc: `${w.kind.toUpperCase()} · ${w.damage} dmg · ${w.mag} rnd mag`,
      })),
      { key: 'kevlar', name: GEAR.kevlar.name, price: GEAR.kevlar.price, owned: owned.kevlar, desc: GEAR.kevlar.desc },
      { key: 'flash', name: GEAR.flash.name, price: GEAR.flash.price, owned: owned.flash > 0, desc: `${GEAR.flash.desc} (have ${owned.flash})` },
      { key: 'smoke', name: GEAR.smoke.name, price: GEAR.smoke.price, owned: owned.smoke > 0, desc: `${GEAR.smoke.desc} (have ${owned.smoke})` },
    ];
    for (const e of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'buy-item' + (e.owned ? ' owned' : '');
      btn.disabled = money < e.price && !e.owned;
      btn.innerHTML = `<b>${escapeHtml(e.name)}</b><span>${escapeHtml(e.desc)}</span><i>${e.owned ? 'OWNED' : '$' + e.price.toLocaleString('en-US')}</i>`;
      btn.addEventListener('click', () => { if (buyHandler) buyHandler(e.key); });
      el.buyGrid.appendChild(btn);
    }
  }
  function showBuy(show) { el.buy.hidden = !show; }
  function updateBuyMoney(m) { el.buyMoney.textContent = `$${m.toLocaleString('en-US')}`; }

  // ---- Overlay (menu / pause / end) ----
  function showOverlay(kind, data = {}) {
    el.overlay.hidden = false;
    if (kind === 'start') {
      el.overlayTitle.textContent = 'IRONVEIL';
      el.overlayCopy.textContent = 'Round-based tactical FPS. Five versus five, first to 5 rounds. Plant the charge at Site A or B — or wipe the Sentinels out. Buy between rounds, tap your shots, and never peek the same corner twice.';
      el.playBtn.textContent = 'Click to play';
    } else if (kind === 'paused') {
      el.overlayTitle.textContent = 'PAUSED';
      el.overlayCopy.textContent = 'Click to resume. B opens the buy menu between rounds.';
      el.playBtn.textContent = 'Resume';
    } else if (kind === 'match') {
      el.overlayTitle.textContent = data.title || 'MATCH OVER';
      el.overlayCopy.textContent = data.sub || '';
      el.playBtn.textContent = 'Play again';
    }
  }
  function hideOverlay() { el.overlay.hidden = true; }

  // ---- Minimap ----
  function drawMinimap(world, playerPos, playerYaw, bots, planted, plantSite) {
    const W = el.minimap.width, H = el.minimap.height;
    const sx = W / 68, sz = H / 48;
    const X = (x) => (x + 34) * sx;
    const Z = (z) => (z + 24) * sz;
    mm.clearRect(0, 0, W, H);
    mm.fillStyle = 'rgba(16,12,22,0.85)';
    mm.fillRect(0, 0, W, H);
    // Walls.
    mm.fillStyle = '#4a4356';
    for (const c of world.colliders) {
      if (c.h > 4.5) mm.fillRect(X(c.minX), Z(c.minZ), (c.maxX - c.minX) * sx, (c.maxZ - c.minZ) * sz);
    }
    mm.fillStyle = '#6b5f7a';
    for (const c of world.colliders) {
      if (c.h <= 4.5) mm.fillRect(X(c.minX), Z(c.minZ), (c.maxX - c.minX) * sx, (c.maxZ - c.minZ) * sz);
    }
    // Sites.
    for (const id of ['A', 'B']) {
      const s = world.sites[id];
      mm.fillStyle = planted && plantSite === id ? '#ff4444' : '#f2a33c';
      mm.beginPath(); mm.arc(X(s.x), Z(s.z), 7, 0, Math.PI * 2); mm.fill();
      mm.fillStyle = '#14101a'; mm.font = 'bold 9px sans-serif'; mm.textAlign = 'center'; mm.textBaseline = 'middle';
      mm.fillText(id, X(s.x), Z(s.z));
    }
    // Bots.
    for (const b of bots) {
      if (!b.alive) continue;
      mm.fillStyle = b.team === 'veil' ? '#7fb069' : '#d95f4b';
      mm.beginPath(); mm.arc(X(b.pos.x), Z(b.pos.z), 3.5, 0, Math.PI * 2); mm.fill();
    }
    // Player arrow.
    mm.save();
    mm.translate(X(playerPos.x), Z(playerPos.z));
    mm.rotate(-playerYaw);
    mm.fillStyle = '#ece7dd';
    mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4.5, 5); mm.lineTo(-4.5, 5); mm.closePath(); mm.fill();
    mm.restore();
  }

  return {
    setHealth, setAmmo, setMoney, setTimer, setScore, setAlive, setSpread,
    hitMarker, killfeed, banner, hideBanner, setPrompt, setChannel, toast,
    flashWhite, damageFlash, tick, buildBuy, showBuy, updateBuyMoney,
    showOverlay, hideOverlay, drawMinimap,
    onPlay(cb) { el.playBtn.addEventListener('click', cb); },
  };
}
