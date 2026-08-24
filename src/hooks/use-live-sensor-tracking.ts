import { useState, useEffect, useRef } from "react";
import { Database, ref, onValue } from "firebase/database";
import { getSensorDataPath } from "@/firebase/teleRehab";

export interface CalibrationThresholdsData {
  minBaseline: number[];
  maxBend: number[];
  restAvg: number[];
  bendAvg: number[];
  deepAvg: number[];
  rawRange: number[];
  bendDetectThreshold: number[];
  noiseThreshold: number[];
  baselineUpdateIntervalMs: number;
}

export interface LiveSensorData {
  raw: number[];
  liveDifference: number[];
}

export function useLiveSensorTracking(database: Database | null, patientId: string | null) {
  const [sensorValues, setSensorValues] = useState<LiveSensorData>({
    raw: [0, 0, 0, 0, 0],
    liveDifference: [0, 0, 0, 0, 0],
  });

  const thresholdsRef = useRef<CalibrationThresholdsData | null>(null);
  
  // State refs for 300ms loop
  const rawDataRef = useRef<number[]>([0, 0, 0, 0, 0]);
  const baselineRef = useRef<number[]>([-1, -1, -1, -1, -1]);
  const bendActiveRef = useRef<boolean[]>([false, false, false, false, false]);
  const lastBaselineUpdateRef = useRef<number[]>([0, 0, 0, 0, 0]);

  // Load Thresholds
  useEffect(() => {
    if (!database || !patientId) {
      thresholdsRef.current = null;
      return;
    }
    const targetPatientId = patientId;
    const thresholdRef = ref(database, `calibrationThresholds/${targetPatientId}`);
    
    const unsubscribe = onValue(thresholdRef, (snapshot) => {
      if (snapshot.exists()) {
        thresholdsRef.current = snapshot.val() as CalibrationThresholdsData;
      } else {
        thresholdsRef.current = null;
      }
    });
    
    return () => unsubscribe();
  }, [database, patientId]);

  // Load Sensor Data
  useEffect(() => {
    if (!database || !patientId) {
      rawDataRef.current = [0, 0, 0, 0, 0];
      return;
    }
    const sensorRef = ref(database, getSensorDataPath(patientId));
    const unsubscribe = onValue(sensorRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const values = [
          data.thumb ?? data.flex1 ?? 0,
          data.index ?? data.flex2 ?? 0,
          data.middle ?? data.flex3 ?? 0,
          data.ring ?? data.flex4 ?? 0,
          data.pinky ?? data.flex5 ?? 0,
        ];
        rawDataRef.current = values;
      }
    });
    return () => unsubscribe();
  }, [database, patientId]);

  // 300ms Tracking Loop
  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = performance.now();
      const raw = rawDataRef.current;
      const thresholds = thresholdsRef.current;
      const newLiveDifference = [0, 0, 0, 0, 0];

      for (let i = 0; i < 5; i++) {
        const current_raw = raw[i];
        
        // Initialize baseline if missing
        if (baselineRef.current[i] === -1) {
          if (current_raw > 0) {
            baselineRef.current[i] = current_raw;
          } else if (thresholds && thresholds.minBaseline && thresholds.minBaseline[i] !== undefined) {
            baselineRef.current[i] = thresholds.minBaseline[i];
          } else {
            baselineRef.current[i] = 0; // ultimate fallback
          }
        }

        const baseline = baselineRef.current[i];
        const bend_detect_threshold = thresholds?.bendDetectThreshold?.[i] ?? 10; // Fallback
        
        let live_difference = current_raw - baseline;

        if (bendActiveRef.current[i]) {
          if (live_difference < 0 || live_difference < bend_detect_threshold) {
            bendActiveRef.current[i] = false;
            baselineRef.current[i] = current_raw;
            lastBaselineUpdateRef.current[i] = now;
            live_difference = 0;
          } else {
            // Keep bendActive true and freeze baseline
          }
        } else {
          if (current_raw > baseline + bend_detect_threshold) {
            bendActiveRef.current[i] = true;
            live_difference = current_raw - baseline;
          } else {
            live_difference = 0;
            if (now - lastBaselineUpdateRef.current[i] >= 300) {
              baselineRef.current[i] = current_raw;
              lastBaselineUpdateRef.current[i] = now;
            }
          }
        }

        newLiveDifference[i] = Math.max(0, live_difference);
      }

      setSensorValues({
        raw: [...raw],
        liveDifference: newLiveDifference,
      });

    }, 300);

    return () => clearInterval(intervalId);
  }, []);

  return sensorValues;
}
