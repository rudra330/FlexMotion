import { Database, ref, set, update, get, onValue, getDatabase } from 'firebase/database';
import { getApp, getApps } from 'firebase/app';

// =============================================
// TYPES
// =============================================

export interface DoctorProfile {
  name: string;
  email: string;
  address: string;
  userType: 'doctor';
  isAvailable: boolean;
  passwordHash: string;
  createdAt: string;
}

export interface PatientMedicalAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  uploadedAt: string;
}

export interface PatientMedicalDetails {
  age?: number;
  diseaseType?: string;
  previousHistory?: string;
  attachments?: Record<string, PatientMedicalAttachment>;
  updatedAt?: string;
}

export interface PatientProfile {
  name: string;
  email: string;
  address: string;
  userType: 'patient';
  assignedDoctorId: string;
  assignedDoctorName: string;
  passwordHash: string;
  createdAt: string;
  medicalDetails?: PatientMedicalDetails;
}

export interface HandGestureData {
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
  wrist: number;
}

export interface AngleTelemetry extends HandGestureData {
  handVisible: boolean;
  isTracking: boolean;
  source: 'doctor' | 'patient';
  userId?: string;
  doctorId: string;
  patientId: string;
  callId: string | null;
  updatedAt: number | object | string;
}

export interface CallSession {
  status: 'idle' | 'dialing' | 'connected' | 'disconnected';
  doctorId: string;
  patientId: string;
  therapyMode: boolean;
  createdAt: object | string;
  updatedAt: object | string;
}

export interface LiveTrackingState {
  doctor?: AngleTelemetry;
  patient?: AngleTelemetry;
  difference?: HandGestureData & { updatedAt: number | object | string };
  status?: {
    therapyActive: boolean;
    doctorTracking: boolean;
    patientTracking: boolean;
    updatedAt: number | object | string;
  };
}

export interface PatientFeedback {
  pain: string;
  gloveComfort: string;
  pressureTooHigh: string;
  tiredness: string;
  continueProgram: string;
}

export interface TherapySessionRecord {
  id: string;
  sessionNumber: number;
  patientName: string;
  doctorName: string;
  patientId: string;
  doctorId: string;
  callId: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  recordingEnabled: boolean;
  pdfGenerated: boolean;
  reportVisibleToPatient: boolean;
  
  doctorObservation: string;
  prescription: string;
  patientFeedback: PatientFeedback;
  
  therapyProtocol?: string;
  clinicalAssessment?: string;
  followUpPlan?: string;
  
  
  flexSensorSummary?: {
    thumbAvg: number;
    indexAvg: number;
    middleAvg: number;
    ringAvg: number;
    pinkyAvg: number;
    wristAvg: number;
    sampleCount: number;
  };
  
  motorValveSummary?: {
    motorSpeedAvg: number;
    totalPumpOnTimeSec: number;
  };

  sensorLog?: any[];
  motorLog?: any[];

  files: {
    pdfBase64: string;
  };
}

// =============================================
// UTILITY
// =============================================

const lastTrackingLogAt = new Map<string, number>();

function shouldLogTrackingWrite(key: string, now: number): boolean {
  const lastLoggedAt = lastTrackingLogAt.get(key) || 0;
  if (now - lastLoggedAt < 500) return false;
  lastTrackingLogAt.set(key, now);
  return true;
}

/**
 * Resolves the active database instance dynamically if not provided.
 */
function resolveDb(db?: Database): Database {
  if (db) return db;
  if (getApps().length > 0) {
    return getDatabase(getApp());
  }
  throw new Error("Firebase App is not initialized! Pass database or call initializeFirebase.");
}

export function generateSafeId(email: string): string {
  return email.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '_');
}

function unwrapProfile<T>(node: T | { profile?: T } | undefined | null): T | null {
  if (!node) return null;
  if (typeof node === 'object' && 'profile' in node) {
    return node.profile || null;
  }
  return node as T;
}

export async function ensureDoctorRealtimeNodes(database: Database, doctorId: string): Promise<void> {
  void database;
  void doctorId;
  return;
}

