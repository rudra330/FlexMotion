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

  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    
    const camera = new THREE.PerspectiveCamera(50, currentMount.clientWidth / 250, 0.1, 1000);
    camera.position.set(0, 1, 15);
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

    const handGroup = new THREE.Group();
    const handMaterial = new THREE.MeshStandardMaterial({ color: 0x87CEEB, roughness: 0.4, metalness: 0.2 });

    const palm = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 0.5), handMaterial);
    handGroup.add(palm);

    const wristGroup = new THREE.Group();
    wristGroup.position.y = -3.5;
    const wristMesh = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 0.5), handMaterial);
    wristGroup.add(wristMesh);
    handGroup.add(wristGroup);
    wristRef.current = wristGroup;
    
    fingerJointsRef.current = [];
    const fingerData = [
      { isThumb: true, pos: [-2.2, -0.5, 0], rot: Math.PI / 6 }, // Thumb
      { isThumb: false, pos: [-1.5, 2.5, 0], rot: 0 },         // Index
      { isThumb: false, pos: [-0.5, 2.5, 0], rot: 0 },         // Middle
      { isThumb: false, pos: [0.5, 2.5, 0], rot: 0 },          // Ring
      { isThumb: false, pos: [1.5, 2.5, 0], rot: 0 },          // Pinky
    ];

    fingerData.forEach(data => {
      const finger = new THREE.Group();
      finger.position.set(data.pos[0], data.pos[1], data.pos[2]);
      finger.rotation.z = data.rot;
      
      const segmentLength = data.isThumb ? 1.2 : 1.5;
      const segment = new THREE.Mesh(new THREE.BoxGeometry(0.4, segmentLength, 0.4), handMaterial);
      segment.position.y = segmentLength / 2;
      finger.add(segment);
      
      handGroup.add(finger);
      fingerJointsRef.current.push(finger);
    });

    if (hand === 'left') {
      handGroup.scale.x = -1;
    }
    scene.add(handGroup);
    
    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);
      if(rendererRef.current && sceneRef.current && cameraRef.current) {
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
    
    if (!isRecording) {
      joints.forEach(j => { j.rotation.x = 0; });
      if (wristRef.current) wristRef.current.rotation.z = 0;
      return;
    }
    
    if (sensorData.length === 6) {
      // sensorData maps to: thumb, index, middle, ring, pinky, wrist
      joints[0].rotation.x = sensorData[0] * Math.PI / 1.5;
      joints[1].rotation.x = sensorData[1] * Math.PI / 2;
      joints[2].rotation.x = sensorData[2] * Math.PI / 2;
      joints[3].rotation.x = sensorData[3] * Math.PI / 2;
      joints[4].rotation.x = sensorData[4] * Math.PI / 2;
      if (wristRef.current) {
        wristRef.current.rotation.z = (sensorData[5] - 0.5) * Math.PI / 4;
      }
    }
  }, [sensorData, isRecording]);

  return <div ref={mountRef} className="w-full h-[250px] cursor-grab active:cursor-grabbing rounded-b-lg" />;
};
