
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

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

/**
 * Represents a 3D vector.
 */
class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static fromLandmark(lm: NormalizedLandmark): Vector3 {
    return new Vector3(lm.x, lm.y, lm.z);
  }

  subtract(v: Vector3): Vector3 {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize(): Vector3 {
    const mag = this.magnitude();
    if (mag === 0) return new Vector3();
    return new Vector3(this.x / mag, this.y / mag, this.z / mag);
  }
}

/**
 * Calculates the angle between three 3D points in degrees.
 * The angle is computed at point `p2`.
 */
function calculateAngle(p1: Vector3, p2: Vector3, p3: Vector3): number {
  const v1 = p1.subtract(p2).normalize();
  const v2 = p3.subtract(p2).normalize();
  const dotProduct = v1.dot(v2);
  // Clamp dotProduct to avoid Math.acos errors due to floating point inaccuracies
  const clampedDot = Math.max(-1.0, Math.min(1.0, dotProduct));
  const angleRad = Math.acos(clampedDot);
  return angleRad * (180.0 / Math.PI);
}


/**
 * Calculates all relevant bending angles for a detected hand.
 * @param landmarks - An array of 21 3D hand landmarks from MediaPipe.
 * @returns An object containing the calculated angles for fingers and wrist.
 */
export function calculateAngles(landmarks: NormalizedLandmark[]): HandAngles {
  const lm = landmarks.map(Vector3.fromLandmark);

  // Hand landmark indices
  const WRIST = 0;
  const THUMB_CMC = 1, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4;
  const INDEX_FINGER_MCP = 5, INDEX_FINGER_PIP = 6, INDEX_FINGER_DIP = 7, INDEX_FINGER_TIP = 8;
  const MIDDLE_FINGER_MCP = 9, MIDDLE_FINGER_PIP = 10, MIDDLE_FINGER_DIP = 11, MIDDLE_FINGER_TIP = 12;
  const RING_FINGER_MCP = 13, RING_FINGER_PIP = 14, RING_FINGER_DIP = 15, RING_FINGER_TIP = 16;
  const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_DIP = 19, PINKY_TIP = 20;

  // Calculate finger flexion angles
  // We'll simplify by taking the angle at the PIP joint as the primary flexion indicator.
  const indexAngle = calculateAngle(lm[INDEX_FINGER_MCP], lm[INDEX_FINGER_PIP], lm[INDEX_FINGER_TIP]);
  const middleAngle = calculateAngle(lm[MIDDLE_FINGER_MCP], lm[MIDDLE_FINGER_PIP], lm[MIDDLE_FINGER_TIP]);
  const ringAngle = calculateAngle(lm[RING_FINGER_MCP], lm[RING_FINGER_PIP], lm[RING_FINGER_TIP]);
  const pinkyAngle = calculateAngle(lm[PINKY_MCP], lm[PINKY_PIP], lm[PINKY_TIP]);
  
  // Thumb is more complex, we'll use the angle at the MCP joint relative to the wrist
  const thumbAngle = calculateAngle(lm[THUMB_CMC], lm[THUMB_MCP], lm[THUMB_IP]);
  
  // For this simplified version, let's use a placeholder calculation for wrist.
  // A more accurate measurement requires tracking the arm, not just the hand.
  // We'll simulate flexion based on the wrist's relative Z position to the MCPs.
  const avgMcpZ = (lm[INDEX_FINGER_MCP].z + lm[PINKY_MCP].z) / 2;
  const wristFlexionSim = (lm[WRIST].z - avgMcpZ) * 800 + 90; // Heuristic scaling and offset
  
  return {
    fingers: {
      // Angles are inverted (180 - angle) so 0 is straight and ~90+ is bent
      thumb: Math.max(0, 180 - calculateAngle(lm[THUMB_IP], lm[THUMB_MCP], lm[THUMB_CMC])),
      index: Math.max(0, 180 - indexAngle),
      middle: Math.max(0, 180 - middleAngle),
      ring: Math.max(0, 180 - ringAngle),
      pinky: Math.max(0, 180 - pinkyAngle),
    },
    wrist: {
      flexion: Math.max(0, Math.min(180, wristFlexionSim)), // Clamp between 0 and 180
      deviation: 0, // Placeholder, requires arm tracking
    },
  };
}

    