export async function ensurePatientRealtimeNodes(_database: Database, _patientId: string): Promise<void> {
  const motorRef = ref(_database, getMotorControlPath(_patientId));
  const existingMotor = await get(motorRef);
  if (existingMotor.exists()) return;

  const defaultMotorState = {
    masterEnabled: false,
    enabled: false,
    speed: 0,
    onTimeSec: 5,
    offTimeSec: 2,
    v1_enabled: false,
    v1_onTimeSec: 5,
    v1_offTimeSec: 2,
    v2_enabled: false,
    v2_onTimeSec: 5,
    v2_offTimeSec: 2,
    v3_enabled: false,
    v3_onTimeSec: 5,
    v3_offTimeSec: 2,
    v4_enabled: false,
    v4_onTimeSec: 5,
    v4_offTimeSec: 2,
    v5_enabled: false,
    v5_onTimeSec: 5,
    v5_offTimeSec: 2,
    v6_enabled: false,
    v6_onTimeSec: 5,
    v6_offTimeSec: 2,
    updatedAt: Date.now(),
  };
  await set(motorRef, defaultMotorState);
}

export function getLiveTrackingBasePath(doctorId: string, patientId: string): string {
  return `doctorWorkspace/${doctorId}/patients/${patientId}/liveTracking`;
}

export function getPatientDeviceBasePath(patientId: string): string {
  return `patientDevices/${patientId}`;
}

export function getMotorControlPath(patientId: string): string {
  return `${getPatientDeviceBasePath(patientId)}/motorControl`;
}

export function getSensorDataPath(patientId: string): string {
  return `sensorData/${patientId}`;
}

export function calculateDifference(doctorAngles: HandGestureData, patientAngles: HandGestureData): HandGestureData {
  return {
    thumb: Math.abs((doctorAngles.thumb || 0) - (patientAngles.thumb || 0)),
    index: Math.abs((doctorAngles.index || 0) - (patientAngles.index || 0)),
    middle: Math.abs((doctorAngles.middle || 0) - (patientAngles.middle || 0)),
    ring: Math.abs((doctorAngles.ring || 0) - (patientAngles.ring || 0)),
    pinky: Math.abs((doctorAngles.pinky || 0) - (patientAngles.pinky || 0)),
    wrist: Math.abs((doctorAngles.wrist || 0) - (patientAngles.wrist || 0)),
  };
}

export async function writeLiveTrackingFrame(
  database: Database,
  source: 'doctor' | 'patient',
  doctorId: string,
  patientId: string,
  angles: HandGestureData,
  options: {
    callId?: string | null;
    handVisible?: boolean;
    isTracking?: boolean;
    peerAngles?: HandGestureData | null;
  } = {}
): Promise<void> {
  const basePath = getLiveTrackingBasePath(doctorId, patientId);
  const sourcePath = `${basePath}/${source}`;
  const now = Date.now();
  const payload = {
    ...angles,
    handVisible: options.handVisible ?? true,
    isTracking: options.isTracking ?? true,
    source,
    doctorId,
    patientId,
    callId: options.callId ?? null,
    updatedAt: now,
  };

  const difference = source === 'doctor' && options.peerAngles
    ? calculateDifference(angles, options.peerAngles)
    : null;

  // Keep required diagnostics useful without making high-frequency console I/O
  // compete with MediaPipe and Firebase on the browser's main thread.
  if (shouldLogTrackingWrite(`${source}:${doctorId}:${patientId}`, now)) {
    console.log(source === 'doctor' ? '[RTDB_WRITE_DOCTOR]' : '[RTDB_WRITE_PATIENT]', {
      userId: source === 'doctor' ? doctorId : patientId,
      doctorId,
      patientId,
      path: sourcePath,
      angleValues: angles,
    });
    if (difference) {
      console.log('[RTDB_WRITE_DIFFERENCE]', {
        userId: doctorId,
        doctorId,
        patientId,
        path: `${basePath}/difference`,
        angleValues: difference,
      });
    }
  }

  const promises: Promise<void>[] = [
    set(ref(database, sourcePath), payload),
  ];
  if (difference) {
    promises.push(set(ref(database, `${basePath}/difference`), {
      ...difference,
      updatedAt: now,
    }));
  }
  await Promise.all(promises);
}

