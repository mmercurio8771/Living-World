import * as THREE from 'three';
import { Atmosphere } from './palette';
import { WORLD_SIZE } from '../sim/terrain';

/** Sun/moon directional light with a shadow frustum that follows the camera focus. */
export class Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  private target: THREE.Object3D;

  constructor(scene: THREE.Scene, shadowSize = 2048) {
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 1.1;
    this.sun.shadow.radius = 4;
    const cam = this.sun.shadow.camera;
    cam.near = 10;
    cam.far = 900;
    this.target = new THREE.Object3D();
    scene.add(this.target);
    this.sun.target = this.target;
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xa6c8ee, 0x66744f, 0.9);
    scene.add(this.hemi);
  }

  /** `focus` is the point the camera looks at; `extent` the half-size of the shadowed area. */
  update(atm: Atmosphere, focus: THREE.Vector3, extent: number): void {
    this.sun.color.copy(atm.sunColor);
    this.sun.intensity = atm.sunIntensity;
    this.hemi.color.copy(atm.hemiSky);
    this.hemi.groundColor.copy(atm.hemiGround);
    this.hemi.intensity = atm.hemiIntensity;
    const ex = THREE.MathUtils.clamp(extent, 40, WORLD_SIZE * 0.75);
    // snap the focus to the shadow texel grid to stop shimmering as the camera pans
    const texel = (ex * 2) / this.sun.shadow.mapSize.width;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.target.position.set(fx, 0, fz);
    this.sun.position.copy(atm.sunDir).multiplyScalar(420).add(this.target.position);
    const cam = this.sun.shadow.camera;
    if (cam.left !== -ex) {
      cam.left = -ex;
      cam.right = ex;
      cam.top = ex;
      cam.bottom = -ex;
      cam.updateProjectionMatrix();
    }
  }
}
