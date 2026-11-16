// Player body: WASD + mouse look, Shift slow-aim, Ctrl/C crouch, AABB collision.
// Movement speed feeds the weapon spread — moving fire is punished, standing
// still and tapping is rewarded. No per-frame allocation in the hot path.
import { collideCircle } from './world.js';
import { clamp } from './rng.js';

export function createPlayer(colliders) {
  const state = {
    position: { x: 0, y: 0, z: 18 },
    yaw: 0, pitch: 0,
    eye: 1.62, eyeTarget: 1.62,
    speed: 0, // current horizontal speed, for spread
    crouched: false, aiming: false,
    recoilPitch: 0, recoilYaw: 0,
  };
  const vel = { x: 0, z: 0 };

  function look(dx, dy) {
    const sens = state.aiming ? 0.0011 : 0.0021;
    state.yaw -= dx * sens;
    state.pitch = clamp(state.pitch - dy * sens, -1.45, 1.45);
  }

  function step(dt, keys, frozen) {
    state.aiming = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const wantCrouch = keys.has('ControlLeft') || keys.has('KeyC');
    state.crouched = wantCrouch;
    state.eyeTarget = wantCrouch ? 1.05 : 1.62;
    state.eye += (state.eyeTarget - state.eye) * Math.min(1, dt * 12);

    let fx = 0, fz = 0;
    if (!frozen) {
      if (keys.has('KeyW')) fz -= 1;
      if (keys.has('KeyS')) fz += 1;
      if (keys.has('KeyA')) fx -= 1;
      if (keys.has('KeyD')) fx += 1;
    }
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const base = state.crouched ? 2.2 : state.aiming ? 2.6 : 4.6;
    const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
    // forward is -z rotated by yaw
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;
    const targetVx = wx * base * (fx || fz ? 1 : 0);
    const targetVz = wz * base * (fx || fz ? 1 : 0);
    const k = Math.min(1, dt * 14);
    vel.x += (targetVx - vel.x) * k;
    vel.z += (targetVz - vel.z) * k;
    state.position.x += vel.x * dt;
    state.position.z += vel.z * dt;
    const fixed = collideCircle(colliders, state.position.x, state.position.z, 0.38);
    state.position.x = fixed.x;
    state.position.z = fixed.z;
    state.position.x = clamp(state.position.x, -31.5, 31.5);
    state.position.z = clamp(state.position.z, -21.5, 21.5);
    state.speed = Math.hypot(vel.x, vel.z);

    // Recoil recovery.
    state.recoilPitch *= Math.max(0, 1 - dt * 7);
    state.recoilYaw *= Math.max(0, 1 - dt * 7);
  }

  function recoil(pitch, yaw) {
    state.recoilPitch += pitch;
    state.recoilYaw += yaw;
  }

  function eyePos(out) {
    out.set(state.position.x, state.position.y + state.eye, state.position.z);
    return out;
  }

  return { state, look, step, recoil, eyePos };
}