export async function setLiveTrackingStatus(
  database: Database,
  doctorId: string,
  patientId: string,
  status: { therapyActive: boolean; doctorTracking?: boolean; patientTracking?: boolean }
): Promise<void> {
  await update(ref(database, `${getLiveTrackingBasePath(doctorId, patientId)}/status`), {
    ...status,
    updatedAt: Date.now(),
  });
}

/**
 * Hash a password using SHA-256 via the Web Crypto API.
 * This is a thesis prototype — production apps should use Firebase Auth with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  // Web Crypto API is only available in secure contexts (HTTPS or localhost)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Fallback for HTTP connections (e.g. 10.x.x.x local IP testing on secondary devices)
    // Basic insecure obfuscation for prototype purposes only
    return "fallback_" + btoa(password);
  }
}

// =============================================
// DOCTOR FUNCTIONS
// =============================================

export async function getDoctorsList(database?: Database): Promise<Record<string, DoctorProfile>> {
  const db = resolveDb(database);
  const snapshot = await get(ref(db, 'users/doctors'));
  if (!snapshot.exists()) return {};
  const doctors = snapshot.val() as Record<string, { profile?: DoctorProfile } | DoctorProfile>;
  return Object.fromEntries(
    Object.entries(doctors)
      .map(([id, value]) => [id, unwrapProfile<DoctorProfile>(value)])
      .filter((entry): entry is [string, DoctorProfile] => !!entry[1])
  );
}

export async function registerDoctor(
  database: Database,
  data: { name: string; email: string; address: string; password: string }
): Promise<string> {
  const doctorId = generateSafeId(data.email);
  const doctorRef = ref(database, `users/doctors/${doctorId}/profile`);

  const existing = await get(doctorRef);
  if (existing.exists()) {
    throw new Error('A doctor with this email is already registered.');
  }

  const pwHash = await hashPassword(data.password);

  const profile: DoctorProfile = {
    name: data.name,
    email: data.email,
    address: data.address,
    userType: 'doctor',
    isAvailable: true,
    passwordHash: pwHash,
    createdAt: new Date().toISOString(),
  };

  await set(doctorRef, profile);
  await ensureDoctorRealtimeNodes(database, doctorId);
  return doctorId;
}

// =============================================
// PATIENT FUNCTIONS
// =============================================

export async function registerPatient(
  database: Database,
  data: { name: string; email: string; address: string; password: string; assignedDoctorId?: string; assignedDoctorName?: string }
): Promise<string> {
  const patientId = generateSafeId(data.email);
  const patientRef = ref(database, `users/patients/${patientId}/profile`);

  const existing = await get(patientRef);
  if (existing.exists()) {
    throw new Error('A patient with this email is already registered.');
  }

  const pwHash = await hashPassword(data.password);

  const profile: PatientProfile = {
    name: data.name,
    email: data.email,
    address: data.address,
    userType: 'patient',
    assignedDoctorId: data.assignedDoctorId || '',
    assignedDoctorName: data.assignedDoctorName || '',
    passwordHash: pwHash,
    createdAt: new Date().toISOString(),
  };

  await set(patientRef, profile);
  await ensurePatientRealtimeNodes(database, patientId);
  if (profile.assignedDoctorId) {
    await update(ref(database), {
      [`doctorPatients/${profile.assignedDoctorId}/${patientId}`]: true,
    });
  }
  return patientId;
}

export async function assignDoctorToPatient(
  database: Database,
  patientId: string,
  doctorId: string
): Promise<void> {
  const patientRef = ref(database, `users/patients/${patientId}/profile`);
  const doctorRef = ref(database, `users/doctors/${doctorId}/profile`);
  const [patientSnapshot, doctorSnapshot] = await Promise.all([get(patientRef), get(doctorRef)]);

  if (!patientSnapshot.exists()) {
    throw new Error('Patient profile does not exist.');
  }
  if (!doctorSnapshot.exists()) {
    throw new Error('Selected doctor profile does not exist.');
  }

  const patient = unwrapProfile<PatientProfile>(patientSnapshot.val());
  if (!patient) {
    throw new Error('Patient profile does not exist.');
  }
  const doctor = doctorSnapshot.val() as DoctorProfile;
  const updates: Record<string, unknown> = {
    [`users/patients/${patientId}/profile/assignedDoctorId`]: doctorId,
    [`users/patients/${patientId}/profile/assignedDoctorName`]: doctor.name,
    [`doctorPatients/${doctorId}/${patientId}`]: true,
  };

  if (patient.assignedDoctorId && patient.assignedDoctorId !== doctorId) {
    updates[`doctorPatients/${patient.assignedDoctorId}/${patientId}`] = null;
  }

  await update(ref(database), updates);
}

export async function savePatientMedicalDetails(
  database: Database,
  patientId: string,
  data: {
    name: string;
    age: number | null;
    diseaseType: string;
    previousHistory: string;
    attachments: Record<string, PatientMedicalAttachment>;
  }
): Promise<void> {
  const profileRef = ref(database, `users/patients/${patientId}/profile`);
  const profileSnapshot = await get(profileRef);
  if (!profileSnapshot.exists()) {
    throw new Error('Patient profile does not exist.');
  }

  const trimmedName = data.name.trim();
  if (!trimmedName) {
    throw new Error('Patient name is required.');
  }

  const medicalDetails: PatientMedicalDetails = {
    diseaseType: data.diseaseType.trim(),
    previousHistory: data.previousHistory.trim(),
    updatedAt: new Date().toISOString(),
  };
  if (data.age !== null) medicalDetails.age = data.age;
  if (Object.keys(data.attachments).length > 0) medicalDetails.attachments = data.attachments;

  await update(profileRef, {
    name: trimmedName,
    medicalDetails,
  });
}

// =============================================
// LOGIN FUNCTION
// =============================================

export async function loginUserByEmailAndRole(
  database: Database,
  email: string,
  role: 'doctor' | 'patient',
  password: string
): Promise<{ id: string; profile: DoctorProfile | PatientProfile } | null> {
  const basePath = role === 'doctor' ? 'users/doctors' : 'users/patients';
  const snapshot = await get(ref(database, basePath));

  if (!snapshot.exists()) return null;

  const inputHash = await hashPassword(password);

  const users = snapshot.val() as Record<string, { profile?: DoctorProfile | PatientProfile } | DoctorProfile | PatientProfile>;
  for (const [id, node] of Object.entries(users)) {
    const profile = unwrapProfile<DoctorProfile | PatientProfile>(node);
    if (!profile) continue;
    if (profile.email.toLowerCase() === email.toLowerCase()) {
      if (profile.passwordHash !== inputHash) {
        throw new Error('Incorrect password. Please try again.');
      }
      if (role === 'doctor') {
        await ensureDoctorRealtimeNodes(database, id);
      } else {
        await ensurePatientRealtimeNodes(database, id);
      }
      return { id, profile };
    }
  }
  return null;
}

// =============================================
// REQUIRED HELPER FUNCTIONS (clinical API)
// =============================================

/**
 * Fetches all patients assigned to a specific doctor.
 */
