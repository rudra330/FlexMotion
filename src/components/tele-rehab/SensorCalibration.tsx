"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Database, ref, onValue, set } from "firebase/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Square,
  RotateCcw,
  Activity,
  Zap,
} from "lucide-react";

// =============================================
// TYPES
// =============================================

export interface CalibrationThresholds {
  restAvg: number[];
  bendAvg: number[];
  deepAvg: number[];
  minBaseline: number[];
  maxBend: number[];
  bendDetectThreshold: number[];
  noiseThreshold: number[];
  rawRange: number[];
}

export interface LiveTrackingState {
  baseline: number[];
  bendActive: boolean[];
  liveDifference: number[];
}

interface SensorCalibrationProps {
  database: Database;
  motorControlPath: string;
  sensorDataPath: string;
  onCalibrationComplete: (thresholds: CalibrationThresholds) => void;
  onCancel: () => void;
}

// =============================================
// CONSTANTS
// =============================================

const NUM_SENSORS = 5;
const SENSOR_NAMES = ["Thumb (F0)", "Index (F1)", "Middle (F2)", "Ring (F3)", "Pinky (F4)"];
const VALVE_NAMES = ["Valve 1", "Valve 2", "Valve 3", "Valve 4", "Valve 5", "Valve 6"];

// Mapping from Valve Index (0-5) to Sensor Index (0-4)
// V1(0)->Thumb(0), V2(1)->Unmapped, V3(2)->Middle(2), V4(3)->Ring(3), V5(4)->Pinky(4), V6(5)->Index(1)
const VALVE_TO_SENSOR_MAP: Record<number, number | null> = {
  0: 0,
  1: null,
  2: 2,
  3: 3,
  4: 4,
  5: 1
};

const SETTLE_TIME = 2.0; // seconds
const RECORD_TIME = 2.0; // seconds
const PHASE_TOTAL_TIME = SETTLE_TIME + RECORD_TIME;
const DEEP_BASELINE_DURATION = 60.0; // seconds
const DEEP_BASELINE_SETTLE = 2.0; // seconds

const DEFAULT_MOTOR_SPEED = 128;
const MAX_ATTEMPTS = 5;

type CalibrationPhase =
  | "idle"
  | "rest"
  | "select_valve"
  | "bend"
  | "deep_baseline_settle"
  | "deep_baseline"
  | "calculating"
  | "complete";

// =============================================
// COMPONENT
// =============================================

