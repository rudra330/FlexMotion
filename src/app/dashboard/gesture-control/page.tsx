"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils
} from '@mediapipe/tasks-vision';
import { useDatabase } from '@/firebase';
import {
  ref, set, onValue, update,
  serverTimestamp,
  type DataSnapshot,
} from 'firebase/database';
import {
  listenToPatientsByDoctor,
  initiateCall,
  endCall,
  setTherapyMode,
  listenForIncomingPatientCalls,
  listenToActiveCall,
  startTherapySession,
  endTherapySession,
  updateTherapySessionReport,
  getLiveTrackingBasePath,
  getMotorControlPath,
  getSensorDataPath,
  setLiveTrackingStatus,
  writeLiveTrackingFrame,
  calculateDifference,
  HandGestureData,
  AngleTelemetry,
  PatientProfile,
  CallSession
} from "@/firebase/teleRehab";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { MirrorTherapy } from '@/components/mirror-therapy';
import { SensorCalibration } from '@/components/tele-rehab/SensorCalibration';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  CameraOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Play,
  Square,
  Tv,
  Loader2,
  Heart,
  Stethoscope,
  AlertCircle,
  Settings,
  Thermometer,
  Volume2
} from 'lucide-react';
import { calculateAngles, type HandAngles } from '@/lib/angle-calculator';
import { cn } from "@/lib/utils";
import { useWebRTC } from '@/hooks/use-webrtc';
import { useActiveCallMedia } from "@/components/tele-rehab/ActiveCallProvider";
import { PatientMedicalDetailsView } from "@/components/tele-rehab/PatientMedicalDetailsView";

// MediaPipe curl constants and calibration from notebook
const CURL_CALIBRATION = {
  thumb: { open: 0.15258437867594393, closed: 0.36826432430508527, gamma: 0.72, extraGain: 1.08 },
  index: { open: 0.18380438254924883, closed: 0.8475469901968142, gamma: 1.0, extraGain: 1.0 },
  middle: { open: 0.22302504549553925, closed: 0.9290651992581581, gamma: 1.0, extraGain: 1.0 },
  ring: { open: 0.15834001956399615, closed: 0.9159518292065456, gamma: 1.0, extraGain: 1.0 },
  pinky: { open: 0.1481649016722891, closed: 0.8365464727794193, gamma: 1.0, extraGain: 1.0 },
};

const SMOOTHING = 0.3;
const IDLE_RETURN = 0.06;
const MAX_CURL_SPEED = 1.35;
const BEND_NORMALIZATION_DEG = 100;

const POSE_HOLD_MS = 1500;
const SOFT_RETURN_MS = 3000;
const SUDDEN_OPEN_HOLD_MS = 900;
const TRACKING_MISS_GRACE_MS = 500;
const TRACKING_FRAME_STALL_MS = 750;
const TRACKING_WRITE_INTERVAL_MS = 25;
const TRACKING_HEARTBEAT_MS = 100;

const THUMB_FIST_TRIGGER = 0.52;
const THUMB_SUPPORT_STRENGTH = 0.78;
const THUMB_SUDDEN_OPEN_HOLD_MS = 1600;
const THUMB_MIN_HOLD_WHEN_FIST = 0.55;

function clamp(v: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function vec(a: any, b: any) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: (a.z || 0) - (b.z || 0),
  };
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
  return Math.acos(cosAngle) * 180 / Math.PI;
}

function bend01(a: any, b: any, c: any) {
  const angle = jointAngleDeg(a, b, c);
  const bendDeg = 180 - angle;
  return clamp(bendDeg / BEND_NORMALIZATION_DEG, 0, 1);
}