export async function getPatientsByDoctor(doctorId: string, database?: Database): Promise<Record<string, PatientProfile>> {
  const db = resolveDb(database);
  const snapshot = await get(ref(db, 'users/patients'));
  if (!snapshot.exists()) return {};

  const all = snapshot.val() as Record<string, { profile?: PatientProfile } | PatientProfile>;
  const filtered: Record<string, PatientProfile> = {};
  for (const [id, node] of Object.entries(all)) {
    const patient = unwrapProfile<PatientProfile>(node);
    if (!patient) continue;
    if (patient.assignedDoctorId === doctorId) {
      filtered[id] = patient;
    }
  }
  return filtered;
}

export function listenToPatientsByDoctor(
  doctorId: string,
  callback: (patients: Record<string, PatientProfile>) => void,
  database?: Database
): () => void {
  const db = resolveDb(database);
  const unsub = onValue(ref(db, 'users/patients'), (snapshot) => {
    if (!snapshot.exists()) {
      callback({});
      return;
    }

    const all = snapshot.val() as Record<string, { profile?: PatientProfile } | PatientProfile>;
    const filtered: Record<string, PatientProfile> = {};
    for (const [id, node] of Object.entries(all)) {
      const patient = unwrapProfile<PatientProfile>(node);
      if (patient?.assignedDoctorId === doctorId) filtered[id] = patient;
    }
    callback(filtered);
  });
  return () => unsub();
}

