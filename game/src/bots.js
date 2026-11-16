// Bot AI for Ironveil. Each bot is a capsule + head hitbox with a name, a role
// and a simple state machine: patrol (waypoint walk), hold (site defence),
// engage (visible enemy: stop, aim, fire with reaction time + aim error),
// push (advance on the plant site), retreat (fall back when outnumbered / low HP),
// plant / defuse (channelled objective behaviour). Bots react to gunfire noise
// and to the charge beeps, and they miss more when their target moves.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { collideCircle } from './world.js';
import { clamp, pick, range } from './rng.js';

const BOT_NAMES_VEIL = ['Ash', 'Bram', 'Cyra', 'Doss'];
const BOT_NAMES_SENT = ['Fenn', 'Grit', 'Hale', 'Ivo', 'Juno'];

export function createBots(scene, world, rng, events) {
  const group = new THREE.Group();
  scene.add(group);
  const bots = [];
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function makeMesh(team, isPlayerAlly) {
    const color = team === 'veil' ? 0x7fb069 : 0xd95f4b;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x22222a, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.95, 4, 10), bodyMat);
    body.position.y = 0.95;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.7 }));
    head.position.y = 1.72;
    head.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.1), darkMat);
    visor.position.set(0, 1.74, 0.2);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), darkMat);
    gun.position.set(0.2, 1.25, 0.45);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(body, head, visor, gun, ring);
    return { group: g, body, head };
  }

  function spawnBot(team, name, spawn, role, weaponId) {
    const mesh = makeMesh(team);
    mesh.group.position.set(spawn[0], 0, spawn[1]);
    group.add(mesh.group);
    const bot = {
      id: bots.length, team, name, role,
      weapon: WEAPONS[weaponId],
      mag: WEAPONS[weaponId].mag, reserve: WEAPONS[weaponId].reserveMax,
      hp: 100, armor: role === 'holder' ? 50 : 0, alive: true,
      pos: mesh.group.position, // Vector3, y=0
      yaw: team === 'veil' ? Math.PI : 0,
      speed: 3.1,
      state: 'patrol',
      wpTarget: -1, path: [], pathIdx: 0,
      target: null, // enemy bot or 'player'
      lastSeen: null, reaction: 0, fireCooldown: 0, aimError: 0,
      reloadT: 0, holdT: range(rng, 1, 3), thinkT: 0,
      channel: null, // {kind:'plant'|'defuse', t, total}
      flashed: 0, smokeBlocked: false,
      mesh, body: mesh.body, head: mesh.head,
      kills: 0,
    };
    // Raycast tags: the shooter looks these up from the hit mesh.
    mesh.body.userData.bot = bot;
    mesh.body.userData.part = 'body';
    mesh.head.userData.bot = bot;
    mesh.head.userData.part = 'head';
    bots.push(bot);
    return bot;
  }

  function resetRound(round, playerIsAttacker) {
    // Clear old bots.
    for (const b of bots) group.remove(b.mesh.group);
    bots.length = 0;
    const atkSpawns = world.attackerSpawns;
    const defSpawns = world.defenderSpawns;
    const roles = ['rusher', 'rusher', 'holder', 'rotator'];
    BOT_NAMES_VEIL.forEach((name, i) => {
      const w = i === 0 ? 'halberd' : i === 1 ? 'riptide' : i === 2 ? 'longshot' : 'halberd';
      spawnBot('veil', name, atkSpawns[i + 1], roles[i], w);
    });
    BOT_NAMES_SENT.forEach((name, i) => {
      const w = i === 0 ? 'halberd' : i === 1 ? 'riptide' : i === 2 ? 'longshot' : i === 3 ? 'halberd' : 'riptide';
      const role = i < 2 ? 'holder' : i === 3 ? 'rotator' : 'holder';
      spawnBot('sentinel', name, defSpawns[i], role, w);
    });
    // Defenders start holding near the sites; attackers start patrolling up.
    for (const b of bots) {
      if (b.team === 'sentinel') {
        b.state = 'hold';
        b.holdSite = b.id % 2 === 0 ? 'A' : 'B';
        b.wpTarget = world.nearestWp(world.sites[b.holdSite].x + range(rng, -3, 3), world.sites[b.holdSite].z + range(rng, -3, 3));
      } else {
        b.state = 'patrol';
        b.wpTarget = world.nearestWp(b.pos.x, b.pos.z);
      }
    }
  }

  function eyeOf(bot) { tmpA.set(bot.pos.x, 1.55, bot.pos.z); return tmpA; }

  function visibleEnemy(bot, playerState, playerAlive) {
    // Returns {kind:'player'|'bot', ref, dist} for the nearest visible enemy, or null.
    let best = null;
    const eye = eyeOf(bot);
    if (bot.flashed > 0) return null;
    if (playerAlive && bot.team === 'sentinel') {
      tmpB.set(playerState.position.x, playerState.position.y + playerState.eye, playerState.position.z);
      const d = eye.distanceTo(tmpB);
      if (d < 55 && world.hasLOS(eye, tmpB)) best = { kind: 'player', ref: playerState, dist: d };
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      tmpB.set(other.pos.x, 1.5, other.pos.z);
      const d = eye.distanceTo(tmpB);
      if (d < 55 && (!best || d < best.dist) && world.hasLOS(eye, tmpB)) {
        best = { kind: 'bot', ref: other, dist: d };
      }
    }
    return best;
  }

  function moveToward(bot, tx, tz, dt, speedMul = 1) {
    const dx = tx - bot.pos.x, dz = tz - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    const sp = bot.speed * speedMul;
    const stepLen = Math.min(d, sp * dt);
    bot.pos.x += (dx / d) * stepLen;
    bot.pos.z += (dz / d) * stepLen;
    bot.yaw = Math.atan2(dx, dz);
    const fixed = collideCircle(world.colliders, bot.pos.x, bot.pos.z, 0.4);
    bot.pos.x = fixed.x; bot.pos.z = fixed.z;
    return d - stepLen < 0.15;
  }

  function followPath(bot, dt) {
    if (bot.pathIdx >= bot.path.length) return true;
    const node = world.waypoints[bot.path[bot.pathIdx]];
    if (moveToward(bot, node.x, node.z, dt)) bot.pathIdx += 1;
    return bot.pathIdx >= bot.path.length;
  }

  function setPath(bot, targetWp) {
    const from = world.nearestWp(bot.pos.x, bot.pos.z);
    bot.path = world.findPath(from, targetWp);
    bot.pathIdx = 0;
    bot.wpTarget = targetWp;
  }

  function pickSiteTarget(bot) {
    // Attackers pick a site; rusher leads, others follow or rotate.
    const site = bot.role === 'rusher' ? (rng() < 0.55 ? 'A' : 'B') : (rng() < 0.5 ? 'A' : 'B');
    const s = world.sites[site];
    return { site, wp: world.nearestWp(s.x + range(rng, -2, 2), s.z + range(rng, -2, 2)) };
  }

  // events: { onShot(bot, targetPos), onKill(killer, victim, headshot), onNoise(x,z,team) }
  function step(dt, playerState, playerAlive, game) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      bot.thinkT -= dt;
      bot.fireCooldown -= dt;
      bot.reloadT -= dt;
      bot.flashed = Math.max(0, bot.flashed - dt);

      // Channelled objective work (plant/defuse) — standing still.
      if (bot.channel) {
        bot.channel.t += dt;
        if (bot.channel.t >= bot.channel.total) {
          const kind = bot.channel.kind;
          bot.channel = null;
          events.onChannelDone(bot, kind);
        }
        continue;
      }

      // Periodic re-think.
      if (bot.thinkT <= 0) {
        bot.thinkT = range(rng, 0.6, 1.4);
        const seen = visibleEnemy(bot, playerState, playerAlive);
        if (seen) {
          bot.target = seen;
          bot.lastSeen = { x: seen.kind === 'player' ? playerState.position.x : seen.ref.pos.x, z: seen.kind === 'player' ? playerState.position.z : seen.ref.pos.z };
          if (bot.state !== 'engage') { bot.state = 'engage'; bot.reaction = range(rng, 0.35, 0.8); }
        } else if (bot.state === 'engage') {
          bot.state = bot.team === 'sentinel' ? 'hold' : 'patrol';
          bot.target = null;
        }

        if (bot.state === 'patrol' && bot.team === 'veil') {
          if (bot.pathIdx >= bot.path.length) {
            const pickSite = pickSiteTarget(bot);
            bot.siteTarget = pickSite.site;
            setPath(bot, pickSite.wp);
          }
        } else if (bot.state === 'hold' && bot.team === 'sentinel') {
          bot.holdT -= 1;
          if (bot.holdT <= 0) {
            bot.holdT = range(rng, 4, 9);
            const s = world.sites[bot.holdSite];
            setPath(bot, world.nearestWp(s.x + range(rng, -4, 4), s.z + range(rng, -4, 4)));
          }
        } else if (bot.state === 'push') {
          const s = world.sites[game.plantSite || 'A'];
          setPath(bot, world.nearestWp(s.x + range(rng, -2, 2), s.z + range(rng, -2, 2)));
          bot.state = 'patrol';
        } else if (bot.state === 'retreat') {
          const home = bot.team === 'veil' ? world.attackerSpawns[2] : world.defenderSpawns[2];
          setPath(bot, world.nearestWp(home[0], home[1]));
          bot.state = 'patrol';
        }
      }

      // React to the plant: defenders converge, attackers hold the site.
      if (game.planted && bot.team === 'sentinel' && bot.state !== 'engage' && rng() < 0.02) {
        bot.state = 'push';
      }
      if (game.planted && bot.team === 'veil' && bot.state !== 'engage' && rng() < 0.01) {
        bot.state = 'hold';
        bot.holdSite = game.plantSite;
        const s = world.sites[game.plantSite];
        setPath(bot, world.nearestWp(s.x + range(rng, -4, 4), s.z + range(rng, -4, 4)));
      }

      // Movement by state.
      if (bot.state === 'engage' && bot.target) {
        // Strafe a little while shooting, keep some distance.
        const t = bot.target;
        const tx = t.kind === 'player' ? playerState.position.x : t.ref.pos.x;
        const tz = t.kind === 'player' ? playerState.position.z : t.ref.pos.z;
        const d = Math.hypot(tx - bot.pos.x, tz - bot.pos.z);
        bot.yaw = Math.atan2(tx - bot.pos.x, tz - bot.pos.z);
        if (d > 14 && bot.reaction <= 0) moveToward(bot, tx, tz, dt, 0.5);
        else if (d < 5) moveToward(bot, bot.pos.x + (bot.pos.x - tx), bot.pos.z + (bot.pos.z - tz), dt, 0.4);
      } else if (bot.state === 'patrol' || bot.state === 'hold' || bot.state === 'push') {
        followPath(bot, dt);
      }

      // Firing.
      if (bot.state === 'engage' && bot.target && bot.reaction <= 0) {
        bot.reaction -= dt; // already elapsed once set; keep negative
        const t = bot.target;
        const alive = t.kind === 'player' ? playerAlive : t.ref.alive;
        if (!alive) { bot.target = null; bot.state = bot.team === 'sentinel' ? 'hold' : 'patrol'; continue; }
        const tx = t.kind === 'player' ? playerState.position.x : t.ref.pos.x;
        const tz = t.kind === 'player' ? playerState.position.z : t.ref.pos.z;
        const ty = t.kind === 'player' ? playerState.position.y + playerState.eye : 1.4;
        const d = Math.hypot(tx - bot.pos.x, tz - bot.pos.z);
        if (bot.reloadT <= 0 && bot.mag > 0 && bot.fireCooldown <= 0) {
          bot.fireCooldown = bot.weapon.fireInterval * range(rng, 1.0, 1.35);
          bot.mag -= 1;
          // Aim error grows with distance and target speed; bots are beatable.
          const baseErr = bot.weapon.kind === 'sniper' ? 0.012 : bot.weapon.kind === 'smg' ? 0.05 : 0.032;
          const err = baseErr * (1 + d / 25) * range(rng, 0.7, 1.4);
          const hitChance = clamp(0.62 - d / 90 - err * 2.2, 0.12, 0.62);
          const from = new THREE.Vector3(bot.pos.x, 1.45, bot.pos.z);
          const aim = new THREE.Vector3(tx + range(rng, -err, err) * d * 0.5, ty + range(rng, -0.25, 0.25), tz + range(rng, -err, err) * d * 0.5);
          events.onBotShot(bot, from, aim);
          if (rng() < hitChance) {
            const head = rng() < 0.18;
            const dmg = bot.weapon.damage * (head ? 2 : 1) * range(rng, 0.85, 1.15);
            events.onBotHit(bot, t, dmg, head);
          }
          if (bot.mag === 0) { bot.reloadT = bot.weapon.reloadTime; bot.mag = bot.weapon.mag; bot.reserve = Math.max(0, bot.reserve - bot.weapon.mag); }
        }
      } else if (bot.state === 'engage') {
        bot.reaction -= dt;
      }

      // Low HP retreat.
      if (bot.hp < 30 && bot.state !== 'engage' && rng() < 0.01) bot.state = 'retreat';

      // Sync mesh.
      bot.mesh.group.position.set(bot.pos.x, 0, bot.pos.z);
      bot.mesh.group.rotation.y = bot.yaw;
      bot.mesh.group.visible = bot.alive;
    }
  }

  function damage(bot, dmg, headshot) {
    if (!bot.alive) return false;
    let remaining = dmg;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, remaining * 0.5);
      bot.armor -= absorbed;
      remaining -= absorbed;
    }
    bot.hp -= remaining;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.channel = null;
      bot.mesh.group.visible = false;
      return true;
    }
    return false;
  }

  function aliveCount(team) {
    return bots.filter((b) => b.alive && b.team === team).length;
  }

  function startPlant(bot, site) {
    bot.channel = { kind: 'plant', t: 0, total: 3.5, site };
  }
  function startDefuse(bot) {
    bot.channel = { kind: 'defuse', t: 0, total: 5 };
  }

  return {
    bots, resetRound, step, damage, aliveCount, startPlant, startDefuse,
    get list() { return bots; },
  };
}
