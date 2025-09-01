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
    const handMaterial = new THREE.MeshStandardMaterial({ color: 0x87CEEB, roughness: 0.4, metalness: 0.2 });
    
    const handGroup = new THREE.Group();
    handGroupRef.current = handGroup;

    // Forearm
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 1), handMaterial);
    forearm.position.y = -6;
    handGroup.add(forearm);

    // Wrist
    const wristGroup = new THREE.Group();
    wristGroup.position.y = -3;
    const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), handMaterial);
    wristGroup.add(wrist);
    handGroup.add(wristGroup);
    wristRef.current = wristGroup;

    // Palm
    const palm = new THREE.Mesh(new THREE.BoxGeometry(3.5, 4, 0.5), handMaterial);
    palm.position.y = -0.5;
    handGroup.add(palm);

    fingerJointsRef.current = [];
    // isThumb, segments, baseX, baseY, baseRotZ, knuckleSize
    const fingerData = [
      { name: "Thumb", segments: [1, 1], baseX: -2, baseY: -2, baseRotZ: Math.PI / 6, knuckleSize: 0.4 },
      { name: "Index", segments: [1.2, 1, 0.8], baseX: -1.2, baseY: 1.5, baseRotZ: 0, knuckleSize: 0.35 },
      { name: "Middle", segments: [1.4, 1.1, 0.9], baseX: -0.4, baseY: 1.5, baseRotZ: 0, knuckleSize: 0.35 },
      { name: "Ring", segments: [1.3, 1, 0.8], baseX: 0.4, baseY: 1.5, baseRotZ: 0, knuckleSize: 0.35 },
      { name: "Pinky", segments: [1, 0.8, 0.7], baseX: 1.2, baseY: 1.5, baseRotZ: 0, knuckleSize: 0.3 },
    ];

    fingerData.forEach(data => {
      let parent: THREE.Group = handGroup;
      let cumulativeY = 0;
      
      const fingerRoot = new THREE.Group();
      fingerRoot.position.set(data.baseX, data.baseY, 0);
      fingerRoot.rotation.z = data.baseRotZ;
      handGroup.add(fingerRoot);
      fingerJointsRef.current.push(fingerRoot);
      
      let currentSegmentGroup = fingerRoot;

      data.segments.forEach((segmentLength, i) => {
        const segmentGroup = new THREE.Group();
        const yPos = (i === 0 ? segmentLength / 2 : cumulativeY + segmentLength / 2);
        segmentGroup.position.y = (i === 0) ? segmentLength / 2 : segmentLength / 2;

        const segmentGeo = new THREE.BoxGeometry(data.knuckleSize * 1.8, segmentLength, data.knuckleSize * 1.5);
        const segmentMesh = new THREE.Mesh(segmentGeo, handMaterial);
        
        const knuckle = new THREE.Mesh(new THREE.SphereGeometry(data.knuckleSize, 16, 16), handMaterial);
        knuckle.position.y = -segmentLength / 2;

        segmentGroup.add(segmentMesh);
        if(i > 0) segmentGroup.add(knuckle);

        currentSegmentGroup.add(segmentGroup);
        currentSegmentGroup = segmentGroup;
        cumulativeY += segmentLength;
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
    
    if (!isRecording) {
      joints.forEach(j => { 
        j.rotation.x = 0;
        j.children.forEach(child => {
            if(child instanceof THREE.Group) {
                 child.rotation.x = 0;
                 child.children.forEach(grandChild => {
                     if(grandChild instanceof THREE.Group) {
                         grandChild.rotation.x = 0;
                     }
                 });
            }
        });
      });
      if (wristRef.current) wristRef.current.rotation.z = 0;
      return;
    }
    
    if (sensorData.length === 6) {
      // sensorData maps to: thumb, index, middle, ring, pinky, wrist
      const setRotation = (joint: THREE.Group, value: number, maxAngle: number, isThumb = false) => {
        if (!joint) return;
        const mainRotation = value * maxAngle * 0.5;
        const midRotation = value * maxAngle * 0.6;
        const tipRotation = value * maxAngle * 0.7;

        if (isThumb) {
            joint.rotation.z = (value - 0.5) * Math.PI / 4;
            joint.rotation.y = value * Math.PI / 4;
        } else {
            joint.rotation.x = mainRotation;
        }

        const firstSegment = joint.children[0] as THREE.Group;
        if(firstSegment && firstSegment.children[1]) {
            const secondSegment = firstSegment.children[1] as THREE.Group;
            if (secondSegment) {
                secondSegment.rotation.x = midRotation;
                if(secondSegment.children[1]) {
                  const thirdSegment = secondSegment.children[1] as THREE.Group;
                  if (thirdSegment) {
                    thirdSegment.rotation.x = tipRotation;
                  }
                }
            }
        }
      };
      
      setRotation(joints[0], sensorData[0], Math.PI / 1.5, true);
      setRotation(joints[1], sensorData[1], Math.PI / 2);
      setRotation(joints[2], sensorData[2], Math.PI / 2);
      setRotation(joints[3], sensorData[3], Math.PI / 2);
      setRotation(joints[4], sensorData[4], Math.PI / 2);

      if (wristRef.current) {
        wristRef.current.rotation.z = (sensorData[5] - 0.5) * Math.PI / 4;
      }
    }
  }, [sensorData, isRecording]);

  return <div ref={mountRef} className="w-full h-[250px] cursor-grab active:cursor-grabbing rounded-b-lg" />;
}
