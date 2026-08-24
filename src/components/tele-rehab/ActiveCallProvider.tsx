"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "@/hooks/use-toast";

type CameraStatus = "idle" | "starting" | "ready" | "failed";

interface CameraErrorInfo {
  name: string;
  message: string;
  secureContext: boolean;
  origin: string;
  hint: string;
}

interface ActiveCallMediaContextValue {
  localStream: MediaStream | null;
  localVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  cameraStatus: CameraStatus;
  cameraError: CameraErrorInfo | null;
  isStreaming: boolean;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  startCamera: (context: {
    userId: string | null;
    doctorId?: string | null;
    patientId?: string | null;
  }) => Promise<MediaStream | null>;
  stopCamera: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
}

const ActiveCallMediaContext = createContext<ActiveCallMediaContextValue | null>(null);

function getCameraErrorInfo(error: unknown): CameraErrorInfo {
  const domError = error as DOMException | Error | undefined;
  const secureContext = typeof window !== "undefined" ? window.isSecureContext : false;
  const origin = typeof window !== "undefined" ? window.location.origin : "unknown";
  const name = domError?.name || "CameraError";
  const message = domError?.message || "Camera permission failed.";
  const insecure =
    !secureContext ||
    name === "NotAllowedError" ||
    message.toLowerCase().includes("secure context");

  return {
    name,
    message,
    secureContext,
    origin,
    hint: insecure
      ? `Camera access requires HTTPS or localhost. Open the app through a Cloudflare HTTPS tunnel instead of ${origin}.`
      : "Check browser camera permission, camera availability, and whether another app is using the camera.",
  };
}

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingCameraRef = useRef(false);
  const startPromiseRef = useRef<Promise<MediaStream | null> | null>(null);
  const mediaRequestIdRef = useRef(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraError, setCameraError] = useState<CameraErrorInfo | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const bindStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    setLocalStream(stream);
    setIsStreaming(true);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current
        .play()
        .catch(() => undefined);
    }
  }, []);

  const stopCamera = useCallback(() => {
    mediaRequestIdRef.current += 1;
    isStartingCameraRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setLocalStream(null);
    setIsStreaming(false);
    setIsAudioMuted(false);
    setIsVideoMuted(false);
    setCameraStatus("idle");
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = useCallback(
    async ({
      userId,
      doctorId,
      patientId,
    }: {
      userId: string | null;
      doctorId?: string | null;
      patientId?: string | null;
    }) => {
      if (isStartingCameraRef.current) return startPromiseRef.current;
      if (streamRef.current) return streamRef.current;

      isStartingCameraRef.current = true;
      const requestId = mediaRequestIdRef.current + 1;
      mediaRequestIdRef.current = requestId;
      const startPromise = (async () => {
        setCameraStatus("starting");
        setCameraError(null);
        console.log("[CAMERA_START]", {
          userId,
          doctorId,
          patientId,
          path: null,
          angleValues: null,
          origin: typeof window !== "undefined" ? window.location.origin : "unknown",
          secureContext: typeof window !== "undefined" ? window.isSecureContext : false,
        });

        if (!navigator.mediaDevices?.getUserMedia) {
          const info = getCameraErrorInfo(new Error("navigator.mediaDevices.getUserMedia is not available."));
          setCameraError(info);
          setCameraStatus("failed");
          setLocalStream(null);
          setIsStreaming(false);
          toast({
            variant: "destructive",
            title: `${info.name}: Camera unavailable`,
            description: `${info.message} ${info.hint}`,
          });
          return null;
        }

        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 480 },
              facingMode: "user",
            },
            audio: true,
          });
        } catch (initialError) {
          console.warn("[CAMERA_START] Failed with audio, attempting video-only fallback:", initialError);
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user",
              },
              audio: false,
            });
          } catch (videoError) {
            const info = getCameraErrorInfo(videoError);
            console.error("[CAMERA_START]", {
              userId,
              doctorId,
              patientId,
              path: null,
              angleValues: null,
              error: info,
            });
            stopCamera();
            setCameraError(info);
            setCameraStatus("failed");
            toast({
              variant: "destructive",
              title: `${info.name}: Camera permission failed`,
              description: `${info.message} ${info.hint}`,
            });
            return null;
          }
        }

        if (requestId !== mediaRequestIdRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return null;
        }
        bindStream(stream);
        setCameraStatus("ready");
        return stream;
      })();

      startPromiseRef.current = startPromise;
      try {
        return await startPromise;
      } finally {
        isStartingCameraRef.current = false;
        if (startPromiseRef.current === startPromise) {
          startPromiseRef.current = null;
        }
      }
    },
    [bindStream, stopCamera]
  );

  const toggleAudio = useCallback(() => {
    const tracks = streamRef.current?.getAudioTracks() || [];
    tracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
    setIsAudioMuted(tracks.length > 0 ? !tracks[0].enabled : false);
  }, []);

  const toggleVideo = useCallback(() => {
    const tracks = streamRef.current?.getVideoTracks() || [];
    tracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
    setIsVideoMuted(tracks.length > 0 ? !tracks[0].enabled : false);
  }, []);

  const value = useMemo(
    () => ({
      localStream,
      localVideoRef,
      cameraStatus,
      cameraError,
      isStreaming,
      isAudioMuted,
      isVideoMuted,
      startCamera,
      stopCamera,
      toggleAudio,
      toggleVideo,
    }),
    [
      localStream,
      cameraStatus,
      cameraError,
      isStreaming,
      isAudioMuted,
      isVideoMuted,
      startCamera,
      stopCamera,
      toggleAudio,
      toggleVideo,
    ]
  );

  return <ActiveCallMediaContext.Provider value={value}>{children}</ActiveCallMediaContext.Provider>;
}

export function useActiveCallMedia() {
  const context = useContext(ActiveCallMediaContext);
  if (!context) {
    throw new Error("useActiveCallMedia must be used inside ActiveCallProvider.");
  }
  return context;
}
