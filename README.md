# Ironveil

[![make.fun bounty](https://img.shields.io/badge/make.fun-threejs--fps--02-f2a33c)](https://make.fun/bounty/threejs-fps-02)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![three.js 0.187.0](https://img.shields.io/badge/three.js-0.187.0-049ef4)](https://threejs.org/)

**Ironveil** is a round-based tactical FPS built for the [make.fun threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02) ($1,000). Counter-Strike-style, never a copy: its own map, art, sounds and names.

Five versus five — you plus four Veil bots against five Sentinel bots — first to 5 rounds. Win a round by eliminating the enemy team, or by planting the charge at Site A or Site B and letting it detonate (defenders win by defusing it or running the clock out). Money between rounds buys weapons and gear. Gunfire rewards accuracy over speed: moving fire and long sprays bloom your spread, standing still and tapping stays tight.

## The game

- **Map — "The Foundry Yard":** an original 3-lane industrial yard at dusk. West warehouse bay (Site A), east tank farm (Site B), mid lane through the old furnace hall, crates and containers for cover.
- **Bots:** waypoint-graph AI with roles (rusher / holder / rotator) and states (patrol / hold / engage / push / retreat). They react to gunfire and plant beeps, plant and defuse the charge, and shoot with per-bot reaction time and aim error.
- **Economy:** start $800, +$300 per elimination, +$3,250 round win / +$1,900 loss. Buy menu (B) between rounds: Vesper P9 pistol, Riptide SMG, Halberd AR, Longshot DMR, Kevlar vest, flash and smoke grenades.
- **Tactical gunplay:** headshots deal ×2, recoil and spread punish moving fire, Shift slow-aims, Ctrl/C crouches, right-click zooms.
- **Presentation:** procedural geometry only, WebAudio-synthesized sounds (zero network), dynamic-spread crosshair, hitmarker, kill feed, round banners, plant/defuse progress, live minimap.

## Run it

```bash
node serve.ts
# then open http://localhost:8080
```

No build step, no network request — static files under `game/`, ES modules, three.js 0.187.0 vendored in `game/vendor/three/`.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click to lock) |
| Click | Fire |
| R | Reload |
| Shift | Slow-aim |
| Ctrl / C | Crouch |
| B | Buy menu (between rounds) |
| E | Plant the charge (hold, near a site) |
| 1–4 | Switch weapon |
| G / H | Flash / Smoke grenade |
| M | Mute |

## Screenshots

Deterministic captures: `http://localhost:8080/?shot=menu|play|plant|win&seed=1` — each stages a frame, renders it twice, freezes it and sets `window.__shotReady`.

## License

MIT — see [LICENSE](LICENSE).
