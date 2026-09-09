import * as THREE from 'three';
import { Terrain, WORLD_SIZE } from '../sim/terrain';
import { clamp, lerp } from '../sim/rng';

const MIN_DIST = 9;
const MAX_DIST = 360;

/**
 * A camera that behaves like a documentary crane: pan on the ground, zoom that
 * lowers the angle as you get close, orbit with the right button, and a follow mode.
 */
export class CameraController {
  camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
  dist = 420;
  yaw = -0.35;
  /** smoothed */
  private sTarget = new THREE.Vector3(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
  private sDist = 480;
  private sYaw = -0.9;
  private pitchOffset = 0;
  followId = -1;
  cinematic = false;
  /** seconds since the last user input */
  idle = 0;
  private dragging: 'pan' | 'orbit' | null = null;
  private lastX = 0;
  private lastY = 0;
  private pinchDist = 0;
  private pinchAngle = 0;
  private keys = new Set<string>();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private introT = 0;
  introTarget: THREE.Vector3 | null = null;
  onUserInput: (() => void) | null = null;
  onFollowBroken: (() => void) | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, private terrain: Terrain, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.5, 2600);
    this.bind();
  }

  get pitch(): number {
    const t = clamp((this.sDist - MIN_DIST) / (MAX_DIST - MIN_DIST), 0, 1);
    return clamp(lerp(0.38, 1.12, Math.pow(t, 0.55)) + this.pitchOffset, 0.22, 1.35);
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.dragging = e.button === 2 || e.button === 1 || e.ctrlKey || e.altKey ? 'orbit' : 'pan';
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || !this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.dragging === 'pan') {
        if (Math.abs(dx) + Math.abs(dy) > 0) this.pan(dx, dy);
      } else {
        this.yaw -= dx * 0.006;
        this.pitchOffset = clamp(this.pitchOffset - dy * 0.004, -0.5, 0.5);
        this.userInput(false);
      }
    });
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      this.dragging = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const f = Math.exp(clamp(e.deltaY, -120, 120) * 0.0016);
        this.zoomAt(f, e.clientX, e.clientY);
      },
      { passive: false },
    );
    // touch
    let touches: Touch[] = [];
    c.addEventListener('touchstart', (e) => {
      touches = Array.from(e.touches);
      if (touches.length === 2) {
        this.pinchDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        this.pinchAngle = Math.atan2(touches[0].clientY - touches[1].clientY, touches[0].clientX - touches[1].clientX);
      }
    }, { passive: true });
    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const now = Array.from(e.touches);
      if (now.length === 1 && touches.length === 1) {
        this.pan(now[0].clientX - touches[0].clientX, now[0].clientY - touches[0].clientY);
      } else if (now.length === 2 && touches.length === 2) {
        const d = Math.hypot(now[0].clientX - now[1].clientX, now[0].clientY - now[1].clientY);
        const a = Math.atan2(now[0].clientY - now[1].clientY, now[0].clientX - now[1].clientX);
        this.zoomAt(this.pinchDist / d, (now[0].clientX + now[1].clientX) / 2, (now[0].clientY + now[1].clientY) / 2);
        this.yaw += a - this.pinchAngle;
        this.pinchDist = d;
        this.pinchAngle = a;
      }
      touches = now;
    }, { passive: false });
    c.addEventListener('touchend', (e) => { touches = Array.from(e.touches); }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private userInput(breaksFollow: boolean): void {
    this.idle = 0;
    if (this.cinematic) {
      this.cinematic = false;
    }
    if (breaksFollow && this.followId >= 0) {
      this.followId = -1;
      this.onFollowBroken?.();
    }
    this.onUserInput?.();
  }

  private pan(dx: number, dy: number): void {
    // screen delta → ground delta, scaled by distance and pitch
    const k = (this.sDist * 0.0016) / Math.max(0.35, Math.sin(this.pitch));
    const fwd = this.tmp.set(-Math.sin(this.sYaw), 0, -Math.cos(this.sYaw));
    const right = this.tmp2.set(Math.cos(this.sYaw), 0, -Math.sin(this.sYaw));
    this.target.addScaledVector(right, -dx * k * Math.max(0.35, Math.sin(this.pitch)));
    this.target.addScaledVector(fwd, dy * k * Math.max(0.35, Math.sin(this.pitch)));
    this.clampTarget();
    this.userInput(true);
  }

  private zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.groundAt(sx, sy);
    const old = this.dist;
    this.dist = clamp(this.dist * factor, MIN_DIST, MAX_DIST);
    const applied = this.dist / old;
    if (before && applied < 1 && this.followId < 0) {
      // zoom toward the cursor: pull the target toward the point under it
      this.target.lerp(before, 1 - applied);
      this.clampTarget();
    }
    this.userInput(false);
  }

  private clampTarget(): void {
    this.target.x = clamp(this.target.x, -20, WORLD_SIZE + 20);
    this.target.z = clamp(this.target.z, -20, WORLD_SIZE + 20);
  }

  /** Ground point under a screen position (y=0 plane). */
  groundAt(sx: number, sy: number): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const out = new THREE.Vector3();
    // iterate: plane at the terrain height under the hit for a better fit
    let hit = this.raycaster.ray.intersectPlane(this.groundPlane, out);
    if (!hit) return null;
    for (let i = 0; i < 3; i++) {
      const h = this.terrain.elevationAt(clamp(hit.x, 0, WORLD_SIZE), clamp(hit.z, 0, WORLD_SIZE));
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
      const h2 = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!h2) break;
      hit = h2;
    }
    return hit;
  }

  follow(id: number): void {
    this.followId = id;
    if (this.dist > 60) this.dist = 42;
    this.idle = 0;
  }

  /** Move the view to a place (e.g. from a chronicle event). */
  lookAt(x: number, z: number, dist?: number): void {
    this.target.set(x, 0, z);
    if (dist) this.dist = dist;
    this.followId = -1;
  }

  /** Jump the smoothed state to the targets (screenshots, hard cuts). */
  snap(): void {
    this.sTarget.copy(this.target);
    this.sDist = this.dist;
    this.sYaw = this.yaw;
    this.introT = 10;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, followPos: THREE.Vector3 | null): void {
    this.idle += dt;
    this.introT += dt;
    // keyboard
    const k = this.keys;
    const pk = 420 * dt;
    if (k.has('w') || k.has('arrowup')) this.pan(0, pk);
    if (k.has('s') || k.has('arrowdown')) this.pan(0, -pk);
    if (k.has('a') || k.has('arrowleft')) this.pan(pk, 0);
    if (k.has('d') || k.has('arrowright')) this.pan(-pk, 0);
    if (k.has('q')) { this.yaw += 1.2 * dt; this.userInput(false); }
    if (k.has('e')) { this.yaw -= 1.2 * dt; this.userInput(false); }
    if (k.has('=') || k.has('+')) { this.dist = clamp(this.dist * (1 - dt * 1.5), MIN_DIST, MAX_DIST); this.userInput(false); }
    if (k.has('-') || k.has('_')) { this.dist = clamp(this.dist * (1 + dt * 1.5), MIN_DIST, MAX_DIST); this.userInput(false); }

    if (followPos) {
      this.target.copy(followPos);
    }
    if (this.introT < 7) {
      // opening: descend from the sky toward the first herd
      this.dist = lerp(this.dist, 95, 1 - Math.exp(-dt * 0.8));
      this.yaw = lerp(this.yaw, -0.35, 1 - Math.exp(-dt * 0.6));
      if (this.introTarget) this.target.lerp(this.introTarget, 1 - Math.exp(-dt * 0.9));
    }
    if (this.cinematic) this.yaw += dt * 0.035;

    // smoothing: quick for target, softer for distance/yaw
    const kT = 1 - Math.exp(-dt * (followPos ? 3.2 : 7));
    this.sTarget.lerp(this.target, kT);
    this.sDist = lerp(this.sDist, this.dist, 1 - Math.exp(-dt * (this.introT < 6 ? 1.1 : 5)));
    let dy = this.yaw - this.sYaw;
    this.sYaw += dy * (1 - Math.exp(-dt * 5));

    const pitch = this.pitch;
    const gx = clamp(this.sTarget.x, 0, WORLD_SIZE), gz = clamp(this.sTarget.z, 0, WORLD_SIZE);
    const groundY = this.terrain.elevationAt(gx, gz);
    const ty = lerp(this.sTarget.y, groundY, 1 - Math.exp(-dt * 4));
    this.sTarget.y = ty;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.camera.position.set(
      this.sTarget.x + Math.sin(this.sYaw) * cp * this.sDist,
      ty + sp * this.sDist,
      this.sTarget.z + Math.cos(this.sYaw) * cp * this.sDist,
    );
    // keep the line of sight clear of the terrain: lift the camera over any ridge in the way
    let maxGround = -Infinity;
    for (let k = 1; k <= 8; k++) {
      const f = k / 8;
      const sx = clamp(this.sTarget.x + (this.camera.position.x - this.sTarget.x) * f, 0, WORLD_SIZE);
      const sz = clamp(this.sTarget.z + (this.camera.position.z - this.sTarget.z) * f, 0, WORLD_SIZE);
      const g = this.terrain.elevationAt(sx, sz);
      // required camera height so the ray from the target clears this sample
      const need = ty + 0.8 + (g + 1.6 - (ty + 0.8)) / f;
      if (need > maxGround) maxGround = need;
    }
    const camGround = this.terrain.elevationAt(clamp(this.camera.position.x, 0, WORLD_SIZE), clamp(this.camera.position.z, 0, WORLD_SIZE)) + 2.5;
    const minY = Math.max(camGround, maxGround);
    if (this.camera.position.y < minY) this.camera.position.y = minY;
    this.camera.lookAt(this.sTarget.x, ty + 0.8, this.sTarget.z);
  }

  get focus(): THREE.Vector3 {
    return this.sTarget;
  }
  get distance(): number {
    return this.sDist;
  }

  /** World → screen (pixels, relative to canvas). Returns null if behind the camera. */
  project(x: number, y: number, z: number, out: { x: number; y: number; depth: number }): boolean {
    const v = this.tmp.set(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return false;
    const r = this.canvas.clientWidth, h = this.canvas.clientHeight;
    out.x = (v.x + 1) * 0.5 * r;
    out.y = (1 - v.y) * 0.5 * h;
    out.depth = v.z;
    return true;
  }
}