export function SensorCalibration({
  database,
  motorControlPath,
  sensorDataPath,
  onCalibrationComplete,
  onCancel,
}: SensorCalibrationProps) {
  // Phase state
  const [phase, setPhase] = useState<CalibrationPhase>("idle");
  const [phaseMessage, setPhaseMessage] = useState("Press Start to begin calibration");
  const [subMessage, setSubMessage] = useState("");

  // Timer
  const [countdown, setCountdown] = useState(0);
  const [progress, setProgress] = useState(0);

  // Calibration data tracking
  const [attempt, setAttempt] = useState(1);
  const [calibratedValves, setCalibratedValves] = useState<Set<number>>(new Set());
  const [selectedValves, setSelectedValves] = useState<boolean[]>([false, false, false, false, false, false]); // v1-v6

  // Raw sensor values (from Firebase)
  const [rawValues, setRawValues] = useState<number[]>([0, 0, 0, 0, 0]);

  // Calibration sample storage
  const restSamplesRef = useRef<number[][]>([[], [], [], [], []]);
  const bendSamplesRef = useRef<{ sensorIdx: number; samples: { elapsed: number; value: number }[] }[]>([]);
  const deepBaselineSamplesRef = useRef<number[][]>([[], [], [], [], []]);

  // Current bend capture: records all 5 sensors simultaneously
  const currentBendSamplesRef = useRef<{ elapsed: number; values: number[] }[]>([]);

  // Timer refs
  const phaseStartRef = useRef(0);
  const recordingRef = useRef(false);
  const phaseRef = useRef<CalibrationPhase>("idle");
  const animFrameRef = useRef<number>(0);

  // Thresholds result
  const [thresholds, setThresholds] = useState<CalibrationThresholds | null>(null);

  // =============================================
  // Firebase listener for raw sensor data
  // =============================================
  useEffect(() => {
    const sensorRef = ref(database, sensorDataPath);
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
        setRawValues(values);

        // If recording, store samples
        if (recordingRef.current) {
          const elapsed = (performance.now() - phaseStartRef.current) / 1000;
          const currentPhase = phaseRef.current;

          if (currentPhase === "rest") {
            for (let s = 0; s < NUM_SENSORS; s++) {
              restSamplesRef.current[s].push(values[s]);
            }
          } else if (currentPhase === "bend") {
            currentBendSamplesRef.current.push({ elapsed, values: [...values] });
          } else if (currentPhase === "deep_baseline") {
            for (let s = 0; s < NUM_SENSORS; s++) {
              deepBaselineSamplesRef.current[s].push(values[s]);
            }
          }
        }
      }
    });

    return () => unsubscribe();
  }, [database, sensorDataPath]);

  // =============================================
  // Write valve control to the selected patient's motorControl node
  // =============================================
  const writeValveState = useCallback(
    (valves: boolean[], motorOn: boolean) => {
      const motorControlRef = ref(database, motorControlPath);
      set(motorControlRef, {
        masterEnabled: motorOn,
        enabled: motorOn,
        speed: motorOn ? DEFAULT_MOTOR_SPEED : 0,
        onTimeSec: 4,
        offTimeSec: 0,
        v1_enabled: motorOn && valves[0],
        v1_onTimeSec: 4,
        v1_offTimeSec: 0,
        v2_enabled: motorOn && valves[1],
        v2_onTimeSec: 4,
        v2_offTimeSec: 0,
        v3_enabled: motorOn && valves[2],
        v3_onTimeSec: 4,
        v3_offTimeSec: 0,
        v4_enabled: motorOn && valves[3],
        v4_onTimeSec: 4,
        v4_offTimeSec: 0,
        v5_enabled: motorOn && valves[4],
        v5_onTimeSec: 4,
        v5_offTimeSec: 0,
        v6_enabled: motorOn && valves[5],
        v6_onTimeSec: 4,
        v6_offTimeSec: 0,
        updatedAt: Date.now(),
      }).catch(console.error);
    },
    [database, motorControlPath]
  );

  const turnOffAllValves = useCallback(() => {
    writeValveState([false, false, false, false, false, false], false);
  }, [writeValveState]);

  // =============================================
  // Timer animation loop
  // =============================================
  const runTimedPhase = useCallback(
    (
      durationSec: number,
      onTick: (elapsed: number, remaining: number) => void,
      onComplete: () => void
    ) => {
      phaseStartRef.current = performance.now();
      recordingRef.current = true;

      const tick = () => {
        const elapsed = (performance.now() - phaseStartRef.current) / 1000;
        const remaining = Math.max(0, durationSec - elapsed);

        onTick(elapsed, remaining);

        if (elapsed >= durationSec) {
          recordingRef.current = false;
          onComplete();
          return;
        }

        animFrameRef.current = requestAnimationFrame(tick);
      };

      animFrameRef.current = requestAnimationFrame(tick);
    },
    []
  );

  // =============================================
  // PHASE HANDLERS
  // =============================================

  const startCalibration = useCallback(() => {
    // Reset all data
    restSamplesRef.current = [[], [], [], [], []];
    bendSamplesRef.current = [];
    deepBaselineSamplesRef.current = [[], [], [], [], []];
    currentBendSamplesRef.current = [];
    setCalibratedValves(new Set());
    setAttempt(1);
    setThresholds(null);

    // Start REST phase
    setPhase("rest");
    phaseRef.current = "rest";
    setPhaseMessage("REST PHASE: Keep all sensors at natural rest");
    setSubMessage("All valves OFF. Hold still for 4 seconds.");
    turnOffAllValves();

    runTimedPhase(
      PHASE_TOTAL_TIME,
      (elapsed, remaining) => {
        setCountdown(Math.ceil(remaining));
        setProgress((elapsed / PHASE_TOTAL_TIME) * 100);
      },
      () => {
        // REST done — move to valve selection for first attempt
        recordingRef.current = false;
        setPhase("select_valve");
        phaseRef.current = "select_valve";
        setPhaseMessage(`ATTEMPT 1: SELECT VALVES`);
        setSubMessage("Choose the uncalibrated valves to bend together, then click 'Start Bend'.");
        setSelectedValves([false, false, false, false, false, false]);
        setProgress(0);
        setCountdown(0);
      }
    );
  }, [runTimedPhase, turnOffAllValves]);

  const startBendCapture = useCallback(() => {
    // Validate at least one valve selected
    if (!selectedValves.some((v) => v)) return;

    // Turn on selected valves
    writeValveState(selectedValves, true);

    // Start bend recording
    currentBendSamplesRef.current = [];
    setPhase("bend");
    phaseRef.current = "bend";
    setPhaseMessage(`BEND PHASE (Attempt ${attempt})`);
    setSubMessage("Hold bend position. First 2s settling, last 2s recording.");

    runTimedPhase(
      PHASE_TOTAL_TIME,
      (elapsed, remaining) => {
        setCountdown(Math.ceil(remaining));
        setProgress((elapsed / PHASE_TOTAL_TIME) * 100);
      },
      () => {
        recordingRef.current = false;
        turnOffAllValves();

        // Process data for the selected valves
        const newCalibrated = new Set(calibratedValves);
        
        selectedValves.forEach((isSelected, valveIdx) => {
          if (isSelected) {
            newCalibrated.add(valveIdx);
            
            const sensorIdx = VALVE_TO_SENSOR_MAP[valveIdx];
            if (sensorIdx !== null) {
              // Extract the sensor data corresponding to this valve
              const extractedSamples = currentBendSamplesRef.current.map(s => ({
                elapsed: s.elapsed,
                value: s.values[sensorIdx]
              }));
              
              // If this sensor was already recorded in a previous attempt, replace it
              const existingIndex = bendSamplesRef.current.findIndex(b => b.sensorIdx === sensorIdx);
              if (existingIndex >= 0) {
                bendSamplesRef.current[existingIndex] = { sensorIdx, samples: extractedSamples };
              } else {
                bendSamplesRef.current.push({ sensorIdx, samples: extractedSamples });
              }
            }
          }
        });

        setCalibratedValves(newCalibrated);

        // Check if we are done (5 total unique valves calibrated, or max attempts used)
        const nextAttempt = attempt + 1;

        if (newCalibrated.size >= 5 || nextAttempt > MAX_ATTEMPTS) {
          // Move to deep baseline
          startDeepBaseline();
        } else {
          // Setup next attempt
          setAttempt(nextAttempt);
          setPhase("select_valve");
          phaseRef.current = "select_valve";
          setPhaseMessage(`ATTEMPT ${nextAttempt}: SELECT VALVES`);
          setSubMessage("Choose the remaining uncalibrated valves.");
          setSelectedValves([false, false, false, false, false, false]);
          setProgress(0);
          setCountdown(0);
        }
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedValves, attempt, calibratedValves, writeValveState, turnOffAllValves, runTimedPhase]);

  const startDeepBaseline = useCallback(() => {
    turnOffAllValves();

    // Settle phase
    setPhase("deep_baseline_settle");
    phaseRef.current = "deep_baseline_settle";
    setPhaseMessage("RETURN ALL SENSORS TO REST");
    setSubMessage("Keep hand completely still. 2s settling...");

    runTimedPhase(
      DEEP_BASELINE_SETTLE,
      (elapsed, remaining) => {
        setCountdown(Math.ceil(remaining));
        setProgress((elapsed / DEEP_BASELINE_SETTLE) * 5);
      },
      () => {
        // Start deep baseline recording
        deepBaselineSamplesRef.current = [[], [], [], [], []];
        setPhase("deep_baseline");
        phaseRef.current = "deep_baseline";
        setPhaseMessage("RECORDING DEEP BASELINE (60s)");
        setSubMessage("Keep all sensors completely still in natural rest position.");

        runTimedPhase(
          DEEP_BASELINE_DURATION,
          (elapsed, remaining) => {
            setCountdown(Math.ceil(remaining));
            setProgress(5 + (elapsed / DEEP_BASELINE_DURATION) * 95);
          },
          () => {
            recordingRef.current = false;
            calculateThresholds();
          }
        );
      }
    );
  }, [turnOffAllValves, runTimedPhase]);

  // =============================================
  // THRESHOLD CALCULATION
  // =============================================

  const calculateThresholds = useCallback(() => {
    setPhase("calculating");
    phaseRef.current = "calculating";
    setPhaseMessage("CALCULATING THRESHOLDS...");
    setSubMessage("Processing calibration data...");

    const restAvg: number[] = [];
    const bendAvg: number[] = [];
    const deepAvg: number[] = [];
    const minBaseline: number[] = [];
    const maxBend: number[] = [];
    const bendDetectThreshold: number[] = [];
    const noiseThreshold: number[] = [];
    const rawRangeArr: number[] = [];

    for (let s = 0; s < NUM_SENSORS; s++) {
      // REST: use last half of samples as approximation for "last 2s"
      const restAll = restSamplesRef.current[s];
      const restLastHalf = restAll.length > 2 ? restAll.slice(Math.floor(restAll.length / 2)) : restAll;
      const rAvg = restLastHalf.length > 0 ? restLastHalf.reduce((a, b) => a + b, 0) / restLastHalf.length : 0;
      restAvg.push(Math.round(rAvg));

      // BEND: find the bend entry for this sensor
      const bendEntry = bendSamplesRef.current.find((b) => b.sensorIdx === s);
      let bAvg = 0;
      if (bendEntry && bendEntry.samples.length > 0) {
        // Use samples from last 2s (elapsed >= SETTLE_TIME)
        const last2s = bendEntry.samples.filter((sample) => sample.elapsed >= SETTLE_TIME);
        const samplesForAvg = last2s.length > 0 ? last2s : bendEntry.samples.slice(Math.floor(bendEntry.samples.length / 2));
        bAvg = samplesForAvg.reduce((a, b) => a + b.value, 0) / samplesForAvg.length;
      }
      bendAvg.push(Math.round(bAvg));

      // DEEP BASELINE: use all samples
      const deepAll = deepBaselineSamplesRef.current[s];
      const dAvg = deepAll.length > 0 ? deepAll.reduce((a, b) => a + b, 0) / deepAll.length : 0;
      deepAvg.push(Math.round(dAvg));

      // Calculate thresholds
      const mBaseline = Math.max(restAvg[s], deepAvg[s]);
      const mBend = bendAvg[s] || mBaseline; // fallback if sensor wasn't calibrated
      minBaseline.push(mBaseline);
      maxBend.push(mBend);

      const rawRange = mBend - mBaseline;
      rawRangeArr.push(rawRange);
      if (rawRange <= 0) {
        bendDetectThreshold.push(1);
        noiseThreshold.push(1);
      } else {
        bendDetectThreshold.push(rawRange / 2);
        noiseThreshold.push(rawRange / 3);
      }
    }

    const result: CalibrationThresholds = {
      restAvg,
      bendAvg,
      deepAvg,
      minBaseline,
      maxBend,
      bendDetectThreshold,
      noiseThreshold,
      rawRange: rawRangeArr,
    };

    setThresholds(result);
    setPhase("complete");
    phaseRef.current = "complete";
    setPhaseMessage("CALIBRATION COMPLETE");
    setSubMessage("Thresholds calculated. Hand tracking will now activate.");
    setProgress(100);

    onCalibrationComplete(result);
  }, [onCalibrationComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      turnOffAllValves();
    };
  }, [turnOffAllValves]);

  // =============================================
  // VALVE TOGGLE (for select_valve phase)
  // =============================================
  const toggleValve = (idx: number) => {
    if (calibratedValves.has(idx)) return; // Disable selection if already calibrated
    const newValves = [...selectedValves];
    newValves[idx] = !newValves[idx];
    setSelectedValves(newValves);
  };

  // Auto-advance: when calibrated + selected reaches 5, immediately start bend capture
  useEffect(() => {
    if (phase !== "select_valve") return;
    const selectedCount = selectedValves.filter(v => v).length;
    const totalSelected = calibratedValves.size + selectedCount;
    if (totalSelected >= 5 && selectedCount > 0) {
      startBendCapture();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedValves, phase]);

  // =============================================
  // RENDER
  // =============================================
  const isRunning = phase !== "idle" && phase !== "select_valve" && phase !== "complete";

  return (
    <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
          <Activity className="h-5 w-5 text-amber-400" />
          Flex Sensor Calibration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Phase indicator */}
        <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <Badge
              variant="outline"
              className={`text-xs ${
                phase === "complete"
                  ? "text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
                  : phase === "idle"
                  ? "text-slate-400 border-slate-600"
                  : "text-amber-400 border-amber-500/50 bg-amber-500/10"
              }`}
            >
              {phase === "idle" && "Ready"}
              {phase === "rest" && "REST Phase"}
              {phase === "select_valve" && "Select Valve"}
              {phase === "bend" && "BEND Phase"}
              {phase === "deep_baseline_settle" && "Settling"}
              {phase === "deep_baseline" && "Deep Baseline"}
              {phase === "calculating" && "Calculating"}
              {phase === "complete" && "Complete ✓"}
            </Badge>
            {isRunning && (
              <span className="text-amber-400 font-mono text-lg font-bold">{countdown}s</span>
            )}
          </div>
          <p className="text-white font-bold text-lg">{phaseMessage}</p>
          <p className="text-slate-400 text-sm mt-1">{subMessage}</p>

          {/* Progress bar */}
          {(isRunning || phase === "complete") && (
            <div className="mt-3 h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${progress}%`,
                  background:
                    phase === "complete"
                      ? "linear-gradient(90deg, #22c55e, #38bdf8)"
                      : "linear-gradient(90deg, #f59e0b, #ef4444)",
                }}
              />
            </div>
          )}
        </div>

        {/* Raw sensor display */}
        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
          <p className="text-xs text-slate-500 font-semibold mb-2">LIVE RAW SENSOR VALUES</p>
          <div className="grid grid-cols-5 gap-2">
            {rawValues.map((val, i) => (
              <div key={i} className="text-center">
                <p className="text-[10px] text-slate-500">F{i}</p>
                <p className="text-lg font-mono font-bold text-emerald-400">{val}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Valve selection (only during select_valve phase) */}
        {phase === "select_valve" && (
          <div className="bg-slate-950/80 p-4 rounded-xl border border-amber-500/30">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-amber-400 font-semibold">
                SELECT VALVES TO BEND (Attempt {attempt}/{MAX_ATTEMPTS})
              </p>
              <p className="text-[10px] text-slate-400">
                {calibratedValves.size} of 5 valves calibrated
              </p>
            </div>
            
            <div className="grid grid-cols-3 gap-2 mb-3">
              {VALVE_NAMES.map((name, i) => {
                const isCalibrated = calibratedValves.has(i);
                const isSelected = selectedValves[i];
                
                return (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    disabled={isCalibrated}
                    onClick={() => toggleValve(i)}
                    className={`text-xs transition-colors ${
                      isCalibrated
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 opacity-60"
                        : isSelected
                        ? "bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-700"
                        : "bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800"
                    }`}
                  >
                    {name} {isCalibrated ? "✓ Done" : isSelected ? "✓" : ""}
                  </Button>
                );
              })}
            </div>
            <Button
              onClick={startBendCapture}
              disabled={!selectedValves.some((v) => v)}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Zap className="h-4 w-4 mr-2" />
              Start Bend Capture (4s)
            </Button>
          </div>
        )}

        {/* Threshold results (after complete) */}
        {phase === "complete" && thresholds && (
          <div className="bg-slate-950/80 p-4 rounded-xl border border-emerald-500/30">
            <p className="text-xs text-emerald-400 font-semibold mb-2">CALIBRATION RESULTS</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-slate-300">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left py-1">Sensor</th>
                    <th className="text-right py-1">Rest</th>
                    <th className="text-right py-1">Bend</th>
                    <th className="text-right py-1">Deep</th>
                    <th className="text-right py-1">Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {SENSOR_NAMES.map((name, i) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="py-1 font-mono">{name.split(" ")[0]}</td>
                      <td className="text-right py-1 font-mono">{thresholds.restAvg[i]}</td>
                      <td className="text-right py-1 font-mono">{thresholds.bendAvg[i]}</td>
                      <td className="text-right py-1 font-mono">{thresholds.deepAvg[i]}</td>
                      <td className="text-right py-1 font-mono text-amber-400">
                        {thresholds.bendDetectThreshold[i].toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {phase === "idle" && (
            <Button
              onClick={startCalibration}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Play className="h-4 w-4 mr-2" />
              Start Calibration
            </Button>
          )}
          {phase === "complete" && (
            <Button
              onClick={startCalibration}
              variant="outline"
              className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Re-Calibrate
            </Button>
          )}
          <Button
            onClick={() => {
              if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
              recordingRef.current = false;
              turnOffAllValves();
              onCancel();
            }}
            variant="outline"
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            <Square className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
