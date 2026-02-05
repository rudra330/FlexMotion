
"use client";

import React, { useRef, useEffect, useLayoutEffect } from 'react';
import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF'; // side-effect import for GLTF loader

const GLB_NAME = "rigged_hand_rebuilt.glb";
const FINGER_KEYWORDS = {
    "thumb":  ["thumb"],
    "index":  ["index"],
    "middle": ["middle"],
    "ring":   ["ring"],
    "pinky":  ["pinky", "little"],
};
const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];

type HandModelProps = {
  sensorData: number[]; // Array of 5 values (0-1) for thumb, index, middle, ring, pinky
  isRecording: boolean; 
};


export function HandModel({ sensorData }: HandModelProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    const sceneRef = useRef<BABYLON.Scene | null>(null);
    const engineRef = useRef<BABYLON.Engine | null>(null);
    const srcTargetsRef = useRef<any[]>([]);
    const restPoseRef = useRef<Map<string, any>>(new Map());
    const activeGroupRef = useRef<BABYLON.AnimationGroup | null>(null);
    
    const amountRef = useRef({ thumb: 0.0, index: 0.0, middle: 0.0, ring: 0.0, pinky: 0.0 });
    const selectedFingersRef = useRef(new Set(FINGERS));

    // --- Start of Babylon.js Logic ---

    const classifyFinger = (name: string) => {
      const ln = (name || "").toLowerCase();
      for (const f in FINGER_KEYWORDS) {
        for (const kw of FINGER_KEYWORDS[f as keyof typeof FINGER_KEYWORDS]) {
          if (ln.includes(kw)) return f;
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
    
    const stopAndDisposeActive = () => {
        if (activeGroupRef.current) {
            try { activeGroupRef.current.stop(); } catch(e) {}
            try { activeGroupRef.current.dispose(); } catch(e) {}
            activeGroupRef.current = null;
        }
    }

    const cloneAnimationScaled = (anim: BABYLON.Animation, fingerScale: number) => {
        const a = anim.clone();

        if (a.targetProperty === "rotationQuaternion") {
            const keys = a.getKeys().map(k => ({
            frame: k.frame,
            value: (k.value instanceof BABYLON.Quaternion) ? k.value.clone() : BABYLON.Quaternion.FromArray(k.value)
            }));
            const scaled = scaleQuatTrack(keys, fingerScale);
            a.setKeys(scaled);
            return a;
        }

        if (a.targetProperty === "rotation") {
            const keys = a.getKeys().map(k => ({
            frame: k.frame,
            value: (k.value instanceof BABYLON.Vector3) ? k.value.clone() : BABYLON.Vector3.FromArray(k.value)
            }));
            const v0 = keys[0].value.clone();
            for (let i = 1; i < keys.length; i++) {
            const dv = keys[i].value.subtract(v0);
            keys[i].value = v0.add(dv.scale(fingerScale));
            }
            a.setKeys(keys);
            return a;
        }
        return a;
    }

    const buildFilteredGroup = () => {
        if (!sceneRef.current) return null;
        const g = new BABYLON.AnimationGroup("filtered_multi", sceneRef.current);
        
        for (const x of srcTargetsRef.current) {
            if (!x.finger) continue;
            if (!selectedFingersRef.current.has(x.finger)) continue;

            const sc = amountRef.current[x.finger as keyof typeof amountRef.current] ?? 1.0;
            const animScaled = cloneAnimationScaled(x.animation, sc);
            g.addTargetedAnimation(animScaled, x.target);
        }
        return g;
    }

    const applySelection = () => {
        stopAndDisposeActive();
        for (const x of srcTargetsRef.current) {
            const t = x.target;
            const snap = restPoseRef.current.get(t.uniqueId);
            restoreTarget(t, snap);
        }
    
        if (selectedFingersRef.current.size === 0) {
            return;
        }
    
        activeGroupRef.current = buildFilteredGroup();
        if (activeGroupRef.current) {
            activeGroupRef.current.start(true, 1.0);
        }
    }


    // --- End of Babylon.js Logic ---


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
            console.log("GLB loaded: " + GLB_NAME);

            const srcGroups = loadedScene.animationGroups || [];
            srcGroups.forEach(g => { try { g.stop(); } catch(e) {} });

            const targets: any[] = [];
            const counts = {thumb:0,index:0,middle:0,ring:0,pinky:0,none:0};

            for (const g of srcGroups) {
                for (const ta of g.targetedAnimations) {
                    const t = ta.target;
                    const nm = (t && t.name) ? t.name : "";
                    const f = classifyFinger(nm);
                    targets.push({ animation: ta.animation, target: ta.target, finger: f });
                    if (f) counts[f as keyof typeof counts]++; else counts.none++;
                }
            }
            srcTargetsRef.current = targets;
            console.log("Target counts: " + JSON.stringify(counts));

            restPoseRef.current.clear();
            for (const x of srcTargetsRef.current) {
                const t = x.target;
                if (!t) continue;
                restPoseRef.current.set(t.uniqueId, snapshotTarget(t));
            }
            console.log("Rest pose captured for targets: " + restPoseRef.current.size);

            srcGroups.forEach(g => { try { g.dispose(); } catch(e) {} });
            loadedScene.animationGroups = [];
            
            applySelection();

        }, null, (scene, msg, ex) => {
            console.error("LOAD ERROR: " + msg, ex);
        });

        engine.runRenderLoop(() => {
            if (sceneRef.current) {
                sceneRef.current.render();
            }
        });
        
        const resizeHandler = () => engine.resize();
        window.addEventListener("resize", resizeHandler);
        
        return () => {
            window.removeEventListener("resize", resizeHandler);
            engine.dispose();
        }
    }, []);

    useEffect(() => {
        if (srcTargetsRef.current.length === 0) return; 

        if (sensorData && sensorData.length >= 5) {
            amountRef.current.thumb = sensorData[0];
            amountRef.current.index = sensorData[1];
            amountRef.current.middle = sensorData[2];
            amountRef.current.ring = sensorData[3];
            amountRef.current.pinky = sensorData[4];
        }

        applySelection();

    }, [sensorData]);


    return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', outline: 'none' }} />;
}
