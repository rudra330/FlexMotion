
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// --- Type Definitions ---
export type HandAngles = {
  fingers: {
    thumb: number;
    index: number;
    middle: number;
    ring: number;
    pinky: number;
  };
  wrist: {
    flexion: number;
    deviation: number;
  };
};

type Vec3 = { x: number; y: number; z: number };

// --- Vector Math Utilities ---
const vec3 = {
  fromLandmark: (lm: NormalizedLandmark): Vec3 => ({ x: lm.x, y: lm.y, z: lm.z }),
  subtract: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  normalize: (v: Vec3): Vec3 => {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return len > 0 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 0, z: 0 };
  },
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
};

// --- Angle Calculation Logic ---

/**
 * Calculates the angle between three 3D points in degrees, with 0 being a straight line.
 * The angle is computed at point `b`.
 */
const calculateAngle = (a: Vec3, b: Vec3, c: Vec3): number => {
  const v1 = vec3.normalize(vec3.subtract(a, b));
  const v2 = vec3.normalize(vec3.subtract(c, b));
  const dotProduct = vec3.dot(v1, v2);
  // Ensure the dot product is within the valid range for acos to prevent NaN
  const angleRad = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
  // Convert to degrees and invert so 0 is straight
  return 180 - angleRad * (180 / Math.PI);
};

/**
 * Estimates wrist flexion based on the tilt of the palm.
 * This is an approximation as true flexion requires forearm tracking.
 */
const calculateWristFlexion = (landmarks: Vec3[]): number => {
  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];

  // A vector representing the horizontal axis of the palm
  const palmVector = vec3.normalize(vec3.subtract(pinkyMcp, indexMcp));
  
  // Simplified flexion based on the tilt of the palm's y-axis.
  let flexion = Math.asin(palmVector.y) * (180 / Math.PI);
  
  // Clamp and adjust the value to a more intuitive 0-180 degree range
  flexion = Math.max(0, Math.min(180, 90 + flexion));
  return flexion;
};


/**
 * Calculates all relevant bending angles for a detected hand.
 * @param landmarks - An array of 21 3D hand landmarks from MediaPipe.
 * @returns An object containing the calculated angles for fingers and wrist.
 */
export function calculateAngles(landmarks: NormalizedLandmark[]): HandAngles {
  const lm = landmarks.map(vec3.fromLandmark);

  // Hand landmark indices
  const WRIST = 0;
  const THUMB_CMC = 1, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4;
  const INDEX_FINGER_MCP = 5, INDEX_FINGER_PIP = 6, INDEX_FINGER_DIP = 7, INDEX_FINGER_TIP = 8;
  const MIDDLE_FINGER_MCP = 9, MIDDLE_FINGER_PIP = 10, MIDDLE_FINGER_DIP = 11, MIDDLE_FINGER_TIP = 12;
  const RING_FINGER_MCP = 13, RING_FINGER_PIP = 14, RING_FINGER_DIP = 15, RING_FINGER_TIP = 16;
  const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_DIP = 19, PINKY_TIP = 20;

  return {
    fingers: {
      thumb: calculateAngle(lm[THUMB_IP], lm[THUMB_MCP], lm[THUMB_CMC]),
      index: calculateAngle(lm[INDEX_FINGER_MCP], lm[INDEX_FINGER_PIP], lm[INDEX_FINGER_TIP]),
      middle: calculateAngle(lm[MIDDLE_FINGER_MCP], lm[MIDDLE_FINGER_PIP], lm[MIDDLE_FINGER_TIP]),
      ring: calculateAngle(lm[RING_FINGER_MCP], lm[RING_FINGER_PIP], lm[RING_FINGER_TIP]),
      pinky: calculateAngle(lm[PINKY_MCP], lm[PINKY_PIP], lm[PINKY_TIP]),
    },
    wrist: {
      flexion: calculateWristFlexion(lm),
      deviation: 0, // Placeholder, as true deviation requires arm tracking
    },
  };
}

    