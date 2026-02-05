
"use client";

import React, { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Slider } from './ui/slider';
import { cn } from '@/lib/utils';

const GLB_NAME = "rigged_hand_rebuilt.glb";
const FINGER_KEYWORDS = {
    "thumb":  ["thumb"],
    "index":  ["index"],
    "middle": ["middle"],
    "ring":   ["ring"],
    "pinky":  ["pinky", "little"],
};
const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];
type Finger = "thumb" | "index" | "middle" | "ring" | "pinky";

type HandModelProps = {
  sensorData: number[]; // Array of 5 values (0-1.5) for thumb, index, middle, ring, pinky
};

// --- Babylon.js Logic (moved outside component for stability) ---
const classifyFinger = (name: string): Finger | null => {
  const ln = (name || "").toLowerCase();
  for (const f in FINGER_KEYWORDS) {
    for (const kw of FINGER_KEYWORDS[f as keyof typeof FINGER_KEYWORDS]) {
      if (ln.includes(kw)) return f as Finger;
    }
  }
  return null;
}

const qNorm = (q: BABYLON.Quaternion) => {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1.0;
  return new BABYLON.Quaternion(q.x/l, q.y/l, q.z/l, q.w/l);
}

const qInv = (q: BABYLON.Quaternion) => {
  const qq = qNorm(q);
  return new BABYLON.Quaternion(-qq.x, -qq.y, -qq.z, qq.w);
}

const qMul = (a: BABYLON.Quaternion, b: BABYLON.Quaternion) => {
  return new BABYLON.Quaternion(
    a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
    a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
  );
}

const qToAxisAngle = (q: BABYLON.Quaternion) => {
  const qq = qNorm(q);
  const w = Math.max(-1, Math.min(1, qq.w));
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(1e-12, 1 - w*w));
  const axis = new BABYLON.Vector3(qq.x/s, qq.y/s, qq.z/s);
  return { axis, angle };
}

const axisAngleToQ = (axis: BABYLON.Vector3, angle: number) => {
  const a = axis.normalize();
  const s = Math.sin(angle/2);
  return qNorm(new BABYLON.Quaternion(a.x*s, a.y*s, a.z*s, Math.cos(angle/2)));
}

const scaleQuatTrack = (keys: {frame: number, value: BABYLON.Quaternion}[], scale: number) => {
  if (!keys.length) return keys;
  const q0 = qNorm(keys[0].value);
  const invQ0 = qInv(q0);
  const out = keys.map(k => ({ frame: k.frame, value: k.value.clone() }));
  for (let i = 1; i < out.length; i++) {
    const qk = qNorm(out[i].value);
    const dq = qMul(invQ0, qk);
    const {axis, angle} = qToAxisAngle(dq);
    const dqScaled = axisAngleToQ(axis, angle * scale);
    out[i].value = qMul(q0, dqScaled);
  }
  out[0].value = q0;
  return out;
}

const snapshotTarget = (t: BABYLON.Node) => {
  const snap: any = {};
  if ('position' in t && t.position instanceof BABYLON.Vector3) snap.position = t.position.clone();
  if ('scaling' in t && t.scaling instanceof BABYLON.Vector3) snap.scaling = t.scaling.clone();
  if ('rotationQuaternion' in t && t.rotationQuaternion) snap.rotationQuaternion = t.rotationQuaternion.clone();
  else if ('rotation' in t && t.rotation instanceof BABYLON.Vector3) snap.rotation = t.rotation.clone();
  return snap;
}

const restoreTarget = (t: BABYLON.Node, snap: any) => {
  if (!snap) return;
  if (snap.position && 'position' in t && t.position instanceof BABYLON.Vector3) t.position.copyFrom(snap.position);
  if (snap.scaling && 'scaling' in t && t.scaling instanceof BABYLON.Vector3) t.scaling.copyFrom(snap.scaling);
  if (snap.rotationQuaternion && 'rotationQuaternion' in t) (t as any).rotationQuaternion = snap.rotationQuaternion.clone();
  else if (snap.rotation && 'rotation' in t && t.rotation instanceof BABYLON.Vector3) t.rotation.copyFrom(snap.rotation);
}