function calculateRawCurls(lm: any[]) {
  if (!lm || lm.length < 21) {
    return { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
  }
  return {
    thumb: clamp(bend01(lm[0], lm[1], lm[2]) * 0.30 + bend01(lm[1], lm[2], lm[3]) * 0.45 + bend01(lm[2], lm[3], lm[4]) * 0.25),
    index: clamp(bend01(lm[0], lm[5], lm[6]) * 0.20 + bend01(lm[5], lm[6], lm[7]) * 0.55 + bend01(lm[6], lm[7], lm[8]) * 0.25),
    middle: clamp(bend01(lm[0], lm[9], lm[10]) * 0.20 + bend01(lm[9], lm[10], lm[11]) * 0.55 + bend01(lm[10], lm[11], lm[12]) * 0.25),
    ring: clamp(bend01(lm[0], lm[13], lm[14]) * 0.20 + bend01(lm[13], lm[14], lm[15]) * 0.55 + bend01(lm[14], lm[15], lm[16]) * 0.25),
    pinky: clamp(bend01(lm[0], lm[17], lm[18]) * 0.20 + bend01(lm[17], lm[18], lm[19]) * 0.55 + bend01(lm[18], lm[19], lm[20]) * 0.25),
  };
}

function remap01(value: number, inMin: number, inMax: number) {
  if (Math.abs(inMax - inMin) < 1e-8) return 0;
  return clamp((value - inMin) / (inMax - inMin), 0, 1);
}

function calibrateFingerCurl(finger: "thumb" | "index" | "middle" | "ring" | "pinky", value: number) {
  const c = CURL_CALIBRATION[finger];
  let normalized = remap01(value, c.open, c.closed);
  normalized = Math.pow(normalized, c.gamma);
  return clamp(normalized * c.extraGain, 0, 1);
}

function calibrateCurls(raw: any) {
  return {
    thumb: calibrateFingerCurl("thumb", raw.thumb),
    index: calibrateFingerCurl("index", raw.index),
    middle: calibrateFingerCurl("middle", raw.middle),
    ring: calibrateFingerCurl("ring", raw.ring),
    pinky: calibrateFingerCurl("pinky", raw.pinky),
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function moveToward(current: number, target: number, maxDelta: number) {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function smoothFingerValue(current: number, target: number, smoothing: number, dt: number) {
  const eased = lerp(current, target, smoothing);
  const maxDelta = MAX_CURL_SPEED * dt;
  return moveToward(current, eased, maxDelta);
}

const zeroGesture = (): HandGestureData => ({
  thumb: 0,
  index: 0,
  middle: 0,
  ring: 0,
  pinky: 0,
  wrist: 0,
});

function anglesToGesture(angleState: HandAngles | null): HandGestureData {
  if (!angleState) return zeroGesture();
  return {
    thumb: angleState.fingers.thumb || 0,
    index: angleState.fingers.index || 0,
    middle: angleState.fingers.middle || 0,
    ring: angleState.fingers.ring || 0,
    pinky: angleState.fingers.pinky || 0,
    wrist: angleState.wrist.flexion || 0,
  };
}

function diffColor(diff: number) {
  const ratio = clamp(diff / 90, 0, 1);
  const hue = 120 - ratio * 120;
  return `hsl(${hue}, 85%, 45%)`;
}

export default function GestureControlPage() {
  const database = useDatabase();
  const { toast } = useToast();

  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");

  // MediaPipe state
  const [allowHandTracking, setAllowHandTracking] = useState(false);
  const [isLandmarkerReady, setIsLandmarkerReady] = useState(false);
  const [angles, setAngles] = useState<HandAngles | null>(null);
  const [doctorAngles, setDoctorAngles] = useState<HandGestureData | null>(null);
  const [patientAngles, setPatientAngles] = useState<HandGestureData | null>(null);
  const [differenceAngles, setDifferenceAngles] = useState<HandGestureData | null>(null);

  // Tracking states for Firebase Realtime Database telemetry syncing
  const rawCurlRef = useRef({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });
  const targetCurlRef = useRef({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });
  const currentCurlRef = useRef({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });
  const lastValidHandTimeRef = useRef(0);
  const lastGoodTargetCurlRef = useRef({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });
  const lastFingerGoodTimeRef = useRef({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });
  const lastFrameTimeRef = useRef(performance.now());
  const lastVideoTimeRef = useRef(-1);
  const lastVideoProgressTimeRef = useRef(0);
  const doctorHandLandmarkerRef = useRef<HandLandmarker | null>(null);
  const patientHandLandmarkerRef = useRef<HandLandmarker | null>(null);

  // Active call states
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [dialingPatientId, setDialingPatientId] = useState<string | null>(null);
  const [callSession, setCallSession] = useState<CallSession | null>(null);
  const [patientName, setPatientName] = useState("");

  // Doctor state
  const [patients, setPatients] = useState<Record<string, PatientProfile>>({});
  const [loadingPatients, setLoadingPatients] = useState(false);

  // Layout states
  const [isSwapped, setIsSwapped] = useState(false); // Swaps Main Screen and PiP Screen
  const [remoteAudioNeedsGesture, setRemoteAudioNeedsGesture] = useState(false);

  // Therapy Session States (Chapter 7)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [showRecordingPrompt, setShowRecordingPrompt] = useState(false);
  const [currentTherapySessionId, setCurrentTherapySessionId] = useState<string | null>(null);
  const [isRecordingEnabled, setIsRecordingEnabled] = useState(false);

  const recordedSensorLogRef = useRef<any[]>([]);
  const recordedMotorValveLogRef = useRef<any[]>([]);
  const lastSensorLogTimeRef = useRef(0);
  const sessionStartTimeRef = useRef(0);

  // Sensor Calibration States
  const [showCalibration, setShowCalibration] = useState(false);

  const lastAngleWriteTimeRef = useRef(0);
  const lastLandmarkerTimestampRef = useRef(0);
  const lastSentAngleStateRef = useRef<string | null>(null);
  const lastAngleLogTimeRef = useRef(0);
  const anglesRef = useRef<HandAngles | null>(null);
  const lastDetectedGestureRef = useRef<HandGestureData>(zeroGesture());
  const lastHandVisibleRef = useRef(false);
  const doctorAnglesRef = useRef<HandGestureData | null>(null);
  const patientAnglesRef = useRef<HandGestureData | null>(null);
  const trackingSessionKeyRef = useRef<string | null>(null);
  const rtdbConnectedRef = useRef(false);
  const [therapySpeed, setTherapySpeed] = useState(128);
  const therapySpeedRef = useRef(128);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const {
    localStream,
    localVideoRef: videoRef,
    cameraStatus,
    cameraError,
    isStreaming,
    isAudioMuted,
    isVideoMuted,
    startCamera,
    stopCamera,
    toggleAudio,
    toggleVideo,
  } = useActiveCallMedia();
  const connectedCallId = callSession?.status === "connected" ? activeCallId : null;
  const remoteStream = useWebRTC(connectedCallId, role, localStream, database);

  const requestCamera = useCallback(async () => {
    return startCamera({
      userId,
      doctorId: role === "doctor" ? userId : callSession?.doctorId,
      patientId: role === "patient" ? userId : callSession?.patientId || selectedPatientId,
    });
  }, [startCamera, userId, role, callSession?.doctorId, callSession?.patientId, selectedPatientId]);

  const stopCallCamera = useCallback(() => {
    stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    const unsubscribeConnection = database
      ? onValue(ref(database, ".info/connected"), (snapshot) => {
          const connected = snapshot.val() === true;
          rtdbConnectedRef.current = connected;
          if (connected) {
            lastSentAngleStateRef.current = null;
            lastAngleWriteTimeRef.current = 0;
          }
        })
      : null;

    return () => {
      unsubscribeConnection?.();
      rtdbConnectedRef.current = false;
    };
  }, [database]);

  const getTrackingIds = useCallback(() => {
    const doctorId = role === "doctor" ? userId : callSession?.doctorId || null;
    const patientId = role === "patient" ? userId : callSession?.patientId || selectedPatientId || null;
    return { doctorId, patientId };
  }, [role, userId, callSession?.doctorId, callSession?.patientId, selectedPatientId]);

  const getActiveMotorControlPath = useCallback(() => {
    const patientId = callSession?.patientId || selectedPatientId || (role === "patient" ? userId : null);
    return patientId ? getMotorControlPath(patientId) : null;
  }, [callSession?.patientId, selectedPatientId, role, userId]);

  const getActiveHandLandmarker = useCallback(() => {
    return role === "doctor" ? doctorHandLandmarkerRef.current : patientHandLandmarkerRef.current;
  }, [role]);

  // Keep the remote video element synchronized with the current WebRTC stream.
  useEffect(() => {
    const videoElement = remoteVideoRef.current;
    if (!videoElement) return;

    if (videoElement.srcObject !== remoteStream) {
      videoElement.srcObject = remoteStream;
    }
    if (!remoteStream) {
      videoElement.pause();
      return;
    }

    const tryPlay = () => {
      videoElement.muted = true;
      videoElement.play().catch((err) => {
        console.warn("[WebRTC] Video autoplay waiting for interaction or data:", err);
      });
    };

    tryPlay();
    videoElement.addEventListener("loadedmetadata", tryPlay);
    videoElement.addEventListener("loadeddata", tryPlay);
    videoElement.addEventListener("canplay", tryPlay);
    remoteStream.addEventListener("addtrack", tryPlay);
    remoteStream.getVideoTracks().forEach((t) => {
      t.addEventListener("unmute", tryPlay);
    });

    return () => {
      videoElement.removeEventListener("loadedmetadata", tryPlay);
      videoElement.removeEventListener("loadeddata", tryPlay);
      videoElement.removeEventListener("canplay", tryPlay);
      remoteStream.removeEventListener("addtrack", tryPlay);
      remoteStream.getVideoTracks().forEach((t) => {
        t.removeEventListener("unmute", tryPlay);
      });
    };
  }, [remoteStream]);

  // Keep remote audio independent from the always-muted autoplay video. This
  // avoids mobile browsers muting the call again while React rebinds video.
  useEffect(() => {
    const audioElement = remoteAudioRef.current;
    setRemoteAudioNeedsGesture(false);
    if (!audioElement) return;

    if (audioElement.srcObject !== remoteStream) {
      audioElement.srcObject = remoteStream;
    }
    if (!remoteStream) {
      audioElement.pause();
      return;
    }

    let cancelled = false;
    const hasLiveAudio = () => remoteStream
      .getAudioTracks()
      .some((track) => track.readyState === "live");
    const playRemoteAudio = async () => {
      if (cancelled || audioElement.srcObject !== remoteStream || !hasLiveAudio()) return;
      audioElement.muted = false;
      audioElement.volume = 1;
      try {
        await audioElement.play();
        if (!cancelled) setRemoteAudioNeedsGesture(false);
      } catch {
        if (!cancelled) setRemoteAudioNeedsGesture(true);
      }
    };
    const handleTrackChange = () => void playRemoteAudio();

    remoteStream.addEventListener("addtrack", handleTrackChange);
    remoteStream.addEventListener("removetrack", handleTrackChange);
    void playRemoteAudio();

    return () => {
      cancelled = true;
      remoteStream.removeEventListener("addtrack", handleTrackChange);
      remoteStream.removeEventListener("removetrack", handleTrackChange);
      audioElement.pause();
      if (audioElement.srcObject === remoteStream) audioElement.srcObject = null;
    };
  }, [remoteStream]);

  const enableRemoteAudio = useCallback(async () => {
    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) return;
    remoteAudio.muted = false;
    remoteAudio.volume = 1;
    try {
      await remoteAudio.play();
      setRemoteAudioNeedsGesture(false);
    } catch (error) {
      setRemoteAudioNeedsGesture(true);
      console.warn("[WebRTC] Browser still requires a media playback gesture", {
        callId: activeCallId,
        role,
        error,
      });
    }
  }, [activeCallId, role]);

  const bindLocalVideoElement = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    if (!element || !localStream) return;

    if (element.srcObject !== localStream) {
      element.srcObject = localStream;
    }
    element.muted = true;
    void element.play().catch((error) => {
      console.warn("[WebRTC] Local preview playback is not ready yet", {
        callId: activeCallId,
        role,
        name: (error as DOMException)?.name || "UnknownError",
        message: (error as DOMException)?.message || String(error),
      });
    });
  }, [videoRef, localStream, activeCallId, role, callSession?.therapyMode, allowHandTracking]);

  // Rebind after call state changes even when React preserves the same video node.
  useEffect(() => {
    const localVideo = videoRef.current;
    if (localVideo && localStream) {
      bindLocalVideoElement(localVideo);
      const retry = setTimeout(() => bindLocalVideoElement(videoRef.current), 250);
      return () => clearTimeout(retry);
    }
  }, [bindLocalVideoElement, localStream, videoRef]);

  // Fetch patient profile name dynamically when call is active
  useEffect(() => {
    if (!activeCallId || !database) {
      setPatientName("");
      return;
    }
    const parts = activeCallId.split("_");
    const patId = parts.slice(1).join("_");
    if (!patId) return;

    const patientNameRef = ref(database, `users/patients/${patId}/profile/name`);
    onValue(patientNameRef, (snapshot: DataSnapshot) => {
      if (snapshot.exists()) {
        setPatientName(snapshot.val());
      } else {
        setPatientName("Patient");
      }
    }, { onlyOnce: true });
  }, [activeCallId, database]);

  // Fetch session parameters on mount
  useEffect(() => {
    const storedRoleRaw = localStorage.getItem("flex_role");
    const storedRole = storedRoleRaw ? storedRoleRaw.toLowerCase().trim() : null;
    const storedUid = localStorage.getItem("flex_uid");
    const storedName = localStorage.getItem("flex_name") || "User";

    setRole(storedRole);
    setUserId(storedUid);
    setUserName(storedName);
  }, []);

  useEffect(() => {
    if (role !== "patient") return;
    const pendingCallId = sessionStorage.getItem("pending_call_id");
    if (!pendingCallId) return;
    setActiveCallId(pendingCallId);
    sessionStorage.removeItem("pending_call_id");
  }, [role]);

  // Preload role-owned HandLandmarker in the background so Therapy Mode starts instantly.
  useEffect(() => {
    if (role !== "doctor" && role !== "patient") return;
    let cancelled = false;
    setIsLandmarkerReady(false);
    const createHandLandmarker = async () => {
      try {
        const landmarkerRole = role;
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
        );
        const createLandmarker = (delegate: 'GPU' | 'CPU') => HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`,
            delegate,
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });
        let landmarker: HandLandmarker;
        try {
          landmarker = await createLandmarker('GPU');
        } catch (gpuError) {
          console.warn('[HAND_TRACKER_GPU_FALLBACK]', { role: landmarkerRole, error: gpuError });
          landmarker = await createLandmarker('CPU');
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        if (landmarkerRole === "doctor") {
          doctorHandLandmarkerRef.current?.close();
          doctorHandLandmarkerRef.current = landmarker;
        } else {
          patientHandLandmarkerRef.current?.close();
          patientHandLandmarkerRef.current = landmarker;
        }
        console.log("[HAND_TRACKER_READY]", {
          role: landmarkerRole,
          doctorLandmarker: !!doctorHandLandmarkerRef.current,
          patientLandmarker: !!patientHandLandmarkerRef.current,
        });
        setIsLandmarkerReady(true);
      } catch (error) {
        console.error('Failed to create HandLandmarker:', error);
        toast({
          variant: 'destructive',
          title: 'Model Loading Failed',
          description: 'Could not resolve the hand tracking libraries. Please try again.',
        });
      }
    };
    createHandLandmarker();

    return () => {
      cancelled = true;
      if (role === "doctor") {
        doctorHandLandmarkerRef.current?.close();
        doctorHandLandmarkerRef.current = null;
      } else if (role === "patient") {
        patientHandLandmarkerRef.current?.close();
        patientHandLandmarkerRef.current = null;
      }
      setIsLandmarkerReady(false);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [role, toast]);

  // Load patient list if user is a doctor
  useEffect(() => {
    if (role !== "doctor" || !userId || !database) return;
    setLoadingPatients(true);
    return listenToPatientsByDoctor(userId, (roster) => {
      setPatients(roster);
      setLoadingPatients(false);
    }, database);
  }, [role, userId, database]);

  // Sync active connected call for patient
  useEffect(() => {
    if (role === "patient" && userId && database) {
      const unsubscribe = listenForIncomingPatientCalls(userId, (calls) => {
        const activeConn = Object.entries(calls).find(([_, call]) => call.status === "connected");
        if (activeConn) {
          const [id] = activeConn;
          setActiveCallId(id);
        } else {
          const dialingCall = Object.entries(calls).find(([_, call]) => call.status === "dialing");
          if (!dialingCall) {
            setActiveCallId(null);
            setCallSession(null);
          }
        }
      }, database);
      return () => unsubscribe();
    }
  }, [role, userId, database]);

  // Restore the doctor's current call after a refresh or temporary network interruption.
  useEffect(() => {
    if (role !== "doctor" || !userId || !database) return;

    return onValue(ref(database, "activeCalls"), (snapshot) => {
      const callTimestamp = (value: object | string) => typeof value === "string" ? Date.parse(value) : 0;
      const calls = snapshot.exists() ? snapshot.val() as Record<string, CallSession> : {};
      const matchingCalls = Object.entries(calls)
        .filter(([, call]) => call.doctorId === userId && call.status !== "disconnected")
        .sort(([, first], [, second]) => {
          return callTimestamp(second.updatedAt || second.createdAt) - callTimestamp(first.updatedAt || first.createdAt);
        });
      const connectedCall = matchingCalls.find(([, call]) => call.status === "connected");
      const currentCall = connectedCall || matchingCalls[0];

      if (!currentCall) {
        setActiveCallId(null);
        setDialingPatientId(null);
        return;
      }

      const [callId, call] = currentCall;
      setActiveCallId(callId);
      setSelectedPatientId(call.patientId);
      setDialingPatientId(call.status === "dialing" ? call.patientId : null);
    });
  }, [role, userId, database]);

  // This is the only automatic camera startup path for a video call.
  useEffect(() => {
    if (!activeCallId || callSession?.status !== "connected") return;
    if (localStream || cameraStatus === "starting" || cameraStatus === "ready") return;
    if (cameraStatus === "failed") return;
    void requestCamera();
  }, [activeCallId, callSession?.status, localStream, cameraStatus, requestCamera]);

  useEffect(() => {
    if (role !== "doctor" && role !== "patient") return;
    setAllowHandTracking(!!activeCallId && callSession?.status === "connected" && !!callSession?.therapyMode);
  }, [role, activeCallId, callSession?.status, callSession?.therapyMode]);

  // Automatically stop camera when call disconnects or activeCallId is cleared
  useEffect(() => {
    if (!activeCallId && isStreaming) {
      stopCallCamera();
    }
  }, [activeCallId, isStreaming, stopCallCamera]);

  // Listen to active call node in real-time
  useEffect(() => {
    if (!activeCallId || !database) {
      setCallSession(null);
      return;
    }

    const unsubscribe = listenToActiveCall(activeCallId, (session) => {
      setCallSession(session);
      if (session) {
        if (session.status === "disconnected") {
          toast({
            title: "Call Session Ended",
            description: "Connection was terminated cleanly.",
          });
          setActiveCallId(null);
          setDialingPatientId(null);
        } else if (session.status === "connected" && dialingPatientId) {
          toast({
            title: "Connection Confirmed",
            description: "Direct tele-mirroring tunnel established.",
          });
          setDialingPatientId(null);
        }
      } else {
        setActiveCallId(null);
        setDialingPatientId(null);
      }
    }, database);

    return () => unsubscribe();
  }, [database, activeCallId, dialingPatientId, stopCallCamera, toast]);

  useEffect(() => {
    if (!database || !callSession?.doctorId || !callSession?.patientId) {
      setDoctorAngles(null);
      setPatientAngles(null);
      setDifferenceAngles(null);
      return;
    }

    const basePath = getLiveTrackingBasePath(callSession.doctorId, callSession.patientId);
    const doctorAnglesDbRef = ref(database, `${basePath}/doctor`);
    const patientAnglesDbRef = ref(database, `${basePath}/patient`);
    const differenceRef = ref(database, `${basePath}/difference`);

    const unsubscribeDoctor = onValue(doctorAnglesDbRef, (snapshot) => {
      const value = snapshot.exists() ? snapshot.val() as AngleTelemetry : null;
      doctorAnglesRef.current = value;
      if (role !== "doctor") {
        setDoctorAngles(value);
      }
    });
    const unsubscribePatient = onValue(patientAnglesDbRef, (snapshot) => {
      const value = snapshot.exists() ? snapshot.val() as AngleTelemetry : null;
      patientAnglesRef.current = value;
      if (role !== "patient") {
        setPatientAngles(value);
      }
    });
    const unsubscribeDifference = onValue(differenceRef, (snapshot) => {
      if (snapshot.exists()) {
        setDifferenceAngles(snapshot.val() as HandGestureData);
      }
    });

    return () => {
      unsubscribeDoctor();
      unsubscribePatient();
      unsubscribeDifference();
    };
  }, [database, callSession?.doctorId, callSession?.patientId]);

  // Recalculate Difference Heatmap continuously at 60 FPS whenever either hand updates
  useEffect(() => {
    if (doctorAngles && patientAngles) {
      setDifferenceAngles(calculateDifference(doctorAngles, patientAngles));
    } else if (!doctorAngles && !patientAngles) {
      setDifferenceAngles(null);
    }
  }, [doctorAngles, patientAngles]);

  // Motor/Valve Log Listener during Active Session
  useEffect(() => {
    if (role === "doctor" && currentTherapySessionId && database) {
      const recordingPatientId = selectedPatientId;
      if (!recordingPatientId) return;
      const motorControlPath = getMotorControlPath(recordingPatientId);
      const motorRef = ref(database, motorControlPath);
      const unsubscribeMotor = onValue(motorRef, (snapshot) => {
        if (snapshot.exists() && isRecordingEnabled) {
          recordedMotorValveLogRef.current.push({
            timestamp: new Date().toISOString(),
            ...snapshot.val()
          });
        }
      });

      const sensorRef = ref(database, getSensorDataPath(recordingPatientId));
      const unsubscribeSensor = onValue(sensorRef, (snapshot) => {
        if (snapshot.exists() && isRecordingEnabled) {
          const now = performance.now();
          if (now - lastSensorLogTimeRef.current >= 1000) { // 1Hz sampling
            const data = snapshot.val();
            recordedSensorLogRef.current.push({
              timestamp: new Date().toISOString(),
              sessionTime: Math.floor((now - sessionStartTimeRef.current) / 1000),
              thumb: data.thumb ?? data.flex1 ?? 0,
              index: data.index ?? data.flex2 ?? 0,
              middle: data.middle ?? data.flex3 ?? 0,
              ring: data.ring ?? data.flex4 ?? 0,
              pinky: data.pinky ?? data.flex5 ?? 0,
              wrist: data.wrist ?? 0
            });
            lastSensorLogTimeRef.current = now;
          }
        }
      });

      return () => {
        unsubscribeMotor();
        unsubscribeSensor();
      };
    }
  }, [role, currentTherapySessionId, database, isRecordingEnabled, selectedPatientId]);

  const publishLiveTrackingFrame = useCallback((gesturePayload: HandGestureData, handVisible: boolean) => {
    const { doctorId, patientId } = getTrackingIds();
    const canWriteDoctor =
      role === "doctor" &&
      allowHandTracking &&
      !!activeCallId &&
      callSession?.status === "connected" &&
      !!doctorId &&
      !!patientId;
    const canWritePatient =
      role === "patient" &&
      allowHandTracking &&
      !!activeCallId &&
      callSession?.status === "connected" &&
      !!doctorId &&
      !!patientId;

    if (!database || (!canWriteDoctor && !canWritePatient) || !doctorId || !patientId) return;

    const now = performance.now();
    const source = role === "doctor" ? "doctor" : "patient";

    const sanitizedPayload: HandGestureData = {
      thumb: Math.round((gesturePayload.thumb || 0) * 10) / 10,
      index: Math.round((gesturePayload.index || 0) * 10) / 10,
      middle: Math.round((gesturePayload.middle || 0) * 10) / 10,
      ring: Math.round((gesturePayload.ring || 0) * 10) / 10,
      pinky: Math.round((gesturePayload.pinky || 0) * 10) / 10,
      wrist: Math.round((gesturePayload.wrist || 0) * 10) / 10,
    };

    // UI and heatmap state update immediately; network writes run separately below.
    if (source === "doctor") {
      doctorAnglesRef.current = sanitizedPayload;
      setDoctorAngles(sanitizedPayload);
    } else {
      patientAnglesRef.current = sanitizedPayload;
      setPatientAngles(sanitizedPayload);
    }

    const stateKey = `${source}-${sanitizedPayload.thumb}-${sanitizedPayload.index}-${sanitizedPayload.middle}-${sanitizedPayload.ring}-${sanitizedPayload.pinky}-${sanitizedPayload.wrist}-${handVisible ? 1 : 0}`;
    const stateChanged = stateKey !== lastSentAngleStateRef.current;
    const fastWriteReady = now - lastAngleWriteTimeRef.current >= TRACKING_WRITE_INTERVAL_MS;
    const heartbeatReady = now - lastAngleWriteTimeRef.current >= TRACKING_HEARTBEAT_MS;

    if (!((stateChanged && fastWriteReady) || heartbeatReady)) return;

    lastSentAngleStateRef.current = stateKey;
    lastAngleWriteTimeRef.current = now;

    // Firebase acknowledgement latency must never block later tracking frames.
    // The 25 ms publisher throttle bounds the write rate, while each update is
    // submitted immediately so either participant can recover independently.
    void writeLiveTrackingFrame(
      database,
      source,
      doctorId,
      patientId,
      sanitizedPayload,
      {
        callId: activeCallId,
        handVisible,
        isTracking: handVisible,
        peerAngles: source === "doctor" ? patientAnglesRef.current : null,
      }
    ).catch((error) => {
      console.error("[RTDB_LIVE_TRACKING_WRITE_FAILED]", {
        userId: source === "doctor" ? doctorId : patientId,
        doctorId,
        patientId,
        source,
        path: `${getLiveTrackingBasePath(doctorId, patientId)}/${source}`,
        error,
      });
    });
  }, [activeCallId, allowHandTracking, callSession?.status, database, getTrackingIds, role]);

  // MediaPipe detection loops
  const predictWebcam = useCallback(async () => {
    const isDoctorTracking =
      role === "doctor" &&
      allowHandTracking &&
      isLandmarkerReady &&
      callSession?.status === "connected" &&
      !!activeCallId;
    const isPatientTracking =
      role === "patient" &&
      allowHandTracking &&
      isLandmarkerReady &&
      callSession?.status === "connected" &&
      !!activeCallId &&
      !!userId;

    if (!isDoctorTracking && !isPatientTracking) {
      return;
    }

    const activeHandLandmarker = getActiveHandLandmarker();
    if (!videoRef.current || !canvasRef.current || !activeHandLandmarker || !isStreaming) {
      animationFrameId.current = requestAnimationFrame(predictWebcam);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');

    if (!canvasCtx) return;

    if (
      video.readyState < 2 ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    ) {
      if (isStreaming) {
        animationFrameId.current = requestAnimationFrame(predictWebcam);
      }
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const frameNow = performance.now();
    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      lastVideoProgressTimeRef.current = frameNow;

      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

      try {
        if (role === "doctor" || role === "patient") {
          // Strictly increasing timestamp for MediaPipe HandLandmarker
          const landmarkerTimestamp = frameNow > lastLandmarkerTimestampRef.current
            ? frameNow
            : lastLandmarkerTimestampRef.current + 1;
          lastLandmarkerTimestampRef.current = landmarkerTimestamp;

          const results = activeHandLandmarker.detectForVideo(video, landmarkerTimestamp);
          const drawingUtils = new DrawingUtils(canvasCtx);

          const now = frameNow;
          const dt = Math.min((now - lastFrameTimeRef.current) / 1000, 0.05);
          lastFrameTimeRef.current = now;

          if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0];

            const connectorColor = role === "doctor" ? "#6366f1" : "#22c55e";
            const landmarkColor = role === "doctor" ? "#a5b4fc" : "#86efac";
            drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: connectorColor, lineWidth: 5 });
            drawingUtils.drawLandmarks(landmarks, { color: landmarkColor, lineWidth: 2, radius: 4 });

            const raw = calculateRawCurls(landmarks);
            rawCurlRef.current = raw;

            let calibrated = calibrateCurls(raw);

            // Apply Anti-Reset Guard
            const guarded = { ...calibrated };
            for (const f of Object.keys(guarded)) {
              const finger = f as "thumb" | "index" | "middle" | "ring" | "pinky";
              const newValue = guarded[finger];
              const previousGood = lastGoodTargetCurlRef.current[finger];
              const currentValue = currentCurlRef.current[finger];

              const isThumb = finger === "thumb";
              const bentThreshold = isThumb ? 0.22 : 0.35;
              const dropThreshold = isThumb ? 0.16 : 0.35;
              const openThreshold = isThumb ? 0.24 : 0.12;
              const holdMs = isThumb ? THUMB_SUDDEN_OPEN_HOLD_MS : SUDDEN_OPEN_HOLD_MS;

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
              }
            }

            // Apply Thumb Fist Support
            const fourAvg = (guarded.index + guarded.middle + guarded.ring + guarded.pinky) / 4.0;
            if (fourAvg >= THUMB_FIST_TRIGGER) {
              const fist01 = remap01(fourAvg, THUMB_FIST_TRIGGER, 1.0);
              const thumbSupportValue = clamp(
                THUMB_MIN_HOLD_WHEN_FIST + fist01 * (THUMB_SUPPORT_STRENGTH - THUMB_MIN_HOLD_WHEN_FIST),
                0, 1
              );
              guarded.thumb = Math.max(
                guarded.thumb,
                thumbSupportValue,
                lastGoodTargetCurlRef.current.thumb * 0.9,
                currentCurlRef.current.thumb * 0.9
              );
            }

            targetCurlRef.current = guarded;
            lastGoodTargetCurlRef.current = { ...guarded };
            lastValidHandTimeRef.current = now;

            // Smooth currentCurl
            for (const f of Object.keys(currentCurlRef.current)) {
              const finger = f as "thumb" | "index" | "middle" | "ring" | "pinky";
              currentCurlRef.current[finger] = smoothFingerValue(
                currentCurlRef.current[finger],
                targetCurlRef.current[finger],
                SMOOTHING,
                dt
              );
            }

            const calculatedAngles = calculateAngles(landmarks);
            setAngles(calculatedAngles);
            anglesRef.current = calculatedAngles;
            const gesturePayload = anglesToGesture(calculatedAngles);
            lastDetectedGestureRef.current = gesturePayload;
            lastHandVisibleRef.current = true;
            publishLiveTrackingFrame(gesturePayload, true);
            const { doctorId, patientId } = getTrackingIds();
            if (now - lastAngleLogTimeRef.current >= 250) {
              lastAngleLogTimeRef.current = now;
              console.log("[ANGLE_UPDATE]", {
                userId,
                doctorId,
                patientId,
                path: doctorId && patientId ? `${getLiveTrackingBasePath(doctorId, patientId)}/${role}` : null,
                angleValues: gesturePayload,
              });
            }
          } else {
            setAngles(null);
            anglesRef.current = null;

            const timeSinceSeen = now - lastValidHandTimeRef.current;
            let newTarget = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };

            if (timeSinceSeen < POSE_HOLD_MS) {
              newTarget = { ...lastGoodTargetCurlRef.current };
            } else if (timeSinceSeen < SOFT_RETURN_MS) {
              const fade = clamp((timeSinceSeen - POSE_HOLD_MS) / (SOFT_RETURN_MS - POSE_HOLD_MS), 0, 1);
              newTarget = {
                thumb: lerp(lastGoodTargetCurlRef.current.thumb, 0, fade),
                index: lerp(lastGoodTargetCurlRef.current.index, 0, fade),
                middle: lerp(lastGoodTargetCurlRef.current.middle, 0, fade),
                ring: lerp(lastGoodTargetCurlRef.current.ring, 0, fade),
                pinky: lerp(lastGoodTargetCurlRef.current.pinky, 0, fade),
              };
            }

            targetCurlRef.current = newTarget;
            if (timeSinceSeen >= TRACKING_MISS_GRACE_MS) {
              lastHandVisibleRef.current = false;
              lastDetectedGestureRef.current = zeroGesture();
              publishLiveTrackingFrame(zeroGesture(), false);
            }

            // Smooth currentCurl
            for (const f of Object.keys(currentCurlRef.current)) {
              const finger = f as "thumb" | "index" | "middle" | "ring" | "pinky";
              currentCurlRef.current[finger] = smoothFingerValue(
                currentCurlRef.current[finger],
                targetCurlRef.current[finger],
                IDLE_RETURN,
                dt
              );
            }

          }
        } else {
          setAngles(null);
        }
      } catch (err) {
        console.warn("MediaPipe tracker loop encountered an error, keeping animation frame alive.", err);
      }
      canvasCtx.restore();
    } else if (frameNow - lastVideoProgressTimeRef.current >= TRACKING_FRAME_STALL_MS) {
      // A paused/backgrounded/stalled local video must not leave a permanently
      // "live" pose in Firebase while the other participant keeps updating.
      lastHandVisibleRef.current = false;
      publishLiveTrackingFrame(lastDetectedGestureRef.current, false);
      if (video.paused && isStreaming) {
        void video.play().catch(() => undefined);
      }
    }

    // Check strict requirements before scheduling next frame
    const shouldRun =
      isStreaming &&
      allowHandTracking &&
      isLandmarkerReady &&
      (role === "doctor" || role === "patient") &&
      activeCallId &&
      callSession?.status === "connected";

    if (shouldRun) {
      animationFrameId.current = requestAnimationFrame(predictWebcam);
    }
  }, [isStreaming, allowHandTracking, isLandmarkerReady, role, activeCallId, callSession?.status, userId, getTrackingIds, getActiveHandLandmarker, publishLiveTrackingFrame]);

  useEffect(() => {
    const shouldRun =
      isStreaming &&
      allowHandTracking &&
      isLandmarkerReady &&
      (role === "doctor" || role === "patient") &&
      activeCallId &&
      callSession?.status === "connected";

    if (shouldRun) {
      const trackingSessionKey = `${activeCallId}:${role}`;
      if (trackingSessionKeyRef.current !== trackingSessionKey) {
        trackingSessionKeyRef.current = trackingSessionKey;
        lastVideoTimeRef.current = -1;
        lastVideoProgressTimeRef.current = performance.now();
        lastFrameTimeRef.current = performance.now();
        lastDetectedGestureRef.current = zeroGesture();
        lastHandVisibleRef.current = false;
        lastSentAngleStateRef.current = null;
        lastAngleWriteTimeRef.current = 0;
      }
      console.log("[HAND_TRACKING_STARTED]", {
        userId,
        doctorId: getTrackingIds().doctorId,
        patientId: getTrackingIds().patientId,
        path: getTrackingIds().doctorId && getTrackingIds().patientId
          ? getLiveTrackingBasePath(getTrackingIds().doctorId!, getTrackingIds().patientId!)
          : null,
        angleValues: anglesToGesture(anglesRef.current),
      });
      void predictWebcam();
    } else {
      trackingSessionKeyRef.current = null;
      setAngles(null);
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [isStreaming, allowHandTracking, isLandmarkerReady, role, activeCallId, callSession?.status, predictWebcam, userId, getTrackingIds]);

  // Keep each participant's RTDB branch alive independently of the drawing
  // frame rate. This also gives the peer a prompt recovery heartbeat after a
  // briefly throttled tab or delayed camera frame, while changed poses still
  // publish at the faster 50 ms frame throttle above.
  useEffect(() => {
    const trackingActive =
      isStreaming &&
      allowHandTracking &&
      isLandmarkerReady &&
      (role === "doctor" || role === "patient") &&
      !!activeCallId &&
      callSession?.status === "connected";
    if (!trackingActive) return;

    const heartbeat = window.setInterval(() => {
      publishLiveTrackingFrame(lastDetectedGestureRef.current, lastHandVisibleRef.current);
    }, TRACKING_HEARTBEAT_MS);

    const recoverVisibleTracker = () => {
      lastVideoTimeRef.current = -1;
      lastVideoProgressTimeRef.current = performance.now();
      lastSentAngleStateRef.current = null;
      lastAngleWriteTimeRef.current = 0;
      if (!document.hidden && videoRef.current) {
        void videoRef.current.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", recoverVisibleTracker);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", recoverVisibleTracker);
    };
  }, [isStreaming, allowHandTracking, isLandmarkerReady, role, activeCallId, callSession?.status, publishLiveTrackingFrame, videoRef]);

  // Mark only this device's tracking branch inactive whenever its tracker is
  // torn down. This prevents a route change, refresh, or camera failure from
  // leaving the last pose marked as live while the peer continues updating.
  useEffect(() => {
    const trackingActive =
      !!database &&
      !!activeCallId &&
      allowHandTracking &&
      callSession?.status === "connected" &&
      (role === "doctor" || role === "patient");
    const { doctorId, patientId } = getTrackingIds();
    if (!trackingActive || !database || !doctorId || !patientId || !role) return;

    const basePath = getLiveTrackingBasePath(doctorId, patientId);
    const source = role as "doctor" | "patient";
    return () => {
      const now = Date.now();
      void update(ref(database), {
        [`${basePath}/${source}/handVisible`]: false,
        [`${basePath}/${source}/isTracking`]: false,
        [`${basePath}/${source}/updatedAt`]: now,
        [`${basePath}/status/${source}Tracking`]: false,
        [`${basePath}/status/updatedAt`]: now,
      }).catch((error) => console.error("[RTDB_TRACKING_CLEANUP_FAILED]", error));
    };
  }, [database, activeCallId, allowHandTracking, callSession?.status, role, getTrackingIds]);

  // Doctor Action Handlers
  const handleDialCall = async (patientId: string) => {
    if (!userId || !database) return;
    try {
      setDialingPatientId(patientId);
      const callId = await initiateCall(userId, patientId, database);
      setActiveCallId(callId);
      toast({
        title: "Clinical Calling...",
        description: `Dialing patient terminal. Please wait.`,
      });
    } catch (err: any) {
      setDialingPatientId(null);
      toast({
        title: "Calling Failed",
        description: err.message || "Failed to initiate session.",
        variant: "destructive"
      });
    }
  };

  const handleDisconnectCall = async () => {
    if (!activeCallId || !database) return;
    try {
      if (role === "doctor") {
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext("2d");
          if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }

        // Emergency / OFF safe state (End Call)
        const motorControlPath = getActiveMotorControlPath();
        if (motorControlPath) update(ref(database, motorControlPath), {
          masterEnabled: false, enabled: false, speed: 0,
          v1_enabled: false, v2_enabled: false, v3_enabled: false, v4_enabled: false, v5_enabled: false, v6_enabled: false
        }).catch(console.error);
        const { doctorId, patientId } = getTrackingIds();
        if (doctorId && patientId) {
          setLiveTrackingStatus(database, doctorId, patientId, {
            therapyActive: false,
            doctorTracking: false,
            patientTracking: false,
          }).catch(console.error);
        }
      }
      await endCall(activeCallId, database);
      setActiveCallId(null);
      setCallSession(null);
      setDialingPatientId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const confirmStartTherapy = async (enableRecording: boolean) => {
    setShowRecordingPrompt(false);
    setIsRecordingEnabled(enableRecording);

    if (!activeCallId || !database || !selectedPatientId || !userId) return;
    
    try {
      recordedSensorLogRef.current = [];
      recordedMotorValveLogRef.current = [];
      sessionStartTimeRef.current = performance.now();
      lastSensorLogTimeRef.current = 0;

      const pName = patients[selectedPatientId]?.name || "Patient";
      const sessionId = await startTherapySession(
        userId, selectedPatientId, userName, pName, activeCallId, enableRecording, database
      );
      setCurrentTherapySessionId(sessionId);

      await executeToggleTherapy(true);

      if (!enableRecording) {
        // Skip calibration if not recording
        lastSentAngleStateRef.current = null;
        lastAngleWriteTimeRef.current = 0;
        setAllowHandTracking(true);
        // Force Master Control ON
        update(ref(database, getMotorControlPath(selectedPatientId)), { masterEnabled: true, enabled: true }).catch(console.error);

        toast({
          title: "Therapy Session Started",
          description: "Data recording disabled. Hand tracking and master control active.",
        });
        setLiveTrackingStatus(database, userId, selectedPatientId, {
          therapyActive: true,
          doctorTracking: true,
        }).catch(console.error);
      } else {
        // Keep doctor MediaPipe/RTDB telemetry active while the sensor calibration UI is open.
        setShowCalibration(true);
        lastSentAngleStateRef.current = null;
        lastAngleWriteTimeRef.current = 0;
        setAllowHandTracking(true);
        setLiveTrackingStatus(database, userId, selectedPatientId, {
          therapyActive: true,
          doctorTracking: true,
        }).catch(console.error);
      }

    } catch (e: any) {
      toast({ variant: 'destructive', title: "Error", description: e.message });
    }
  };

  const handleToggleTherapyClick = (enabled: boolean) => {
    if (enabled) {
      if (!selectedPatientId) {
        toast({ variant: 'destructive', title: "No Patient Selected", description: "Select a patient from the roster first to tie the record." });
        return;
      }
      setShowRecordingPrompt(true);
    } else {
      handleStopTherapy();
    }
  };

  const handleStopTherapy = async () => {
    if (!currentTherapySessionId || !selectedPatientId || !userId) return;
    try {
      const duration = Math.floor((performance.now() - sessionStartTimeRef.current) / 1000);
      await endTherapySession(userId, selectedPatientId, currentTherapySessionId, duration, database);

      // Compute averages
      let thumbAvg = 0, indexAvg = 0, middleAvg = 0, ringAvg = 0, pinkyAvg = 0, wristAvg = 0;
      const count = recordedSensorLogRef.current.length;
      if (count > 0) {
        recordedSensorLogRef.current.forEach(log => {
          thumbAvg += log.thumb; indexAvg += log.index; middleAvg += log.middle;
          ringAvg += log.ring; pinkyAvg += log.pinky; wristAvg += log.wrist;
        });
        thumbAvg /= count; indexAvg /= count; middleAvg /= count; ringAvg /= count; pinkyAvg /= count; wristAvg /= count;
      }

      // Motor summary mock (could be expanded)
      const mCount = recordedMotorValveLogRef.current.length;
      let motorSpeedAvg = 0;
      if (mCount > 0) {
        recordedMotorValveLogRef.current.forEach(log => motorSpeedAvg += log.speed);
        motorSpeedAvg /= mCount;
      }

      await updateTherapySessionReport(userId, selectedPatientId, currentTherapySessionId, {
        flexSensorSummary: { thumbAvg, indexAvg, middleAvg, ringAvg, pinkyAvg, wristAvg, sampleCount: count },
        motorValveSummary: { motorSpeedAvg, totalPumpOnTimeSec: duration },
        sensorLog: recordedSensorLogRef.current,
        motorLog: recordedMotorValveLogRef.current
      } as any, database);

      setCurrentTherapySessionId(null);
      setAllowHandTracking(false);
      setShowCalibration(false);
      await executeToggleTherapy(false);
      setLiveTrackingStatus(database, userId, selectedPatientId, {
        therapyActive: false,
        doctorTracking: false,
        patientTracking: false,
      }).catch(console.error);
      toast({ title: "Therapy Session Ended", description: `Session duration: ${duration}s recorded.` });
    } catch (e) {
       console.error(e);
    }
  };

  const handleTherapySpeedChange = useCallback((val: number[]) => {
    const newSpeed = val[0];
    setTherapySpeed(newSpeed);
    therapySpeedRef.current = newSpeed;
    const motorControlPath = getActiveMotorControlPath();
    if (database && motorControlPath) {
      update(ref(database, motorControlPath), { speed: newSpeed, updatedAt: Date.now() }).catch(console.error);
    }
  }, [database, getActiveMotorControlPath]);

  const executeToggleTherapy = async (enabled: boolean) => {
    if (!activeCallId || !database) return;
    try {
      console.log("Start Therapy Mode clicked");
      await setTherapyMode(activeCallId, enabled, database);

      if (enabled && role === "doctor") {
        // Fetch current speed to initialize slider
        const motorControlPath = getActiveMotorControlPath();
        const speedRef = motorControlPath ? ref(database, `${motorControlPath}/speed`) : null;
        if (speedRef) onValue(speedRef, (snapshot) => {
          if (snapshot.exists()) {
            const currentSpeed = snapshot.val();
            setTherapySpeed(currentSpeed);
            therapySpeedRef.current = currentSpeed;
          }
        }, { onlyOnce: true });

        const videoElement = videoRef.current;
        if (videoElement) {
          try { await videoElement.play(); } catch(e) {}

          if (videoElement.readyState < 2) {
            await new Promise((resolve) => {
              videoElement.onloadeddata = resolve;
            });
          }
        }
      }

      if (!enabled && role === "doctor") {
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext("2d");
          if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
        // Emergency / OFF safe state
        const motorControlPath = getActiveMotorControlPath();
        if (motorControlPath) update(ref(database, motorControlPath), {
          masterEnabled: false, enabled: false, speed: 0,
          v1_enabled: false, v2_enabled: false, v3_enabled: false, v4_enabled: false, v5_enabled: false, v6_enabled: false
        }).catch(console.error);
        const { doctorId, patientId } = getTrackingIds();
        if (doctorId && patientId) {
          setLiveTrackingStatus(database, doctorId, patientId, {
            therapyActive: false,
            doctorTracking: false,
            patientTracking: false,
          }).catch(console.error);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (!userId || !role) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  // --- RENDERING DOCTOR WORKSPACE ---
  if (role === "doctor") {
    const isCallConnected = callSession?.status === "connected";
    const isTherapyActive = !!callSession?.therapyMode;
    const calibrationPatientId = callSession?.patientId || selectedPatientId || userId;

    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        {/* Start Therapy Modal (Recording Prompt) */}
        {showRecordingPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <Card className="w-full max-w-md bg-slate-900 border-slate-700 text-center">
              <CardHeader>
                <CardTitle>Start Therapy Session</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-slate-300">Do you want to record flex sensor data and motor activity for this session?</p>
                <div className="flex flex-col gap-2">
                  <Button onClick={() => confirmStartTherapy(true)} className="bg-emerald-600 hover:bg-emerald-700">
                    Start Therapy With Recording
                  </Button>
                  <Button onClick={() => confirmStartTherapy(false)} className="bg-indigo-600 hover:bg-indigo-700">
                    Start Therapy Without Recording
                  </Button>
                  <Button variant="outline" onClick={() => setShowRecordingPrompt(false)} className="mt-2 text-slate-300 border-slate-700 hover:bg-slate-800">
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sensor Calibration Modal */}
        {showCalibration && database && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
            <div className="w-full max-w-lg">
              <SensorCalibration
                database={database}
                motorControlPath={getMotorControlPath(calibrationPatientId)}
                sensorDataPath={getSensorDataPath(calibrationPatientId)}
                onCalibrationComplete={(thresholds) => {
                  setShowCalibration(false);

                  lastSentAngleStateRef.current = null;
                  lastAngleWriteTimeRef.current = 0;
                  setAllowHandTracking(true);

                  // SAVE TO FIREBASE
                  const targetPatientId = callSession?.patientId || selectedPatientId || userId;
                  const payload = {
                    patientId: targetPatientId,
                    doctorId: userId,
                    thresholds,
                    status: 'active',
                    baselineUpdateIntervalMs: 300,
                    updatedAt: serverTimestamp()
                  };
                  set(ref(database, `calibrationThresholds/${targetPatientId}`), payload).catch((err) => {
                    console.error("Failed to save calibration thresholds:", err);
                  });

                  update(ref(database, getMotorControlPath(targetPatientId)), { masterEnabled: true, enabled: true, updatedAt: Date.now() }).catch(console.error);
                  setLiveTrackingStatus(database, userId, targetPatientId, {
                    therapyActive: true,
                    doctorTracking: true,
                  }).catch(console.error);
                  toast({ title: 'Calibration Complete', description: 'Flex sensor thresholds calculated. Live tracking and master control activated.' });
                }}
                onCancel={() => setShowCalibration(false)}
              />
            </div>
          </div>
        )}

        <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Clinician Portal</span>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2 mt-1">
                <Stethoscope className="h-6 w-6 text-indigo-500" />
                Tele-Rehab Session Hub
              </CardTitle>
            </div>
            {isCallConnected && (
              <Badge className="bg-indigo-650 text-white uppercase text-xs font-extrabold px-3 py-1 animate-pulse shrink-0">
                Live Channel Connected
              </Badge>
            )}
          </CardHeader>
        </Card>

        {/* Not in active call: Show Patients Calling roster list */}
        {!activeCallId && (
          <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-white">Supervised Patient Roster</CardTitle>
              <CardDescription className="text-slate-400">Select an assigned patient to establish a live therapy connection.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingPatients ? (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                  <span>Loading clinical list...</span>
                </div>
              ) : Object.keys(patients).length === 0 ? (
                <div className="text-center py-12 border border-slate-800 border-dashed rounded-xl text-slate-500">
                  No patient profiles assigned.
                </div>
              ) : (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                  {Object.entries(patients).map(([id, pat]) => {
                    const isShowingDetails = selectedPatientId === id;
                    return (
                      <div key={id} className="space-y-4 rounded-xl border border-slate-850 bg-slate-950 p-4 transition-all hover:border-slate-800">
                        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                          <div>
                            <h4 className="text-base font-bold text-white">{pat.name}</h4>
                            <p className="text-xs text-slate-400">{pat.email}</p>
                            {pat.address && <p className="mt-1 text-[10px] text-slate-500">{pat.address}</p>}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setSelectedPatientId(isShowingDetails ? null : id)}
                              className="h-10 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                            >
                              {isShowingDetails ? "Close Details" : "View Details"}
                            </Button>
                            <Button
                              disabled={!!dialingPatientId}
                              onClick={() => {
                                setSelectedPatientId(id);
                                handleDialCall(id);
                              }}
                              className="flex h-10 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-white hover:bg-indigo-700"
                            >
                              {dialingPatientId === id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Phone className="h-4 w-4" />
                              )}
                              <span>Dial</span>
                            </Button>
                          </div>
                        </div>
                        {isShowingDetails && <PatientMedicalDetailsView profile={pat} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}



        {/* Dialing State Screen */}
        {activeCallId && callSession?.status === "dialing" && (
          <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md max-w-md mx-auto text-center py-16">
            <CardContent className="space-y-6">
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-indigo-500/10 mx-auto border border-indigo-500/20">
                <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500/20 opacity-75 animate-ping"></span>
                <Phone className="h-10 w-10 text-indigo-400 animate-bounce" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-white">Calling Patient Terminal...</h3>
                <p className="text-sm text-slate-400">Waiting for {patientName || "Patient"} to accept the rehabilitation invite.</p>
              </div>
              <Button
                variant="destructive"
                onClick={handleDisconnectCall}
                className="bg-red-650 hover:bg-red-700 text-white rounded-xl h-12 px-6"
              >
                Cancel Call
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Connected Call Layout (Normal Mode & Therapy Mode) */}
        {isCallConnected && (
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-4">
            {/* Swappable Video Layout */}
            <div className="lg:col-span-3 space-y-4">
              <div className="relative w-full aspect-video bg-slate-950 border border-slate-850 rounded-2xl overflow-hidden shadow-2xl">
                {/* 1. Doctor Local Video Block (Stable, Persistent) */}
                <div
                  className={cn(
                    "transition-all duration-300 rounded-xl overflow-hidden shadow-2xl bg-slate-900 cursor-pointer",
                    !isSwapped
                        ? "absolute top-4 right-4 w-44 sm:w-60 aspect-video z-20 border border-slate-800"
                        : "w-full h-full relative border-none z-10"
                  )}
                  onClick={() => setIsSwapped(!isSwapped)}
                >
                  <video ref={bindLocalVideoElement} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100"></video>
                  <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full object-cover transform -scale-x-100 pointer-events-none"></canvas>
                  {!isStreaming && (
                    <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center text-center px-4">
                      <CameraOff className="h-5 w-5 text-slate-700 mb-1" />
                      <span className="text-[10px] text-slate-500 font-medium">Camera Offline</span>

                      {cameraError && (
                        <div className="mt-3 max-w-xs bg-amber-950/40 border border-amber-900/50 p-3 rounded-lg text-left backdrop-blur-sm">
                           <p className="text-[11px] text-amber-400 font-bold mb-1.5 flex items-center gap-1.5">
                             Camera security blocked
                           </p>
                           <p className="text-[10px] text-amber-200/80 leading-relaxed">
                             {cameraError.message}
                             <br/><span className="font-mono text-amber-300 bg-amber-900/40 px-1 py-0.5 rounded mt-1 inline-block break-all">{cameraError.origin}</span>
                             <br/>{cameraError.hint}
                           </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. Patient Remote Video Block (Stable, Persistent) */}
                <div
                  className={cn(
                    "transition-all duration-300 rounded-xl overflow-hidden shadow-2xl bg-slate-900 cursor-pointer",
                    !isSwapped
                        ? "w-full h-full relative border-none z-10"
                        : "absolute top-4 right-4 w-44 sm:w-60 aspect-video z-20 border border-slate-800"
                  )}
                  onClick={() => setIsSwapped(!isSwapped)}
                >
                  <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100"></video>
                  <audio ref={remoteAudioRef} autoPlay className="absolute opacity-0 pointer-events-none w-0 h-0" />
                  {!remoteStream && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80">
                      <Video className="h-10 w-10 text-slate-650 animate-pulse mb-2" />
                      <span className="text-xs text-slate-400">Waiting for patient stream...</span>
                    </div>
                  )}
                </div>

                {/* Main Video Overlay state badge */}
                <div className="absolute bottom-4 left-4 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-300 backdrop-blur-sm z-20">
                  {isTherapyActive ? "Therapy Mode: Hand Tracking Active" : "Normal Video Call Mode"}
                </div>
              </div>

              {/* Clinical Buttons Controller */}
              <div className="flex flex-wrap items-center justify-center gap-3 bg-slate-900/40 p-4 border border-slate-850 rounded-2xl backdrop-blur-md">
                {localStream && (
                  <>
                    <Button
                      variant={isAudioMuted ? "destructive" : "secondary"}
                      onClick={toggleAudio}
                      className={cn(
                        "rounded-xl h-11 px-5 flex items-center gap-2",
                        isAudioMuted ? "bg-red-650 hover:bg-red-700 text-white" : "bg-slate-800 hover:bg-slate-700 text-white"
                      )}
                    >
                      {isAudioMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      <span>{isAudioMuted ? "Unmute" : "Mute"}</span>
                    </Button>

                    <Button
                      variant={isVideoMuted ? "destructive" : "secondary"}
                      onClick={toggleVideo}
                      className={cn(
                        "rounded-xl h-11 px-5 flex items-center gap-2",
                        isVideoMuted ? "bg-red-650 hover:bg-red-700 text-white" : "bg-slate-800 hover:bg-slate-700 text-white"
                      )}
                    >
                      {isVideoMuted ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                      <span>{isVideoMuted ? "Turn On Camera" : "Turn Off Camera"}</span>
                    </Button>
                  </>
                )}

                {remoteAudioNeedsGesture && (
                  <Button
                    variant="secondary"
                    onClick={enableRemoteAudio}
                    className="rounded-xl h-11 px-5 flex items-center gap-2 bg-indigo-650 hover:bg-indigo-700 text-white"
                  >
                    <Volume2 className="h-4 w-4" />
                    <span>Enable Call Audio</span>
                  </Button>
                )}

                <Button
                  variant="destructive"
                  onClick={handleDisconnectCall}
                  className="bg-red-650 hover:bg-red-700 text-white rounded-xl h-11 px-5 flex items-center gap-2"
                >
                  <PhoneOff className="h-4 w-4" />
                  <span>Hang Up</span>
                </Button>

                {isTherapyActive ? (
                  <Button
                    onClick={() => handleToggleTherapyClick(false)}
                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl h-11 px-5 flex items-center gap-2"
                  >
                    <Square className="h-4 w-4" />
                    <span>Stop Therapy Mode</span>
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleToggleTherapyClick(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-11 px-5 flex items-center gap-2"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>Start Therapy Mode</span>
                  </Button>
                )}

                {isTherapyActive && (
                  <Button
                    onClick={() => setShowCalibration(true)}
                    className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-11 px-5 flex items-center gap-2"
                  >
                    <Settings className="h-4 w-4" />
                    <span>Calibrate Sensors</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Live Clinical Angles panel (Visible in Therapy Mode) */}
            <div className="lg:col-span-1 space-y-6">
              <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                    <Tv className="h-4.5 w-4.5 text-indigo-400" />
                    Therapy Signals
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isTherapyActive ? (
                    <>
                      <div className="space-y-2">
                        <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Webcam Tracker Status</span>
                        <div className="flex items-center gap-2 p-2.5 bg-slate-950 rounded-lg border border-slate-850">
                          {isStreaming ? (
                            <>
                              <Loader2 className="h-4 w-4 text-emerald-400 animate-spin animate-pulse" />
                              <span className="text-xs text-emerald-400 font-semibold">Streaming angles live</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-4 w-4 text-amber-500" />
                              <span className="text-xs text-amber-400 font-semibold">Camera is offline</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Therapy Pump Speed */}
                      <div className="space-y-2 mt-4 mb-4 bg-slate-950 p-3 rounded-lg border border-slate-850">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Therapy Pump Speed</span>
                          <span className="text-xs font-semibold text-white bg-indigo-600/30 px-2 py-0.5 rounded">{therapySpeed}</span>
                        </div>
                        <Slider
                          min={0}
                          max={255}
                          step={1}
                          value={[therapySpeed]}
                          onValueChange={handleTherapySpeedChange}
                          className="w-full"
                        />
                        <div className="flex justify-between text-[10px] text-slate-500 font-medium px-1 mt-1">
                          <span>0 (Stop)</span>
                          <span>255 (Max)</span>
                        </div>
                      </div>

                      {/* Computed Bending Angles panel */}
                      <div className="space-y-2">
                        <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Computed Bending Angles</span>
                        <div className="grid grid-cols-2 gap-2 text-center">
                          {["thumb", "index", "middle", "ring", "pinky"].map((key) => {
                            const val = angles?.fingers?.[key as keyof typeof angles.fingers] || 0;
                            return (
                              <div key={key} className="p-2.5 bg-slate-950 rounded-lg border border-slate-850">
                                <span className="text-[10px] text-slate-500 uppercase block font-medium">{key}</span>
                                <span className="text-base font-extrabold text-white mt-0.5 block">{val.toFixed(0)}°</span>
                              </div>
                            );
                          })}
                          <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-850 col-span-2">
                            <span className="text-[10px] text-slate-500 uppercase block font-medium">Wrist</span>
                            <span className="text-base font-extrabold text-white mt-0.5 block">
                              {angles?.wrist?.flexion?.toFixed(0) || 0}°
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider flex items-center gap-1.5">
                          <Thermometer className="h-3.5 w-3.5" />
                          Doctor vs Patient Difference
                        </span>
                        <div className="space-y-2">
                          {(["thumb", "index", "middle", "ring", "pinky"] as const).map((key) => {
                            const localDoctorValue = role === "doctor" ? angles?.fingers?.[key] || 0 : 0;
                            const doctorValue = doctorAngles?.[key] ?? localDoctorValue;
                            const patientValue = patientAngles?.[key] || 0;
                            const bothSidesReady = !!doctorAngles && !!patientAngles;
                            const diff = differenceAngles?.[key] ?? (bothSidesReady ? Math.abs(doctorValue - patientValue) : 0);
                            const width = Math.min(100, (diff / 90) * 100);
                            const color = diffColor(diff);
                            return (
                              <div key={key} className="rounded-lg border border-slate-850 bg-slate-950 p-2.5">
                                <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase font-bold">
                                  <span className="text-slate-400">{key}</span>
                                  <span className="text-slate-200">{diff.toFixed(0)} deg diff</span>
                                </div>
                                <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-150"
                                    style={{ width: `${width}%`, backgroundColor: color }}
                                  />
                                </div>
                                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                                  <span>D {doctorValue.toFixed(0)}</span>
                                  <span>P {patientValue.toFixed(0)}</span>
                                </div>
                              </div>
                            );
                          })}
                          {(!doctorAngles || !patientAngles) && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-300">
                              Waiting for both doctor and patient hand-tracking telemetry.
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-slate-500 text-xs">
                      Hand-angle telemetry is syncing in the background. Start Therapy Mode to display the clinical tracking panel and controls.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- RENDERING PATIENT WORKSPACE / MIRROR THERAPY WORKSPACE ---
  if (role === "patient") {
    const isCallConnected = !!activeCallId && callSession?.status === "connected";
    const isTherapyActive = isCallConnected && !!callSession?.therapyMode;

    // --- CASE A: Patient connected in active Call Node ---
    if (activeCallId) {
      return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
          <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Active Clinical Program</span>
                <CardTitle className="text-2xl font-bold text-white flex items-center gap-2 mt-1">
                  <Heart className="h-6 w-6 text-emerald-500 fill-current animate-pulse" />
                  Tele-Rehabilitation Portal
                </CardTitle>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className="bg-indigo-650 text-white uppercase text-xs font-extrabold px-3 py-1">
                  Connected
                </Badge>
                {isTherapyActive && (
                  <Badge className="bg-emerald-600 text-white uppercase text-xs font-extrabold px-3 py-1 animate-pulse">
                    Therapy Mode Active
                  </Badge>
                )}
              </div>
            </CardHeader>
          </Card>

          {/* Swappable video call layout */}
          <div className="relative w-full aspect-video bg-slate-950 border border-slate-850 rounded-2xl overflow-hidden shadow-2xl">
            {/* 1. Patient Local Video Block (Stable, Persistent) */}
            <div
              className={cn(
                "transition-all duration-300 rounded-xl overflow-hidden shadow-2xl bg-slate-900 cursor-pointer",
                !isSwapped
                    ? "absolute top-4 right-4 w-44 sm:w-60 aspect-video z-20 border border-slate-800"
                    : "w-full h-full relative border-none z-10"
              )}
              onClick={() => setIsSwapped(!isSwapped)}
            >
              <video ref={bindLocalVideoElement} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100"></video>
              <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full object-cover transform -scale-x-100 pointer-events-none"></canvas>
              {!isStreaming && (
                <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center text-center px-4">
                  <CameraOff className="h-5 w-5 text-slate-700 mb-1" />
                  <span className="text-[9px] text-slate-500 font-medium">Camera Offline</span>
                  {cameraError && (
                    <div className="mt-3 max-w-xs bg-amber-950/40 border border-amber-900/50 p-3 rounded-lg text-left backdrop-blur-sm">
                      <p className="text-[11px] text-amber-400 font-bold mb-1.5">
                        Camera security blocked
                      </p>
                      <p className="text-[10px] text-amber-200/80 leading-relaxed">
                        {cameraError.message}
                        <br/><span className="font-mono text-amber-300 bg-amber-900/40 px-1 py-0.5 rounded mt-1 inline-block break-all">{cameraError.origin}</span>
                        <br/>{cameraError.hint}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Doctor Remote Video Block (Stable, Persistent) */}
            <div
              className={cn(
                "transition-all duration-300 rounded-xl overflow-hidden shadow-2xl bg-slate-900 cursor-pointer",
                !isSwapped
                    ? "w-full h-full relative border-none z-10"
                    : "absolute top-4 right-4 w-44 sm:w-60 aspect-video z-20 border border-slate-800"
              )}
              onClick={() => setIsSwapped(!isSwapped)}
            >
              <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100"></video>
              <audio ref={remoteAudioRef} autoPlay className="absolute opacity-0 pointer-events-none w-0 h-0" />
              {!remoteStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80">
                  <Video className="h-10 w-10 text-slate-650 animate-pulse mb-2" />
                  <span className="text-xs text-slate-400">Waiting for doctor stream...</span>
                </div>
              )}
            </div>

            {/* Overlay Label for Patient */}
            <div className="absolute bottom-4 left-4 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-300 backdrop-blur-sm z-20">
              {isTherapyActive ? "Therapy Mode: Patient hand tracking active" : "Normal Video Call Mode"}
            </div>
          </div>

          {/* Connected Roster Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 bg-slate-900/40 p-4 border border-slate-850 rounded-2xl backdrop-blur-md">

            {localStream && (
              <>
                <Button
                  variant={isAudioMuted ? "destructive" : "secondary"}
                  onClick={toggleAudio}
                  className={cn(
                    "rounded-xl h-11 px-5 flex items-center gap-2",
                    isAudioMuted ? "bg-red-650 hover:bg-red-700 text-white" : "bg-slate-800 hover:bg-slate-700 text-white"
                  )}
                >
                  {isAudioMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  <span>{isAudioMuted ? "Unmute" : "Mute"}</span>
                </Button>

                <Button
                  variant={isVideoMuted ? "destructive" : "secondary"}
                  onClick={toggleVideo}
                  className={cn(
                    "rounded-xl h-11 px-5 flex items-center gap-2",
                    isVideoMuted ? "bg-red-650 hover:bg-red-700 text-white" : "bg-slate-800 hover:bg-slate-700 text-white"
                  )}
                >
                  {isVideoMuted ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                  <span>{isVideoMuted ? "Turn On Camera" : "Turn Off Camera"}</span>
                </Button>
              </>
            )}

            {remoteAudioNeedsGesture && (
              <Button
                variant="secondary"
                onClick={enableRemoteAudio}
                className="rounded-xl h-11 px-5 flex items-center gap-2 bg-indigo-650 hover:bg-indigo-700 text-white"
              >
                <Volume2 className="h-4 w-4" />
                <span>Enable Call Audio</span>
              </Button>
            )}

            <Button
              variant="destructive"
              onClick={handleDisconnectCall}
              className="bg-red-650 hover:bg-red-700 text-white rounded-xl h-11 px-5 flex items-center gap-2"
            >
              <PhoneOff className="h-4 w-4" />
              <span>End Call</span>
            </Button>

          </div>
        </div>
      );
    }

    // --- CASE B: Patient waiting for a doctor call ---
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        <MirrorTherapy />
      </div>
    );
  }

  // Fallback
  return (
    <div className="flex h-screen items-center justify-center bg-slate-950 text-red-500 font-bold">
      Error: Unknown Role ({role}) or invalid state.
    </div>
  );
}
