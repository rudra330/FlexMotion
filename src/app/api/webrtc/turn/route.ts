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

function getLanAddress(): string | null {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);

  return addresses.find((address) => address.startsWith("192.168."))
    || addresses.find((address) => address.startsWith("10."))
    || addresses.find((address) => /^172\.(1[6-9]|2\d|3[01])\./.test(address))
    || addresses[0]
    || null;
}

function getPublicFallbackServer(): RTCIceServer {
  // Metered documents this shared secret for its Open Relay static-auth host.
  // Generate an expiring TURN REST credential server-side instead of exposing
  // the secret or using a permanent password in the browser bundle.
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

export async function GET() {
  const configuredUrls = csv(process.env.WEBRTC_TURN_URLS);
  if (configuredUrls.length) {
    return NextResponse.json({
      iceServers: [{
        urls: configuredUrls,
        username: process.env.WEBRTC_TURN_USERNAME,
        credential: process.env.WEBRTC_TURN_CREDENTIAL,
      }, getPublicFallbackServer()],
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const servers: RTCIceServer[] = [
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
