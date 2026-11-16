// Fictional weapon catalogue for Ironveil. No real-world names.
// Balance: accuracy counts more than speed — moving fire and long sprays bloom
// the spread, standing still and tapping stays tight. Headshots deal x2.
export const WEAPONS = {
  vesper: {
    id: 'vesper', name: 'Vesper P9', kind: 'pistol', price: 0,
    damage: 26, headMult: 2, fireInterval: 0.16, auto: false,
    mag: 12, reserveMax: 48, reloadTime: 1.1, spread: 0.011, moveSpread: 0.030,
    range: 42, recoil: 0.006, armorPen: 0.5, zoom: 1,
  },
  riptide: {
    id: 'riptide', name: 'Riptide SMG', kind: 'smg', price: 1500,
    damage: 22, headMult: 2, fireInterval: 0.085, auto: true,
    mag: 28, reserveMax: 112, reloadTime: 1.6, spread: 0.016, moveSpread: 0.042,
    range: 34, recoil: 0.005, armorPen: 0.45, zoom: 1,
  },
  halberd: {
    id: 'halberd', name: 'Halberd AR', kind: 'rifle', price: 2700,
    damage: 33, headMult: 2, fireInterval: 0.11, auto: true,
    mag: 30, reserveMax: 120, reloadTime: 2.1, spread: 0.008, moveSpread: 0.038,
    range: 60, recoil: 0.009, armorPen: 0.8, zoom: 1.25,
  },
  longshot: {
    id: 'longshot', name: 'Longshot DMR', kind: 'sniper', price: 4750,
    damage: 88, headMult: 2, fireInterval: 1.15, auto: false,
    mag: 5, reserveMax: 20, reloadTime: 2.8, spread: 0.001, moveSpread: 0.09,
    range: 90, recoil: 0.03, armorPen: 1.0, zoom: 2.4,
  },
};

export const GEAR = {
  kevlar: { id: 'kevlar', name: 'Kevlar Vest', price: 650, desc: 'Halves bullet damage taken.' },
  flash: { id: 'flash', name: 'Flash Charge', price: 200, desc: 'Blinds bots looking at it (G).' },
  smoke: { id: 'smoke', name: 'Smoke Canister', price: 300, desc: 'Blocks sight for 12s (H).' },
};

export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  winReward: 3250,
  lossReward: 1900,
  plantReward: 300,
  roundsToWin: 5,
  roundTime: 100,
  buyTime: 12,
  plantTime: 3.5,
  defuseTime: 5,
  explodeTime: 40,
};
