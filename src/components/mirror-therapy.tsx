"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DrawingUtils, FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { Camera, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";
type Curl = Record<FingerName, number>;

const GLB_URL = "/rigged_hand_mediapipe_animation_ready.glb";

const clipMap: Record<FingerName, string> = {
  thumb: "MP_Thumb_Close",
  index: "MP_Index_Close",
  middle: "MP_Middle_Close",
  ring: "MP_Ring_Close",
  pinky: "MP_Pinky_Close",
};

const CURL_CALIBRATION: Record<FingerName, { open: number; closed: number; gamma: number; extraGain: number }> = {
  thumb: { open: 0.15258437867594393, closed: 0.36826432430508527, gamma: 0.72, extraGain: 1.08 },
  index: { open: 0.18380438254924883, closed: 0.8475469901968142, gamma: 1.0, extraGain: 1.0 },
  middle: { open: 0.22302504549553925, closed: 0.9290651992581581, gamma: 1.0, extraGain: 1.0 },
  ring: { open: 0.15834001956399615, closed: 0.9159518292065456, gamma: 1.0, extraGain: 1.0 },
  pinky: { open: 0.1481649016722891, closed: 0.8365464727794193, gamma: 1.0, extraGain: 1.0 },
};

const fingers: FingerName[] = ["thumb", "index", "middle", "ring", "pinky"];

function openCurl(): Curl {
  return { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
}

function cloneCurl(curl: Curl): Curl {
  return { thumb: curl.thumb, index: curl.index, middle: curl.middle, ring: curl.ring, pinky: curl.pinky };
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function remap01(value: number, inMin: number, inMax: number) {
  if (Math.abs(inMax - inMin) < 1e-8) return 0;
  return clamp((value - inMin) / (inMax - inMin), 0, 1);
}

function vec(a: any, b: any) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
}

function dot(a: any, b: any) {
  return a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0);
}

function length(v: any) {
  return Math.sqrt(v.x * v.x + v.y * v.y + (v.z || 0) * (v.z || 0));
}

