// Ironveil — entry program for make.fun threejs-fps-02 (Node 22, stdlib only).
// The game lives in this repo's game/ folder: plain static files the browser loads
// as ES modules, three.js 0.187.0 vendored from an import map. This program hands it
// in: it copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun
// library (vendor/makefun-threejs.ts, the kit's copy, unchanged).
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Ironveil is a round-based tactical FPS: 5v5 (you + 4 bot teammates vs 5 bots),
// first to 5 round wins, rounds won by elimination or by planting/defusing the
// charge at Site A or Site B, with money between rounds to buy weapons.
//
// Deterministic captures for the dossier live in the game itself:
//   ?shot=menu|play|plant|win&seed=1  (see game/src/main.js runShot)
// Each capture stages a frame, renders it twice, freezes it and sets
// window.__shotReady. The game also exposes window.__ironveil (state, player,
// bots, world, keys) for debugging and play-testing; it is read-only in spirit
// and changes nothing about play.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes;
// the others refuse an entry the scorer would refuse (more than 4 screenshots or one
// over 256 KiB; more than 993 files in game/ or 48 MiB of game files, in all: game/
// counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