// --- React Component ---
export function HandModel({ sensorData }: HandModelProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<BABYLON.Scene | null>(null);
    const engineRef = useRef<BABYLON.Engine | null>(null);
    const srcTargetsRef = useRef<any[]>([]);
    const restPoseRef = useRef<Map<string, any>>(new Map());
    const activeGroupRef = useRef<BABYLON.AnimationGroup | null>(null);

    const [isModelReady, setIsModelReady] = useState(false);
    const [selectedFingers, setSelectedFingers] = useState<Set<Finger>>(new Set(FINGERS as Finger[]));
    const [bendAmounts, setBendAmounts] = useState<Record<Finger, number>>({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });

    const toggleFinger = (finger: Finger) => {
        setSelectedFingers(prev => {
            const newSet = new Set(prev);
            if (newSet.has(finger)) {
                newSet.delete(finger);
            } else {
                newSet.add(finger);
            }
            return newSet;
        });
    };

    const handleSetAll = () => setSelectedFingers(new Set(FINGERS as Finger[]));
    const handleSetNone = () => setSelectedFingers(new Set());
    
    const handleSliderChange = (finger: Finger, value: number) => {
        setBendAmounts(prev => ({...prev, [finger]: value}));
    };

    // Update bend amounts from live sensor data
    useEffect(() => {
        if (sensorData && sensorData.length >= 5) {
            setBendAmounts({
                thumb:  sensorData[0],
                index:  sensorData[1],
                middle: sensorData[2],
                ring:   sensorData[3],
                pinky:  sensorData[4],
            });
        }
    }, [sensorData]);

    const applySelection = useMemo(() => () => {
        if (!sceneRef.current || !isModelReady) return;

        // Stop and dispose old animation group
        if (activeGroupRef.current) {
            try { activeGroupRef.current.stop(); } catch(e) {}
            try { activeGroupRef.current.dispose(); } catch(e) {}
            activeGroupRef.current = null;
        }

        // Reset all bones to their resting pose
        for (const x of srcTargetsRef.current) {
            const t = x.target;
            const snap = restPoseRef.current.get(t.uniqueId);
            restoreTarget(t, snap);
        }
    
        if (selectedFingers.size === 0) return;
    
        // Build and play new animation group
        const g = new BABYLON.AnimationGroup("filtered_multi", sceneRef.current);
        for (const x of srcTargetsRef.current) {
            if (!x.finger || !selectedFingers.has(x.finger)) continue;
            
            const scale = bendAmounts[x.finger as Finger] ?? 0;
            const animClone = x.animation.clone();

            if (animClone.targetProperty === "rotationQuaternion") {
                const keys = animClone.getKeys().map((k:any) => ({
                    frame: k.frame,
                    value: (k.value instanceof BABYLON.Quaternion) ? k.value.clone() : BABYLON.Quaternion.FromArray(k.value)
                }));
                const scaled = scaleQuatTrack(keys, scale);
                animClone.setKeys(scaled);
            }
            g.addTargetedAnimation(animClone, x.target);
        }
        
        activeGroupRef.current = g;
        if (activeGroupRef.current) {
            activeGroupRef.current.start(true, 1.0, activeGroupRef.current.from, activeGroupRef.current.to, false);
        }
    }, [isModelReady, selectedFingers, bendAmounts]);

    // Apply changes whenever selection or amounts change
    useEffect(() => {
        applySelection();
    }, [applySelection]);

    // Initialize Babylon scene
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const engine = new BABYLON.Engine(canvas, true);
        engineRef.current = engine;
        const scene = new BABYLON.Scene(engine);
        sceneRef.current = scene;
        scene.clearColor = new BABYLON.Color4(0.98, 0.98, 0.98, 1);

        const camera = new BABYLON.ArcRotateCamera("cam", Math.PI / 2, Math.PI / 2.4, 0.4, new BABYLON.Vector3(0, 0.1, 0), scene);
        camera.attachControl(canvas, true);
        camera.wheelPrecision = 50;
        camera.minZ = 0.1;

        const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
        hemi.intensity = 0.9;
        
        BABYLON.SceneLoader.Append("/", GLB_NAME, scene, (loadedScene) => {
            const srcGroups = loadedScene.animationGroups || [];
            srcGroups.forEach(g => { try { g.stop(); } catch(e) {} });

            const targets: any[] = [];
            for (const g of srcGroups) {
                for (const ta of g.targetedAnimations) {
                    const t = ta.target;
                    const nm = (t && t.name) ? t.name : "";
                    const f = classifyFinger(nm);
                    targets.push({ animation: ta.animation, target: ta.target, finger: f });
                }
            }
            srcTargetsRef.current = targets;

            restPoseRef.current.clear();
            for (const x of srcTargetsRef.current) {
                const t = x.target;
                if (!t) continue;
                restPoseRef.current.set(t.uniqueId, snapshotTarget(t));
            }
            
            srcGroups.forEach(g => { try { g.dispose(); } catch(e) {} });
            loadedScene.animationGroups = [];
            
            setIsModelReady(true);
        }, null, (scene, msg, ex) => {
            console.error("LOAD ERROR: " + msg, ex);
        });

        const resizeHandler = () => engine.resize();
        engine.runRenderLoop(() => scene.render());
        window.addEventListener("resize", resizeHandler);
        
        return () => {
            window.removeEventListener("resize", resizeHandler);
            engine.dispose();
        }
    }, []);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 h-full gap-6">
            {/* --- UI Controls --- */}
            <div className="md:col-span-1 p-4 bg-muted/50 rounded-lg overflow-y-auto">
                <h3 className="text-lg font-semibold mb-2">Finger Control</h3>
                <p className="text-xs text-muted-foreground mb-4">Toggle fingers and adjust bend amount (0-1.5). Live sensor data will override manual settings.</p>
                
                <div className="flex flex-wrap gap-2 mb-4">
                    {(FINGERS as Finger[]).map(finger => (
                        <Button 
                            key={finger} 
                            onClick={() => toggleFinger(finger)} 
                            variant={selectedFingers.has(finger) ? "default" : "outline"}
                            size="sm"
                            className="capitalize flex-grow"
                        >
                            {finger}
                        </Button>
                    ))}
                </div>
                <div className="flex gap-2 mb-6">
                    <Button onClick={handleSetAll} size="sm" className="flex-1">All</Button>
                    <Button onClick={handleSetNone} size="sm" variant="secondary" className="flex-1">None</Button>
                </div>

                <div className="space-y-6">
                    {(FINGERS as Finger[]).map(finger => (
                        <div key={finger} className="space-y-2">
                             <div className="flex justify-between items-center">
                                <Label htmlFor={`slider-${finger}`} className="capitalize">{finger}</Label>
                                <span className="text-sm font-medium text-muted-foreground">
                                    {bendAmounts[finger].toFixed(2)}
                                </span>
                            </div>
                            <Slider
                                id={`slider-${finger}`}
                                min={0}
                                max={1.5}
                                step={0.01}
                                value={[bendAmounts[finger]]}
                                onValueChange={(value) => handleSliderChange(finger, value[0])}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* --- Canvas --- */}
            <div className="md:col-span-2 relative">
                <canvas ref={canvasRef} className="w-full h-full block outline-none rounded-lg" />
                 {!isModelReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background rounded-lg">
                        <p className="text-muted-foreground">Loading 3D Model...</p>
                    </div>
                )}
            </div>
        </div>
    );
}
