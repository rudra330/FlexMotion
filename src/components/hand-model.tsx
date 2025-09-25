"use client";

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

type HandModelProps = {
  hand: 'left' | 'right';
  sensorData: number[];
  isRecording: boolean;
};

export function HandModel({ hand, sensorData, isRecording }: HandModelProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const cameraRef = useRef<THREE.PerspectiveCamera>();
  const sceneRef = useRef<THREE.Scene>();
  const animationFrameId = useRef<number>();
  
  const wristRef = useRef<THREE.Group>();
  const fingerJointsRef = useRef<THREE.Group[]>([]);
  const handGroupRef = useRef<THREE.Group>();


  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    
    const camera = new THREE.PerspectiveCamera(50, currentMount.clientWidth / 250, 0.1, 1000);
    camera.position.set(0, 1, 18);
    cameraRef.current = camera;
    
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(currentMount.clientWidth, 250);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;
    currentMount.innerHTML = '';
    currentMount.appendChild(renderer.domElement);
    
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 7.5);
    scene.add(dirLight);

    // Create a more realistic hand
    const handMaterial = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.5, metalness: 0.1 });
    
    const handGroup = new THREE.Group();
    handGroupRef.current = handGroup;

    // Forearm
    const forearmGeo = new THREE.CylinderGeometry(1, 1.2, 8, 16);
    const forearm = new THREE.Mesh(forearmGeo, handMaterial);
    forearm.position.y = -7;
    handGroup.add(forearm);

    // Wrist
    const wristGroup = new THREE.Group();
    wristGroup.position.y = -3;
    const wrist = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), handMaterial);
    wristGroup.add(wrist);
    handGroup.add(wristGroup);
    wristRef.current = wristGroup;

    // Palm
    const palmShape = new THREE.Shape();
    palmShape.moveTo(-1.8, 1.5);
    palmShape.lineTo(1.8, 1.5);
    palmShape.lineTo(2, -1.5);
    palmShape.lineTo(-2, -2.5);
    palmShape.lineTo(-1.8, 1.5);
    const extrudeSettings = { depth: 0.8, bevelEnabled: true, bevelSegments: 2, steps: 2, bevelSize: 0.1, bevelThickness: 0.1 };
    const palm = new THREE.Mesh(new THREE.ExtrudeGeometry(palmShape, extrudeSettings), handMaterial);
    palm.position.y = -0.8;
    palm.position.z = -0.4
    handGroup.add(palm);

    fingerJointsRef.current = [];
    const fingerData = [
        { name: "Thumb", segments: [1, 1.2], baseX: -2.2, baseY: -1.2, baseRotZ: Math.PI / 4, knuckleSize: 0.4 },
        { name: "Index", segments: [1.3, 1, 0.7], baseX: -1.4, baseY: 1.5, baseRotZ: 0.05, knuckleSize: 0.3 },
        { name: "Middle", segments: [1.5, 1.2, 0.8], baseX: -0.5, baseY: 1.5, baseRotZ: 0, knuckleSize: 0.32 },
        { name: "Ring", segments: [1.4, 1.1, 0.7], baseX: 0.4, baseY: 1.5, baseRotZ: -0.05, knuckleSize: 0.3 },
        { name: "Pinky", segments: [1.1, 0.9, 0.6], baseX: 1.2, baseY: 1.4, baseRotZ: -0.1, knuckleSize: 0.25 },
    ];

    fingerData.forEach(data => {
      let parent: THREE.Group = handGroup;
      
      const fingerRoot = new THREE.Group();
      fingerRoot.position.set(data.baseX, data.baseY, 0);
      fingerRoot.rotation.z = data.baseRotZ;
      handGroup.add(fingerRoot);
      fingerJointsRef.current.push(fingerRoot);
      
      let currentSegmentGroup = fingerRoot;
      let lastSegmentLength = 0;

      data.segments.forEach((segmentLength, i) => {
        const segmentGroup = new THREE.Group();
        segmentGroup.position.y = (i === 0) ? 0 : lastSegmentLength;

        const phalanxGeo = new THREE.CylinderGeometry(data.knuckleSize * 0.8, data.knuckleSize * 0.7, segmentLength, 12);
        const phalanx = new THREE.Mesh(phalanxGeo, handMaterial);
        phalanx.position.y = segmentLength / 2;
        
        const knuckleGeo = new THREE.SphereGeometry(data.knuckleSize, 12, 12);
        const knuckle = new THREE.Mesh(knuckleGeo, handMaterial);

        segmentGroup.add(phalanx);
        segmentGroup.add(knuckle);

        currentSegmentGroup.add(segmentGroup);
        currentSegmentGroup = segmentGroup;
        lastSegmentLength = segmentLength;
      });
    });


    if (hand === 'left') {
      handGroup.scale.x = -1;
    }
    scene.add(handGroup);
    
    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);
      if(rendererRef.current && sceneRef.current && cameraRef.current) {
         if (handGroupRef.current) {
            handGroupRef.current.rotation.y += 0.005;
        }
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();
    
    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const { clientWidth } = mountRef.current;
      rendererRef.current.setSize(clientWidth, 250);
      cameraRef.current.aspect = clientWidth / 250;
      cameraRef.current.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if(currentMount && rendererRef.current) currentMount.removeChild(rendererRef.current.domElement);
      rendererRef.current?.dispose();
    };
  }, [hand]);

  useEffect(() => {
    const joints = fingerJointsRef.current;
    if (joints.length !== 5) return;

    if (sensorData.length === 6) {
      // sensorData maps to: thumb, index, middle, ring, pinky, wrist
      const setRotation = (joint: THREE.Group, value: number, maxAngle: number, fingerIndex: number) => {
        if (!joint) return;
        
        const isThumb = fingerIndex === 0;

        if (isThumb) {
            const thumbSegment1 = joint.children[0] as THREE.Group;
            const thumbSegment2 = thumbSegment1?.children[2] as THREE.Group;
            joint.rotation.z = Math.PI / 4 + (value - 0.5) * Math.PI / 4;
            joint.rotation.y = value * -Math.PI / 6;
            if (thumbSegment1) thumbSegment1.rotation.x = value * maxAngle * 0.8;
            if (thumbSegment2) thumbSegment2.rotation.x = value * maxAngle * 0.9;
        } else {
            const fingerSegment1 = joint.children[0] as THREE.Group;
            const fingerSegment2 = fingerSegment1?.children[2] as THREE.Group;
            const fingerSegment3 = fingerSegment2?.children[2] as THREE.Group;
            if (fingerSegment1) fingerSegment1.rotation.x = value * maxAngle * 0.6;
            if (fingerSegment2) fingerSegment2.rotation.x = value * maxAngle * 0.8;
            if (fingerSegment3) fingerSegment3.rotation.x = value * maxAngle * 0.9;
        }
      };
      
      setRotation(joints[0], sensorData[0], Math.PI / 2, 0); // Thumb
      setRotation(joints[1], sensorData[1], Math.PI / 2, 1); // Index
      setRotation(joints[2], sensorData[2], Math.PI / 2, 2); // Middle
      setRotation(joints[3], sensorData[3], Math.PI / 2, 3); // Ring
      setRotation(joints[4], sensorData[4], Math.PI / 2, 4); // Pinky

      if (wristRef.current) {
        wristRef.current.rotation.z = (sensorData[5] - 0.5) * Math.PI / 6; // Wrist flex/extend
        wristRef.current.rotation.x = (sensorData[5] - 0.5) * Math.PI / 8; // Wrist ulnar/radial deviation
      }
    }
  }, [sensorData, isRecording]);

  return <div ref={mountRef} className="w-full h-[250px] cursor-grab active:cursor-grabbing rounded-b-lg" />;
}