/**
 * Doctor initiates a call to a patient.
 */
export async function initiateCall(doctorId: string, patientId: string, database?: Database): Promise<string> {
  const db = resolveDb(database);
  const patientSnapshot = await get(ref(db, `users/patients/${patientId}/profile`));
  if (!patientSnapshot.exists()) {
    throw new Error('The selected patient profile no longer exists.');
  }

  const patient = unwrapProfile<PatientProfile>(patientSnapshot.val());
  if (!patient) {
    throw new Error('The selected patient profile no longer exists.');
  }
  if (patient.assignedDoctorId !== doctorId) {
    throw new Error('Only the patient-selected therapist can start a video call with this patient.');
  }

  const callId = `${doctorId}_${patientId}`;
  const callSession: CallSession = {
    status: 'dialing',
    doctorId,
    patientId,
    therapyMode: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await update(ref(db), {
    [`activeCalls/${callId}`]: callSession,
    [`webrtc/${callId}`]: null,
    [`${getLiveTrackingBasePath(doctorId, patientId)}/status`]: {
      therapyActive: false,
      doctorTracking: false,
      patientTracking: false,
      updatedAt: Date.now(),
    },
  });
  return callId;
}

/**
 * Patient accepts an incoming call.
 */
export async function acceptCall(callId: string, database?: Database): Promise<void> {
  const db = resolveDb(database);
  const callRef = ref(db, `activeCalls/${callId}`);
  await update(callRef, {
    status: 'connected',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Patient declines an incoming call.
 */
export async function declineCall(callId: string, database?: Database): Promise<void> {
  const db = resolveDb(database);
  const callRef = ref(db, `activeCalls/${callId}`);
  const snapshot = await get(callRef);
  const call = snapshot.exists() ? snapshot.val() as CallSession : null;
  const now = Date.now();
  const updates: Record<string, unknown> = {
    [`activeCalls/${callId}/status`]: 'disconnected',
    [`activeCalls/${callId}/therapyMode`]: false,
    [`activeCalls/${callId}/updatedAt`]: new Date(now).toISOString(),
    [`webrtc/${callId}`]: null,
  };
  if (call?.doctorId && call?.patientId) {
    updates[`${getLiveTrackingBasePath(call.doctorId, call.patientId)}/status`] = {
      therapyActive: false,
      doctorTracking: false,
      patientTracking: false,
      updatedAt: now,
    };
  }
  await update(ref(db), updates);
}

/**
 * Either party ends a call.
 */
export async function endCall(callId: string, database?: Database): Promise<void> {
  const db = resolveDb(database);
  const callRef = ref(db, `activeCalls/${callId}`);
  const snapshot = await get(callRef);
  const call = snapshot.exists() ? snapshot.val() as CallSession : null;
  const now = Date.now();
  const updates: Record<string, unknown> = {
    [`activeCalls/${callId}/status`]: 'disconnected',
    [`activeCalls/${callId}/therapyMode`]: false,
    [`activeCalls/${callId}/updatedAt`]: new Date(now).toISOString(),
    [`webrtc/${callId}`]: null,
  };
  if (call?.doctorId && call?.patientId) {
    updates[`${getLiveTrackingBasePath(call.doctorId, call.patientId)}/status`] = {
      therapyActive: false,
      doctorTracking: false,
      patientTracking: false,
      updatedAt: now,
    };
  }
  await update(ref(db), updates);
}

/**
 * Doctor toggles therapy mode.
 */
export async function setTherapyMode(callId: string, enabled: boolean, database?: Database): Promise<void> {
  const db = resolveDb(database);
  const callRef = ref(db, `activeCalls/${callId}`);
  await update(callRef, {
    therapyMode: enabled,
    updatedAt: new Date().toISOString(),
  });
}

// =============================================
// LISTENERS (clinical API)
// =============================================

/**
 * Listens for incoming calls for a patient.
 * Scans activeCalls nodes where patientId matches the patient.
 */
export function listenForIncomingPatientCalls(
  patientId: string,
  callback: (calls: Record<string, CallSession>) => void,
  database?: Database
): () => void {
  const db = resolveDb(database);
  const callsRef = ref(db, 'activeCalls');
  
  const unsubscribe = onValue(callsRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback({});
      return;
    }
    const allCalls = snapshot.val() as Record<string, CallSession>;
    const matching: Record<string, CallSession> = {};
    for (const [id, call] of Object.entries(allCalls)) {
      if (call.patientId === patientId) {
        matching[id] = call;
      }
    }
    callback(matching);
  });
  
  return () => unsubscribe();
}

/**
 * Listens to a specific active call node for state changes.
 */
export function listenToActiveCall(
  callId: string,
  callback: (call: CallSession | null) => void,
  database?: Database
): () => void {
  const db = resolveDb(database);
  const callRef = ref(db, `activeCalls/${callId}`);
  
  const unsubscribe = onValue(callRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });
  
  return () => unsubscribe();
}

// =============================================
// THERAPY SESSION REPORTING (Chapter 7)
// =============================================

export async function startTherapySession(
  doctorId: string,
  patientId: string,
  doctorName: string,
  patientName: string,
  callId: string,
  recordingEnabled: boolean,
  database?: Database
): Promise<string> {
  const db = resolveDb(database);
  const sessionsRef = ref(db, `therapyReports`);
  
  // Get session count to assign sessionNumber
  const snapshot = await get(sessionsRef);
  let nextSessionNum = 1;
  if (snapshot.exists()) {
    const sessions = snapshot.val() as Record<string, TherapySessionRecord>;
    nextSessionNum = Object.values(sessions).filter((session) => session.doctorId === doctorId && session.patientId === patientId).length + 1;
  }
  
  const sessionId = `session_${nextSessionNum}_${Date.now()}`;
  const sessionRef = ref(db, `therapyReports/${sessionId}`);
  
  const newSession: TherapySessionRecord = {
    id: sessionId,
    sessionNumber: nextSessionNum,
    patientName,
    doctorName,
    patientId,
    doctorId,
    callId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationSec: 0,
    recordingEnabled,
    pdfGenerated: false,
    reportVisibleToPatient: false,
    doctorObservation: "",
    prescription: "",
    patientFeedback: {
      pain: "",
      gloveComfort: "",
      pressureTooHigh: "",
      tiredness: "",
      continueProgram: ""
    },
    files: {
      pdfBase64: ""
    }
  };
  
  await set(sessionRef, newSession);
  return sessionId;
}

export async function endTherapySession(
  _doctorId: string,
  _patientId: string,
  sessionId: string,
  durationSec: number,
  database?: Database
): Promise<void> {
  const db = resolveDb(database);
  const sessionRef = ref(db, `therapyReports/${sessionId}`);
  
  await update(sessionRef, {
    endedAt: new Date().toISOString(),
    durationSec: durationSec
  });
}

export async function updateTherapySessionReport(
  _doctorId: string,
  _patientId: string,
  sessionId: string,
  updates: Partial<TherapySessionRecord>,
  database?: Database
): Promise<void> {
  const db = resolveDb(database);
  const sessionRef = ref(db, `therapyReports/${sessionId}`);
  await update(sessionRef, updates);
}

export function listenToTherapySessions(
  doctorId: string,
  patientId: string,
  callback: (sessions: TherapySessionRecord[]) => void,
  database?: Database
): () => void {
  const db = resolveDb(database);
  const sessionsRef = ref(db, `therapyReports`);
  
  const unsubscribe = onValue(sessionsRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback([]);
      return;
    }
    const sessions = snapshot.val() as Record<string, TherapySessionRecord>;
    const sessionsArray = Object.values(sessions)
      .filter((session) => session.doctorId === doctorId && session.patientId === patientId)
      .sort((a, b) => a.sessionNumber - b.sessionNumber);
    callback(sessionsArray);
  });
  
  return () => unsubscribe();
}

export async function deleteTherapySession(
  _doctorId: string,
  _patientId: string,
  sessionId: string,
  database?: Database
): Promise<void> {
  const db = resolveDb(database);
  const sessionRef = ref(db, `therapyReports/${sessionId}`);
  await set(sessionRef, null);
}
