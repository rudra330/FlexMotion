declare module "three" {
  export class Scene {
    background: unknown;
    add(...args: any[]): void;
  }
  export class Color {
    constructor(...args: any[]);
  }
  export class PerspectiveCamera {
    aspect: number;
    position: { set(...args: any[]): void };
    constructor(...args: any[]);
    updateProjectionMatrix(): void;
  }
  export class WebGLRenderer {
    domElement: HTMLElement;
    constructor(...args: any[]);
    setSize(...args: any[]): void;
    setPixelRatio(...args: any[]): void;
    render(...args: any[]): void;
    dispose(): void;
  }
  export class HemisphereLight {
    constructor(...args: any[]);
  }
  export class DirectionalLight {
    position: { set(...args: any[]): void };
    constructor(...args: any[]);
  }
  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(...args: any[]);
  }
  export class Box3 {
    constructor(...args: any[]);
    setFromObject(...args: any[]): this;
    getSize(target: Vector3): Vector3;
    getCenter(target: Vector3): Vector3;
  }
  export class AnimationMixer {
    constructor(...args: any[]);
    clipAction(...args: any[]): AnimationAction;
    update(...args: any[]): void;
  }
  export class AnimationAction {
    time: number;
    enabled: boolean;
    weight: number;
    clampWhenFinished: boolean;
    reset(): this;
    setLoop(...args: any[]): this;
    play(): this;
  }
  export class AnimationClip {
    name: string;
    duration: number;
  }
  export class Clock {
    constructor(...args: any[]);
    getDelta(): number;
  }
  export const LoopOnce: number;
}
declare module "three/addons/loaders/GLTFLoader.js";
declare module "three/addons/controls/OrbitControls.js";
