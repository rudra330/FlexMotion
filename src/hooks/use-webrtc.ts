import { useEffect, useState } from "react";
import {
  Database,
  onChildAdded,
  onValue,
  push,
  ref,
  set,
} from "firebase/database";

const STUN_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
      "stun:stun3.l.google.com:19302",
      "stun:stun4.l.google.com:19302",
      "stun:stun.cloudflare.com:3478",
      "stun:stun.services.mozilla.com:3478",
    ],
  },
];

type StoredDescription = RTCSessionDescriptionInit & {
  ts?: number;
  negotiationId?: string;
};

type StoredCandidate = RTCIceCandidateInit & {
  negotiationId?: string;
};

function isIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== "object") return false;
  const urls = (value as RTCIceServer).urls;
  return (
    typeof urls === "string" ||
    (Array.isArray(urls) && urls.every((url) => typeof url === "string"))
  );
}

async function getIceConfiguration(): Promise<RTCConfiguration> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("/api/webrtc/turn", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`TURN configuration returned ${response.status}`);
    const data = (await response.json()) as { iceServers?: unknown[] };
    const relayServers = (data.iceServers || []).filter(isIceServer);
    if (relayServers.length) {
      return {
        iceServers: relayServers,
        iceCandidatePoolSize: 4,
      };
    }
    return {
      iceServers: STUN_SERVERS,
      iceCandidatePoolSize: 4,
    };
  } catch (error) {
    console.warn("[WebRTC] Using standard STUN ICE servers.", error);
    return {
      iceServers: STUN_SERVERS,
      iceCandidatePoolSize: 4,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Robust Firebase-signaled peer connection per call and local camera stream.
 * Supports real-time Trickle ICE, SDP offer/answer exchange, and automatic candidate buffering.
 */
export function useWebRTC(
  callId: string | null,
  role: string | null,
  localStream: MediaStream | null,
  database: Database | null
) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (
      !callId ||
      (role !== "doctor" && role !== "patient") ||
      !localStream ||
      !database
    ) {
      setRemoteStream(null);
      return;
    }

    let disposed = false;
    let peer: RTCPeerConnection | null = null;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let iceRestartAttempts = 0;
    let publishDoctorOffer: ((iceRestart?: boolean) => Promise<void>) | null = null;
    const remoteMedia = new MediaStream();
    const signalingPath = `webrtc/${callId}`;
    const localCandidatesPath = role === "doctor"
      ? `${signalingPath}/doctorCandidates`
      : `${signalingPath}/patientCandidates`;
    const remoteCandidatesPath = role === "doctor"
      ? `${signalingPath}/patientCandidates`
      : `${signalingPath}/doctorCandidates`;

    let activeNegotiationId: string | null = null;
    let processingOfferId: string | null = null;
    let patientOfferWorkerActive = false;
    let pendingPatientOffer: StoredDescription | null = null;
    let offerInFlight = false;
    let hasRemoteDescription = false;
    const answeredOfferIds = new Set<string>();
    const queuedRemoteCandidates: StoredCandidate[] = [];

    let unsubscribeOffer: (() => void) | null = null;
    let unsubscribeAnswer: (() => void) | null = null;
    let unsubscribeCandidates: (() => void) | null = null;

    // Expose receiver tracks as soon as WebRTC provides them. Waiting for a
    // video track's `muted` flag to clear is unreliable across browsers and can
    // leave both participants looking only at their local preview even though
    // negotiation and incoming tracks succeeded.
    const publishRemoteStream = () => {
      if (disposed) return;
      const liveTracks = remoteMedia.getTracks().filter((track) => track.readyState === "live");
      setRemoteStream(liveTracks.length ? new MediaStream(liveTracks) : null);
    };

    const toCandidateInit = (candidate: StoredCandidate): RTCIceCandidateInit => {
      const { negotiationId: _negotiationId, ...candidateInit } = candidate;
      return candidateInit;
    };

    const addRemoteCandidate = async (candidate: StoredCandidate) => {
      if (!peer || disposed || !peer.remoteDescription) return;
      try {
        const init = toCandidateInit(candidate);
        if (!init || !init.candidate) return;
        await peer.addIceCandidate(init);
      } catch (error) {
        console.warn("[WebRTC] Could not add remote ICE candidate:", error);
      }
    };

    const processCandidate = async (candidate: StoredCandidate) => {
      if (!peer || disposed || !candidate) return;
      const candidateType = candidate.candidate?.match(/\btyp\s+(\w+)/i)?.[1] || "unknown";
      const candidateAddress = candidate.candidate?.split(/\s+/)[4] || "";
      console.log("[WebRTC] Remote ICE candidate", JSON.stringify({
        type: candidateType,
        sameLan: candidateType === "host" && candidateAddress.startsWith("192.168.0."),
        negotiationMatches: !candidate.negotiationId || candidate.negotiationId === activeNegotiationId,
        role,
      }));
      if (!activeNegotiationId || !hasRemoteDescription || !peer.remoteDescription) {
        queuedRemoteCandidates.push(candidate);
        return;
      }
      if (candidate.negotiationId && candidate.negotiationId !== activeNegotiationId) {
        return;
      }
      await addRemoteCandidate(candidate);
    };

    const flushCandidateQueue = async () => {
      if (!peer || disposed || !hasRemoteDescription || !activeNegotiationId) return;
      const candidates = queuedRemoteCandidates.splice(0);
      for (const candidate of candidates) {
        if (!candidate.negotiationId || candidate.negotiationId === activeNegotiationId) {
          await addRemoteCandidate(candidate);
        }
      }
    };

    const clearRestartTimer = () => {
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
    };

    const scheduleIceRestart = (delayMs: number) => {
      if (role !== "doctor" || restartTimer || disposed || iceRestartAttempts >= 3) return;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!peer || disposed) return;
        if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "disconnected") {
          iceRestartAttempts += 1;
          void publishDoctorOffer?.(true);
        }
      }, delayMs + iceRestartAttempts * 4000);
    };

    const setup = async () => {
      const configuration = await getIceConfiguration();
      if (disposed) return;

      peer = new RTCPeerConnection(configuration);
      console.log("[WebRTC] Initialized peer connection", {
        activeCallId: callId,
        role,
        iceServers: configuration.iceServers?.map((server) => server.urls),
      });

      localStream.getTracks().forEach((track) => peer?.addTrack(track, localStream));

      peer.ontrack = (event) => {
        if (disposed) return;
        console.log("[WebRTC] Remote receiver track", JSON.stringify({
          kind: event.track.kind,
          muted: event.track.muted,
          readyState: event.track.readyState,
          role,
          callId,
        }));
        const incomingTracks = event.streams?.[0]?.getTracks().length
          ? event.streams[0].getTracks()
          : [event.track];

        incomingTracks.forEach((track) => {
          if (!remoteMedia.getTracks().some((current) => current.id === track.id)) {
            remoteMedia.addTrack(track);
            track.addEventListener("unmute", publishRemoteStream);
            track.addEventListener("mute", publishRemoteStream);
            track.addEventListener("ended", publishRemoteStream);
          }
        });
        publishRemoteStream();
      };

      peer.onicecandidate = (event) => {
        if (!event.candidate || disposed || !activeNegotiationId) return;
        console.log("[WebRTC] Local ICE candidate", JSON.stringify({
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          relayProtocol: (event.candidate as RTCIceCandidate & { relayProtocol?: string }).relayProtocol,
          role,
        }));
        const candidatePayload: StoredCandidate = {
          ...event.candidate.toJSON(),
          negotiationId: activeNegotiationId,
        };
        void push(ref(database, localCandidatesPath), candidatePayload).catch((error) => {
          console.warn("[WebRTC] Failed to send local ICE candidate:", error);
        });
      };

      peer.onicecandidateerror = (event) => {
        if (disposed) return;
        console.warn("[WebRTC] ICE candidate warning", JSON.stringify({
          code: event.errorCode,
          text: event.errorText,
          url: event.url,
          role,
        }));
      };

      const handleConnectionState = () => {
        if (!peer || disposed) return;
        console.log("[WebRTC] Connection state", JSON.stringify({
          connection: peer.connectionState,
          ice: peer.iceConnectionState,
          signaling: peer.signalingState,
          role,
          callId,
        }));

        if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
          clearRestartTimer();
          iceRestartAttempts = 0;
          publishRemoteStream();
        } else if (peer.iceConnectionState === "failed") {
          publishRemoteStream();
          scheduleIceRestart(500);
        } else if (peer.iceConnectionState === "disconnected") {
          publishRemoteStream();
          scheduleIceRestart(5000);
        }
      };
      peer.onconnectionstatechange = handleConnectionState;
      peer.oniceconnectionstatechange = handleConnectionState;

      // A new doctor-side connection owns this call's signaling branch. Clear
      // any offer, answer, and ICE candidates left by an earlier connection so
      // neither peer can attach stale negotiation data to the new camera stream.
      if (role === "doctor") {
        await set(ref(database, signalingPath), null);
        if (disposed) return;
      }

      unsubscribeCandidates = onChildAdded(
        ref(database, remoteCandidatesPath),
        (snapshot) => {
          if (!disposed && snapshot.exists()) {
            void processCandidate(snapshot.val() as StoredCandidate);
          }
        }
      );

      if (role === "doctor") {
        unsubscribeAnswer = onValue(
          ref(database, `${signalingPath}/answer`),
          async (snapshot) => {
            if (disposed || !peer || !snapshot.exists()) return;
            const answer = snapshot.val() as StoredDescription;
            if (
              !answer.sdp ||
              answer.type !== "answer" ||
              answer.negotiationId !== activeNegotiationId ||
              peer.signalingState !== "have-local-offer"
            ) return;

            try {
              await peer.setRemoteDescription(
                new RTCSessionDescription({ type: answer.type, sdp: answer.sdp })
              );
              hasRemoteDescription = true;
              await flushCandidateQueue();
              console.log("[WebRTC] Doctor applied patient answer.");
            } catch (error) {
              console.error("[WebRTC] Doctor could not apply patient answer:", error);
            }
          }
        );

        publishDoctorOffer = async (iceRestart = false) => {
          if (!peer || disposed || offerInFlight || peer.signalingState !== "stable") return;
          offerInFlight = true;
          activeNegotiationId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          hasRemoteDescription = false;
          try {
            await set(ref(database, localCandidatesPath), null);
            if (iceRestart) peer.restartIce();
            const offer = await peer.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
              iceRestart,
            });
            await peer.setLocalDescription(offer);
            if (disposed || !peer.localDescription) return;

            await set(ref(database, `${signalingPath}/offer`), {
              type: peer.localDescription.type,
              sdp: peer.localDescription.sdp,
              ts: Date.now(),
              negotiationId: activeNegotiationId,
            });
            console.log(iceRestart
              ? "[WebRTC] Doctor published an ICE-restart offer."
              : "[WebRTC] Doctor published the initial offer.");
          } catch (error) {
            console.error("[WebRTC] Doctor failed to publish offer:", error);
          } finally {
            offerInFlight = false;
          }
        };

        await publishDoctorOffer();
      } else {
        const getPatientSignalingState = () => peer?.signalingState;
        const processPatientOffers = async () => {
          if (patientOfferWorkerActive || disposed || !peer) return;
          patientOfferWorkerActive = true;

          try {
            while (!disposed && peer && pendingPatientOffer) {
              const offer = pendingPatientOffer;
              pendingPatientOffer = null;
              const negotiationId = offer.negotiationId;

              if (
                !offer.sdp ||
                offer.type !== "offer" ||
                !negotiationId ||
                answeredOfferIds.has(negotiationId)
              ) continue;

              processingOfferId = negotiationId;
              try {
                if (getPatientSignalingState() !== "stable") {
                  console.warn("[WebRTC] Patient deferred offer until signaling is stable", {
                    negotiationId,
                    signalingState: peer.signalingState,
                  });
                  pendingPatientOffer = offer;
                  break;
                }

                await set(ref(database, localCandidatesPath), null);
                activeNegotiationId = negotiationId;
                hasRemoteDescription = false;
                await peer.setRemoteDescription(
                  new RTCSessionDescription({ type: offer.type, sdp: offer.sdp })
                );
                if (disposed || !peer) return;

                hasRemoteDescription = true;
                await flushCandidateQueue();
                if (disposed || !peer) return;

                if (getPatientSignalingState() !== "have-remote-offer") {
                  console.warn("[WebRTC] Patient offer became stale before answering", {
                    negotiationId,
                    signalingState: peer.signalingState,
                  });
                  continue;
                }

                const answer = await peer.createAnswer();
                if (disposed || !peer || getPatientSignalingState() !== "have-remote-offer") continue;
                await peer.setLocalDescription(answer);
                if (disposed || !peer.localDescription) return;

                await set(ref(database, `${signalingPath}/answer`), {
                  type: peer.localDescription.type,
                  sdp: peer.localDescription.sdp,
                  ts: Date.now(),
                  negotiationId,
                });
                answeredOfferIds.add(negotiationId);
                console.log("[WebRTC] Patient published answer", { negotiationId });
              } catch (error) {
                console.error("[WebRTC] Patient could not process doctor offer:", error);
              } finally {
                if (processingOfferId === negotiationId) processingOfferId = null;
              }
            }
          } finally {
            patientOfferWorkerActive = false;
            if (!disposed && peer && pendingPatientOffer && getPatientSignalingState() === "stable") {
              void processPatientOffers();
            }
          }
        };

        unsubscribeOffer = onValue(
          ref(database, `${signalingPath}/offer`),
          (snapshot) => {
            if (disposed || !peer || !snapshot.exists()) return;
            const offer = snapshot.val() as StoredDescription;
            const negotiationId = offer.negotiationId;
            if (
              !offer.sdp ||
              offer.type !== "offer" ||
              !negotiationId ||
              processingOfferId === negotiationId ||
              answeredOfferIds.has(negotiationId)
            ) return;
            pendingPatientOffer = offer;
            void processPatientOffers();
          }
        );
      }
    };

    void setup();

    return () => {
      disposed = true;
      clearRestartTimer();
      pendingPatientOffer = null;
      queuedRemoteCandidates.length = 0;
      unsubscribeOffer?.();
      unsubscribeAnswer?.();
      unsubscribeCandidates?.();

      if (peer) {
        peer.ontrack = null;
        peer.onicecandidate = null;
        peer.onicecandidateerror = null;
        peer.onconnectionstatechange = null;
        peer.oniceconnectionstatechange = null;
        peer.close();
        peer = null;
      }
      remoteMedia.getTracks().forEach((track) => track.stop());
      setRemoteStream(null);
    };
  }, [callId, role, localStream, database]);

  return remoteStream;
}