function jointAngleDeg(a: any, b: any, c: any) {
  const ba = vec(a, b);
  const bc = vec(c, b);
  const denominator = length(ba) * length(bc);
  if (denominator < 1e-8) return 180;
  const cosAngle = clamp(dot(ba, bc) / denominator, -1, 1);
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

function bend01(a: any, b: any, c: any, bendNormalizationDeg: number) {
  const angle = jointAngleDeg(a, b, c);
  const bendDeg = 180 - angle;
  return clamp(bendDeg / bendNormalizationDeg, 0, 1);
}

function fourFingerAverage(curl: Curl) {
  return (curl.index + curl.middle + curl.ring + curl.pinky) / 4;
}

function calculateRawCurls(lm: any[], bendNormalizationDeg: number): Curl {
  if (!lm || lm.length < 21) return openCurl();

  return {
    thumb: clamp(
      bend01(lm[0], lm[1], lm[2], bendNormalizationDeg) * 0.3 +
        bend01(lm[1], lm[2], lm[3], bendNormalizationDeg) * 0.45 +
        bend01(lm[2], lm[3], lm[4], bendNormalizationDeg) * 0.25
    ),
    index: clamp(
      bend01(lm[0], lm[5], lm[6], bendNormalizationDeg) * 0.2 +
        bend01(lm[5], lm[6], lm[7], bendNormalizationDeg) * 0.55 +
        bend01(lm[6], lm[7], lm[8], bendNormalizationDeg) * 0.25
    ),
    middle: clamp(
      bend01(lm[0], lm[9], lm[10], bendNormalizationDeg) * 0.2 +
        bend01(lm[9], lm[10], lm[11], bendNormalizationDeg) * 0.55 +
        bend01(lm[10], lm[11], lm[12], bendNormalizationDeg) * 0.25
    ),
    ring: clamp(
      bend01(lm[0], lm[13], lm[14], bendNormalizationDeg) * 0.2 +
        bend01(lm[13], lm[14], lm[15], bendNormalizationDeg) * 0.55 +
        bend01(lm[14], lm[15], lm[16], bendNormalizationDeg) * 0.25
    ),
    pinky: clamp(
      bend01(lm[0], lm[17], lm[18], bendNormalizationDeg) * 0.2 +
        bend01(lm[17], lm[18], lm[19], bendNormalizationDeg) * 0.55 +
        bend01(lm[18], lm[19], lm[20], bendNormalizationDeg) * 0.25
    ),
  };
}

function calibrateFingerCurl(finger: FingerName, value: number) {
  const calibration = CURL_CALIBRATION[finger];
  let normalized = remap01(value, calibration.open, calibration.closed);
  normalized = Math.pow(normalized, calibration.gamma);
  return clamp(normalized * calibration.extraGain, 0, 1);
}

function calibrateCurls(raw: Curl): Curl {
  return {
    thumb: calibrateFingerCurl("thumb", raw.thumb),
    index: calibrateFingerCurl("index", raw.index),
    middle: calibrateFingerCurl("middle", raw.middle),
    ring: calibrateFingerCurl("ring", raw.ring),
    pinky: calibrateFingerCurl("pinky", raw.pinky),
  };
}

function easeEdges(value: number) {
  const edgeZone = 0.06;
  if (value < edgeZone) {
    const t = value / edgeZone;
    return t * t * (3 - 2 * t) * edgeZone;
  }
  if (value > 1 - edgeZone) {
    const t = (value - (1 - edgeZone)) / edgeZone;
    return 1 - edgeZone + t * t * (3 - 2 * t) * edgeZone;
  }
  return value;
}

interface MirrorParams {
  curlGain: number;
  positionLerp: number;
  velocitySmooth: number;
  idleReturn: number;
  poseHoldMs: number;
  softReturnMs: number;
  thumbSupportStrength: number;
  animationEdgeGuard: number;
  maxModelCurl: number;
  bendNormalizationDeg: number;
  suddenOpenHoldMs: number;
  thumbSuddenOpenHoldMs: number;
  thumbFistTrigger: number;
  thumbMinHoldWhenFist: number;
}

const defaultParams: MirrorParams = {
  curlGain: 1.0,
  positionLerp: 0.35,
  velocitySmooth: 0.25,
  idleReturn: 0.1,
  poseHoldMs: 1500,
  softReturnMs: 3000,
  thumbSupportStrength: 0.78,
  animationEdgeGuard: 0.012,
  maxModelCurl: 0.99,
  bendNormalizationDeg: 100,
  suddenOpenHoldMs: 900,
  thumbSuddenOpenHoldMs: 1600,
  thumbFistTrigger: 0.52,
  thumbMinHoldWhenFist: 0.55,
};

export function MirrorTherapy() {
  const viewerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const rafRef = useRef<number>();
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const handRootRef = useRef<any>(null);
  const mixerRef = useRef<any>(null);
  const clockRef = useRef(new THREE.Clock());
  const actionsRef = useRef<Record<string, { action: any; clip: any }>>({});

  const flagsRef = useRef({ autoMode: false, tracking: false, handVisible: false });
  const paramsRef = useRef<MirrorParams>({ ...defaultParams });
  const invertRef = useRef<Curl>({ thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 });

  const rawCurlRef = useRef<Curl>(openCurl());
  const targetCurlRef = useRef<Curl>(openCurl());
  const currentCurlRef = useRef<Curl>(openCurl());
  const curlVelocityRef = useRef<Curl>(openCurl());
  const lastGoodTargetCurlRef = useRef<Curl>(openCurl());
  const lastFingerGoodTimeRef = useRef<Curl>(openCurl());
  const lastValidHandTimeRef = useRef(0);
  const lastThumbGoodTimeRef = useRef(0);

  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const showError = useCallback((message: string, err?: unknown) => {
    console.error(message, err);
  }, []);

  const applyAntiResetGuard = useCallback((newCurl: Curl, now: number): Curl => {
    const guarded = cloneCurl(newCurl);
    const p = paramsRef.current;

    for (const finger of fingers) {
      const newValue = guarded[finger];
      const previousGood = lastGoodTargetCurlRef.current[finger];
      const currentValue = currentCurlRef.current[finger];
      const isThumb = finger === "thumb";

      const bentThreshold = isThumb ? 0.22 : 0.35;
      const dropThreshold = isThumb ? 0.16 : 0.35;
      const openThreshold = isThumb ? 0.24 : 0.12;
      const holdMs = isThumb ? p.thumbSuddenOpenHoldMs : p.suddenOpenHoldMs;

      const fingerWasBent = currentValue > bentThreshold || previousGood > bentThreshold;
      const suddenDrop = previousGood - newValue > dropThreshold;
      const suddenlyOpen = newValue < openThreshold;

      if (fingerWasBent && suddenDrop && suddenlyOpen) {
        const timeSinceGood = now - lastFingerGoodTimeRef.current[finger];
        if (timeSinceGood < holdMs) {
          guarded[finger] = Math.max(previousGood, currentValue * 0.95);
        }
      } else {
        lastFingerGoodTimeRef.current[finger] = now;
        if (isThumb && newValue > 0.25) {
          lastThumbGoodTimeRef.current = now;
        }
      }
    }

    return guarded;
  }, []);

  const applyThumbFistSupport = useCallback((curl: Curl, now: number): Curl => {
    const supported = cloneCurl(curl);
    const p = paramsRef.current;
    const fourAvg = fourFingerAverage(supported);

    if (fourAvg >= p.thumbFistTrigger) {
      const fist01 = remap01(fourAvg, p.thumbFistTrigger, 1.0);
      const thumbSupportValue = clamp(
        p.thumbMinHoldWhenFist + fist01 * (p.thumbSupportStrength - p.thumbMinHoldWhenFist),
        0,
        1
      );

      supported.thumb = Math.max(
        supported.thumb,
        thumbSupportValue,
        lastGoodTargetCurlRef.current.thumb * 0.9,
        currentCurlRef.current.thumb * 0.9
      );

      lastThumbGoodTimeRef.current = now;
    }

    return supported;
  }, []);

  const springTowardTarget = useCallback((finger: FingerName, dt: number) => {
    const p = paramsRef.current;
    const target = targetCurlRef.current[finger];
    const position = currentCurlRef.current[finger];
    const velocity = curlVelocityRef.current[finger];

    const stiffness = p.positionLerp * 60;
    const damping = 1 - p.velocitySmooth;
    const errorToTarget = target - position;

    let nextVelocity = velocity + errorToTarget * stiffness * dt;
    nextVelocity *= Math.pow(damping, dt * 60);

    let nextPosition = position + nextVelocity * dt;
    if (Math.abs(errorToTarget) < 0.0008 && Math.abs(nextVelocity) < 0.01) {
      nextPosition = target;
      nextVelocity = 0;
    }

    currentCurlRef.current[finger] = clamp(nextPosition, 0, 1);
    curlVelocityRef.current[finger] = nextVelocity;
  }, []);

  const applyFingerAnimations = useCallback(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;

    const p = paramsRef.current;
    const invert = invertRef.current;

    for (const finger of Object.keys(actionsRef.current) as FingerName[]) {
      const item = actionsRef.current[finger];
      let curlValue = clamp(currentCurlRef.current[finger] * p.curlGain, 0, p.maxModelCurl);
      let value = curlValue;
      if (invert[finger]) value = 1 - value;
      value = easeEdges(value);
      value = clamp(value, p.animationEdgeGuard, 1 - p.animationEdgeGuard);
      item.action.time = value * item.clip.duration;
    }

    mixer.update(0);
  }, []);

  const fitModelToView = useCallback((model: any) => {
    const controls = controlsRef.current;
    model.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim > 0) {
      const scale = 2.4 / maxDim;
      model.scale?.multiplyScalar?.(scale);
      model.updateMatrixWorld?.(true);

      const box2 = new THREE.Box3().setFromObject(model);
      const center2 = box2.getCenter(new THREE.Vector3());
      model.position.x -= center2.x;
      model.position.y -= center2.y - 0.25;
      model.position.z -= center2.z;
    }

    controls?.target?.set?.(0, 0.25, 0);
    controls?.update?.();
  }, []);

  const setupActions = useCallback((clips: any[]) => {
    const handRoot = handRootRef.current;
    if (!handRoot) return;

    const mixer = new THREE.AnimationMixer(handRoot);
    mixerRef.current = mixer;
    actionsRef.current = {};

    for (const finger of fingers) {
      const clipName = clipMap[finger];
      const clip = clips.find((candidate) => candidate.name === clipName);
      if (!clip) {
        console.warn("Missing animation clip:", clipName);
        continue;
      }

      const action: any = mixer.clipAction(clip);
      action.reset();
      action.setLoop((THREE as any).LoopOnce);
      action.clampWhenFinished = true;
      action.enabled = true;
      action.weight = 1;
      action.play();
      action.paused = true;

      actionsRef.current[finger] = { action, clip };
    }

  }, []);

  const initThreeAndLoadGlb = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, viewer.clientWidth / viewer.clientHeight, 0.01, 100);
    camera.position.set(0, 0.7, 4.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(viewer.clientWidth, viewer.clientHeight);
    rendererRef.current = renderer;
    viewer.innerHTML = "";
    viewer.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.0));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.8);
    dirLight.position.set(3, 5, 4);
    scene.add(dirLight);

    const controls = new (OrbitControls as any)(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.update();
    controlsRef.current = controls;

    resizeObserverRef.current = new ResizeObserver(() => {
      if (!viewerRef.current || !rendererRef.current || !cameraRef.current) return;
      const nextWidth = viewerRef.current.clientWidth;
      const nextHeight = viewerRef.current.clientHeight;
      cameraRef.current.aspect = nextWidth / nextHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(nextWidth, nextHeight);
    });
    resizeObserverRef.current.observe(viewer);

    try {
      const loader = new GLTFLoader();
      const gltf: any = await loader.loadAsync(GLB_URL);
      handRootRef.current = gltf.scene;
      scene.add(gltf.scene);
      fitModelToView(gltf.scene);

      const clips = gltf.animations || [];
      setupActions(clips);
    } catch (err) {
      showError("GLB loading failed.", err);
    }
  }, [fitModelToView, setupActions, showError]);

  const initMediaPipe = useCallback(async () => {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm"
    );

    handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
    });
  }, []);

  const startCameraTracking = useCallback(async () => {
    setIsCameraStarting(true);
    try {
      if (!handLandmarkerRef.current) {
        await initMediaPipe();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraActive(true);

      lastVideoTimeRef.current = -1;
      flagsRef.current.tracking = true;
      flagsRef.current.autoMode = true;
      flagsRef.current.handVisible = false;

      const now = performance.now();
      lastValidHandTimeRef.current = now;
      lastThumbGoodTimeRef.current = now;
      for (const finger of fingers) {
        lastFingerGoodTimeRef.current[finger] = now;
      }
    } catch (err) {
      showError("Camera or MediaPipe failed. Open this page in Chrome and allow camera permission.", err);
    } finally {
      setIsCameraStarting(false);
    }
  }, [initMediaPipe, showError]);

  const detectHands = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const handLandmarker = handLandmarkerRef.current;
    if (!flagsRef.current.tracking || !handLandmarker || !video?.videoWidth) return;
    if (video.currentTime === lastVideoTimeRef.current) return;

    lastVideoTimeRef.current = video.currentTime;
    const now = performance.now();
    const result: any = handLandmarker.detectForVideo(video, now);
    const canvasCtx = canvas?.getContext("2d");
    if (canvas && canvasCtx) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      const screenLandmarks = result.landmarks?.[0];
      if (screenLandmarks) {
        const drawingUtils = new DrawingUtils(canvasCtx);
        drawingUtils.drawConnectors(screenLandmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#38bdf8", lineWidth: 4 });
        drawingUtils.drawLandmarks(screenLandmarks, { color: "#f8fafc", lineWidth: 2, radius: 3 });
      }
      canvasCtx.restore();
    }
    const lm = result.worldLandmarks?.[0] || result.landmarks?.[0] || null;
    const p = paramsRef.current;

    if (lm) {
      flagsRef.current.handVisible = true;
      lastValidHandTimeRef.current = now;

      rawCurlRef.current = calculateRawCurls(lm, p.bendNormalizationDeg);
      let calibrated = calibrateCurls(rawCurlRef.current);
      calibrated = applyAntiResetGuard(calibrated, now);
      calibrated = applyThumbFistSupport(calibrated, now);

      targetCurlRef.current = calibrated;
      lastGoodTargetCurlRef.current = cloneCurl(targetCurlRef.current);
    } else {
      flagsRef.current.handVisible = false;
      const timeSinceSeen = now - lastValidHandTimeRef.current;
      rawCurlRef.current = openCurl();

      if (timeSinceSeen < p.poseHoldMs) {
        targetCurlRef.current = cloneCurl(lastGoodTargetCurlRef.current);
      } else if (timeSinceSeen < p.softReturnMs) {
        const fade = clamp((timeSinceSeen - p.poseHoldMs) / (p.softReturnMs - p.poseHoldMs), 0, 1);
        targetCurlRef.current = {
          thumb: lerp(lastGoodTargetCurlRef.current.thumb, 0, fade),
          index: lerp(lastGoodTargetCurlRef.current.index, 0, fade),
          middle: lerp(lastGoodTargetCurlRef.current.middle, 0, fade),
          ring: lerp(lastGoodTargetCurlRef.current.ring, 0, fade),
          pinky: lerp(lastGoodTargetCurlRef.current.pinky, 0, fade),
        };
      } else {
        targetCurlRef.current = openCurl();
      }
    }
  }, [applyAntiResetGuard, applyThumbFistSupport]);

  const animate = useCallback(() => {
    rafRef.current = requestAnimationFrame(animate);
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const dt = Math.min(clockRef.current.getDelta(), 0.05);

    if (flagsRef.current.autoMode) {
      detectHands();
    }

    if (flagsRef.current.autoMode) {
      for (const finger of fingers) springTowardTarget(finger, dt);
    } else {
      for (const finger of fingers) {
        currentCurlRef.current[finger] = lerp(currentCurlRef.current[finger], 0, paramsRef.current.idleReturn);
        curlVelocityRef.current[finger] = 0;
      }
    }

    applyFingerAnimations();
    controlsRef.current?.update?.();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }, [applyFingerAnimations, detectHands, springTowardTarget]);

  const stopCamera = useCallback(() => {
    flagsRef.current.tracking = false;
    flagsRef.current.autoMode = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraActive(false);
    const canvas = canvasRef.current;
    const canvasCtx = canvas?.getContext("2d");
    if (canvas && canvasCtx) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    let cancelled = false;
    initThreeAndLoadGlb().then(() => {
      if (!cancelled) animate();
    });

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      handLandmarkerRef.current?.close();
      resizeObserverRef.current?.disconnect();
      controlsRef.current?.dispose?.();
      rendererRef.current?.dispose?.();
      if (viewerRef.current) viewerRef.current.innerHTML = "";
    };
  }, [animate, initThreeAndLoadGlb]);

  return (
    <div className="relative flex h-[calc(100vh-7rem)] min-h-[620px] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div className="absolute left-1/2 top-4 z-30 flex -translate-x-1/2 gap-3">
        <Button onClick={startCameraTracking} disabled={isCameraStarting} className="bg-blue-600 hover:bg-blue-700">
          {isCameraStarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          Start Camera
        </Button>
        <Button onClick={stopCamera} variant="outline" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
          <Square className="mr-2 h-4 w-4" />
          Stop Camera
        </Button>
      </div>
      <section className="relative min-h-0 flex-1 border-b border-slate-800">
        <div ref={viewerRef} className={`absolute inset-0 transition-opacity duration-300 ${isCameraActive ? "opacity-100" : "opacity-0"}`} />
      </section>
      <section className="relative min-h-0 flex-1 bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover -scale-x-100" />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover -scale-x-100" />
      </section>
    </div>
  );
}
