import { networkInterfaces } from "node:os";
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEVELOPMENT_TURN_USERNAME = "motionmirror-dev";
const DEVELOPMENT_TURN_CREDENTIAL = "mm-local-turn-8f3ce74a";
const OPEN_RELAY_HOST = "staticauth.openrelay.metered.ca";
const OPEN_RELAY_SECRET = "openrelayprojectsecret";

function csv(value: string | undefined): string[] {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) || [];
}

const DEFAULT_STUN_SERVERS: RTCIceServer = {
  urls: [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
    "stun:stun2.l.google.com:19302",
    "stun:stun3.l.google.com:19302",
    "stun:stun4.l.google.com:19302",
    "stun:stun.cloudflare.com:3478",
    "stun:stun.services.mozilla.com:3478",
  ],
};

function getPublicFallbackServer(): RTCIceServer {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const username = `${expiresAt}:motionmirror`;
  const credential = createHmac("sha1", OPEN_RELAY_SECRET)
    .update(username)
    .digest("base64");

  return {
    urls: [
      `turn:${OPEN_RELAY_HOST}:80`,
      `turn:${OPEN_RELAY_HOST}:80?transport=tcp`,
      `turn:${OPEN_RELAY_HOST}:443`,
      `turn:${OPEN_RELAY_HOST}:443?transport=tcp`,
      `turns:${OPEN_RELAY_HOST}:443?transport=tcp`,
    ],
    username,
    credential,
  };
}

async function fetchMeteredTurnServers(): Promise<RTCIceServer[] | null> {
  const rawDomain = (process.env.METERED_DOMAIN || process.env.NEXT_PUBLIC_METERED_DOMAIN || "").trim();
  const rawApiKey = (process.env.METERED_API_KEY || process.env.NEXT_PUBLIC_METERED_API_KEY || "").trim();
  if (!rawDomain || !rawApiKey) return null;

  let domain = rawDomain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!domain.includes(".")) {
    domain = `${domain}.metered.ca`;
  }

  try {
    const res = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(rawApiKey)}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[TURN] Metered API returned status ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data as RTCIceServer[];
    }
  } catch (err) {
    console.warn("[TURN] Failed to fetch Metered credentials:", err);
  }
  return null;
}

export async function GET() {
  // 1. If configured with Metered API credentials
  const meteredServers = await fetchMeteredTurnServers();
  if (meteredServers && meteredServers.length > 0) {
    return NextResponse.json({
      iceServers: [DEFAULT_STUN_SERVERS, ...meteredServers],
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // 2. If configured with custom TURN env variables
  const configuredUrls = csv(process.env.WEBRTC_TURN_URLS);
  if (configuredUrls.length) {
    return NextResponse.json({
      iceServers: [
        DEFAULT_STUN_SERVERS,
        {
          urls: configuredUrls,
          username: process.env.WEBRTC_TURN_USERNAME,
          credential: process.env.WEBRTC_TURN_CREDENTIAL,
        },
        getPublicFallbackServer(),
      ],
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // 3. Default STUN + OpenRelay fallback
  const servers: RTCIceServer[] = [
    DEFAULT_STUN_SERVERS,
    getPublicFallbackServer(),
  ];

  if (process.env.NODE_ENV !== "production") {
    const lanAddress = process.env.MOTIONMIRROR_TURN_LAN_ADDRESS;
    if (lanAddress) {
      servers.unshift({
        urls: [
          `turn:${lanAddress}:443?transport=udp`,
          `turn:${lanAddress}:3478?transport=udp`,
          `turn:${lanAddress}:443?transport=tcp`,
        ],
        username: DEVELOPMENT_TURN_USERNAME,
        credential: DEVELOPMENT_TURN_CREDENTIAL,
      });
    }
  }

  return NextResponse.json({ iceServers: servers }, {
    headers: { "Cache-Control": "no-store" },
  });
}
