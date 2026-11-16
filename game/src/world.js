// Ironveil map: "The Foundry Yard" — an original 3-lane industrial yard at dusk.
// Attackers (Veil) spawn south, defenders (Sentinels) spawn north. Site A sits in
// the west warehouse bay, Site B in the east tank farm; mid lane runs through the
// old furnace hall. All geometry is procedural boxes/cylinders, no external assets.
// Colliders are 2D AABBs (x/z) with a height; bullets use the three.js meshes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];   // {minX,maxX,minZ,maxZ,h}
  const shootables = [];  // meshes bullets can hit
  const wallMeshes = [];  // meshes that block line of sight

  const mats = {};
  const mat = (name, color, rough = 0.9, metal = 0.05) => {
    if (!mats[name]) mats[name] = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal });
    return mats[name];
  };

  function box(w, h, d, x, y, z, material, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    if (opts.ry) mesh.rotation.y = opts.ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (!opts.noCollide) {
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
      shootables.push(mesh);
      if (!opts.low) wallMeshes.push(mesh);
    }
    return mesh;
  }

  function cylinder(rTop, rBot, h, x, y, z, material, seg = 14) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const r = Math.max(rTop, rBot);
    colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, h });
    shootables.push(mesh);
    wallMeshes.push(mesh);
    return mesh;
  }

  const concrete = mat('concrete', PALETTE.surface, 0.95);
  const darkSteel = mat('darkSteel', PALETTE.hairline, 0.7, 0.4);
  const rust = mat('rust', PALETTE.rust, 0.9, 0.15);
  const steel = mat('steel', PALETTE.steel, 0.6, 0.5);
  const amber = mat('amber', PALETTE.accent, 0.5, 0.1);
  const veilMat = mat('veil', PALETTE.veil, 0.7);
  const sentMat = mat('sent', PALETTE.sentinel, 0.7);

  // Ground: 64 x 44 yard, slightly darker apron strips marking the lanes.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), new THREE.MeshStandardMaterial({ color: new THREE.Color('#221d28'), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // Lane tint strips (visual only).
  const stripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#26202e'), roughness: 1 });
  for (const sx of [-22, 0, 22]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(6, 40), stripMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(sx, 0.01, 0);
    strip.receiveShadow = true;
    group.add(strip);
  }

  // Outer walls (h 5).
  box(64.8, 5, 0.6, 0, 2.5, -22.3, darkSteel);
  box(64.8, 5, 0.6, 0, 2.5, 22.3, darkSteel);
  box(0.6, 5, 44.8, -32.3, 2.5, 0, darkSteel);
  box(0.6, 5, 44.8, 32.3, 2.5, 0, darkSteel);

  // Mid furnace hall: two big pillars + a low furnace block splitting mid.
  box(2.2, 4.6, 2.2, -3.4, 2.3, 0, rust);
  box(2.2, 4.6, 2.2, 3.4, 2.3, 0, rust);
  box(5.4, 1.0, 3.0, 0, 0.5, -6.5, steel, { low: true });
  box(5.4, 1.0, 3.0, 0, 0.5, 6.5, steel, { low: true });

  // West lane (Site A approach): warehouse wall segments + crates.
  box(0.8, 4.2, 10, -14, 2.1, -8, concrete);
  box(0.8, 4.2, 8, -14, 2.1, 10, concrete);
  box(8, 3.4, 0.8, -24, 1.7, 2, concrete);
  box(1.6, 1.2, 1.6, -20, 0.6, -6, rust, { low: true });
  box(1.6, 1.2, 1.6, -18.4, 0.6, -7.6, rust, { low: true });
  box(1.6, 1.2, 1.6, -26, 0.6, 8, rust, { low: true });
  box(2.4, 1.1, 1.2, -22, 0.55, 12, steel, { low: true });

  // East lane (Site B approach): tank farm.
  cylinder(2.2, 2.2, 3.4, 24, 1.7, -6, steel);
  cylinder(2.2, 2.2, 3.4, 26, 1.7, 4, rust);
  box(0.8, 4.2, 10, 14, 2.1, -8, concrete);
  box(0.8, 4.2, 8, 14, 2.1, 10, concrete);
  box(1.6, 1.2, 1.6, 20, 0.6, -12, rust, { low: true });
  box(1.6, 1.2, 1.6, 18, 0.6, 12, steel, { low: true });

  // North (defender) side cover + south (attacker) spawn cover.
  box(6, 1.1, 1.4, -10, 0.55, -16, steel, { low: true });
  box(6, 1.1, 1.4, 10, 0.55, -16, steel, { low: true });
  box(6, 1.1, 1.4, -10, 0.55, 16, rust, { low: true });
  box(6, 1.1, 1.4, 10, 0.55, 16, rust, { low: true });
  box(1.4, 2.6, 1.4, 0, 1.3, -18.5, darkSteel);

  // Site markers: glowing floor rings + beacon pillars at A (-22,-14) and B (22,-14).
  const sites = {};
  for (const [id, sx, sz] of [['A', -22, -14], ['B', 22, -14]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.9, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(sx, 0.03, sz);
    group.add(ring);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.28 }));
    beacon.position.set(sx, 3.5, sz);
    group.add(beacon);
    const label = makeLabel(`SITE ${id}`, sx, 4.4, sz);
    group.add(label);
    sites[id] = { id, x: sx, z: sz, ring, beacon };
  }

  // Spawn markers.
  const atkPad = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.veil), transparent: true, opacity: 0.25 }));
  atkPad.rotation.x = -Math.PI / 2; atkPad.position.set(0, 0.02, 19); group.add(atkPad);
  const defPad = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sentinel), transparent: true, opacity: 0.25 }));
  defPad.rotation.x = -Math.PI / 2; defPad.position.set(0, 0.02, -19); group.add(defPad);
  group.add(makeLabel('VEIL SPAWN', 0, 3.2, 19));
  group.add(makeLabel('SENTINEL SPAWN', 0, 3.2, -19));

  // Dusk lighting: low amber sun + cool hemisphere + a few yard lamps.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#6b5a8a'), new THREE.Color('#1a141f'), 1.25));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.4);
  sun.position.set(-18, 26, 14);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -36; sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36; sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const lampA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 18, 22, 1.8);
  lampA.position.set(-22, 5, -14); scene.add(lampA);
  const lampB = new THREE.PointLight(new THREE.Color(PALETTE.accent), 18, 22, 1.8);
  lampB.position.set(22, 5, -14); scene.add(lampB);

  // Waypoint graph: 3 lanes + cross connectors. Nodes as {x,z}, edges by index.
  const wp = [
    [-22, 18], [0, 18], [22, 18],          // 0-2 attacker spawn line
    [-22, 10], [0, 10], [22, 10],          // 3-5
    [-22, 2], [0, 2], [22, 2],             // 6-8 mid yard
    [-22, -6], [0, -6], [22, -6],          // 9-11
    [-22, -14], [0, -14], [22, -14],       // 12-14 sites / mid north
    [-8, -14], [8, -14],                   // 15-16 cross links north
    [-22, -19], [0, -19], [22, -19],       // 17-19 defender spawn line
    [-8, 10], [8, 10],                     // 20-21 cross links south
    [-8, -6], [8, -6],                     // 22-23 cross links mid-north
  ].map(([x, z]) => ({ x, z }));
  const edges = [
    [0, 3], [1, 4], [2, 5], [0, 1], [1, 2], [0, 20], [2, 21],
    [3, 6], [4, 7], [5, 8], [3, 4], [4, 5], [3, 20], [5, 21],
    [6, 9], [7, 10], [8, 11], [6, 7], [7, 8],
    [9, 12], [10, 13], [11, 14], [9, 10], [10, 11], [9, 22], [11, 23],
    [12, 15], [13, 15], [13, 16], [14, 16], [12, 17], [13, 18], [14, 19],
    [15, 18], [16, 18], [17, 18], [18, 19], [15, 22], [16, 23], [22, 10], [23, 10],
    [20, 4], [21, 4], [20, 3], [21, 5],
  ];
  const adj = wp.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }

  // Simple BFS path over the graph.
  function findPath(from, to) {
    if (from === to) return [from];
    const prev = new Array(wp.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length) {
      const cur = queue.shift();
      for (const n of adj[cur]) {
        if (prev[n] === -1) { prev[n] = cur; if (n === to) { const path = [to]; let c = to; while (c !== from) { c = prev[c]; path.unshift(c); } return path; } queue.push(n); }
      }
    }
    return [to];
  }
  function nearestWp(x, z) {
    let best = 0, bd = Infinity;
    wp.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // Line of sight between two 3D points (eye height) against wall meshes.
  const ray = new THREE.Raycaster();
  const tmpDir = new THREE.Vector3();
  function hasLOS(a, b) {
    tmpDir.copy(b).sub(a);
    const dist = tmpDir.length();
    if (dist < 0.01) return true;
    ray.set(a, tmpDir.normalize());
    ray.far = dist;
    return ray.intersectObjects(wallMeshes, false).length === 0;
  }

  function makeLabel(text, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const c = canvas.getContext('2d');
    c.fillStyle = 'rgba(20,16,26,0.85)';
    c.fillRect(0, 0, 256, 64);
    c.strokeStyle = PALETTE.accent; c.lineWidth = 3; c.strokeRect(2, 2, 252, 60);
    c.fillStyle = PALETTE.ink; c.font = 'bold 34px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(6, 1.5, 1);
    sprite.position.set(x, y, z);
    return sprite;
  }

  return {
    colliders, shootables, wallMeshes, waypoints: wp, adj, findPath, nearestWp, hasLOS, sites,
    attackerSpawns: [[-6, 18], [-2, 19], [2, 19], [6, 18], [0, 16.5]],
    defenderSpawns: [[-6, -18], [-2, -19], [2, -19], [6, -18], [0, -16.5]],
  };
}

// Resolve a circle (x,z,r) against the AABB colliders; returns corrected x,z.
// Walls with h <= 1.2 are low cover: they block movement but not crouched sight;
// here they still block movement (simple, fair for bots and player alike).
export function collideCircle(colliders, x, z, r, y = 0) {
  for (const c of colliders) {
    if (c.h < 1.2 && y > 1.25) continue; // standing over low cover is not possible; keep simple
    const cx = Math.max(c.minX, Math.min(x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration axis.
        const pl = x - c.minX, pr = c.maxX - x, pt = z - c.minZ, pb = c.maxZ - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = c.minX - r; else if (m === pr) x = c.maxX + r;
        else if (m === pt) z = c.minZ - r; else z = c.maxZ + r;
      }
    }
  }
  return { x, z };
}
