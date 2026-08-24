
"use client";

import { useState, useEffect, useRef } from "react";
import { ref, set, onValue } from "firebase/database";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useDatabase, useFirebase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { getMotorControlPath } from "@/firebase/teleRehab";

export default function MotorControlPage() {
  const [speed, setSpeed] = useState(128);
  const [onTime, setOnTime] = useState(5);
  const [offTime, setOffTime] = useState(2);
  const [isControlEnabled, setIsControlEnabled] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [isCycleActive, setIsCycleActive] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasActiveCall, setHasActiveCall] = useState(false);
  const [activeCallPatientId, setActiveCallPatientId] = useState<string | null>(null);
  const [valveSelection, setValveSelection] = useState({
    v1: true, v2: true, v3: true, v4: true, v5: true, v6: true
  });

  const database = useDatabase();
  const { isUserLoading } = useFirebase();
  const { toast } = useToast();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsClient(true);
    setRole(localStorage.getItem("flex_role"));
    setUserId(localStorage.getItem("flex_uid"));
  }, []);

  useEffect(() => {
    if (!database || !userId || !role) return;

    const activeCallsRef = ref(database, "activeCalls");
    const unsubscribe = onValue(activeCallsRef, (snapshot) => {
      if (!snapshot.exists()) {
        setHasActiveCall(false);
        setActiveCallPatientId(null);
        return;
      }

      const calls = snapshot.val() as Record<string, any>;
      const activeCall = Object.values(calls).find((call) => {
        if (!call || typeof call !== "object" || call.status === "disconnected") return false;
        if (role === "doctor") return call.doctorId === userId && call.status === "connected";
        if (role === "patient") return call.patientId === userId && (call.status === "dialing" || call.status === "connected");
        return false;
      }) as any | undefined;
      setHasActiveCall(!!activeCall);
      setActiveCallPatientId(activeCall?.patientId || null);
    });

    return () => unsubscribe();
  }, [database, role, userId]);

  const canControlMotor =
    role === "doctor" ? hasActiveCall : role === "patient" ? !hasActiveCall : false;
  const motorPatientId = role === "patient" ? userId : activeCallPatientId;
  const motorControlPath = motorPatientId ? getMotorControlPath(motorPatientId) : null;

  useEffect(() => {
    if (!canControlMotor && isControlEnabled) {
      setIsControlEnabled(false);
      setIsCycleActive(false);
    }
  }, [canControlMotor, isControlEnabled]);

  // Effect for managing the ON/OFF timer cycle
  useEffect(() => {
    // Cleanup function to be called on unmount or dependency change
    const cleanup = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };

    if (isControlEnabled && onTime > 0 && offTime > 0) {
      const cycle = () => {
        // Turn ON
        setIsCycleActive(true);
        timerRef.current = setTimeout(() => {
          // Turn OFF
          setIsCycleActive(false);
          timerRef.current = setTimeout(cycle, offTime * 1000);
        }, onTime * 1000);
      };
      cycle(); // Start the cycle
    } else {
      // If master control is off or times are invalid, ensure cycle is off
      setIsCycleActive(false);
    }

    return cleanup;
  }, [isControlEnabled, onTime, offTime]);

  // Effect for writing all motor control data to Firebase
  useEffect(() => {
    if (!isClient || !database || isUserLoading || !canControlMotor || !motorControlPath) return;

    const motorControlRef = ref(database, motorControlPath);
    
    let dataToWrite;

    if (isControlEnabled) {
      dataToWrite = {
        masterEnabled: true,
        enabled: isCycleActive,
        speed: isCycleActive ? speed : 0,
        onTimeSec: onTime,
        offTimeSec: offTime,
        v1_enabled: isCycleActive && valveSelection.v1,
        v1_onTimeSec: valveSelection.v1 ? onTime : 0,
        v1_offTimeSec: valveSelection.v1 ? offTime : 0,
        v2_enabled: isCycleActive && valveSelection.v2,
        v2_onTimeSec: valveSelection.v2 ? onTime : 0,
        v2_offTimeSec: valveSelection.v2 ? offTime : 0,
        v3_enabled: isCycleActive && valveSelection.v3,
        v3_onTimeSec: valveSelection.v3 ? onTime : 0,
        v3_offTimeSec: valveSelection.v3 ? offTime : 0,
        v4_enabled: isCycleActive && valveSelection.v4,
        v4_onTimeSec: valveSelection.v4 ? onTime : 0,
        v4_offTimeSec: valveSelection.v4 ? offTime : 0,
        v5_enabled: isCycleActive && valveSelection.v5,
        v5_onTimeSec: valveSelection.v5 ? onTime : 0,
        v5_offTimeSec: valveSelection.v5 ? offTime : 0,
        v6_enabled: isCycleActive && valveSelection.v6,
        v6_onTimeSec: valveSelection.v6 ? onTime : 0,
        v6_offTimeSec: valveSelection.v6 ? offTime : 0,
        updatedAt: Date.now(),
      };
    } else {
      // When master control is toggled off, send one final "off" state
      dataToWrite = {
        masterEnabled: false,
        enabled: false,
        speed: 0,
        onTimeSec: onTime,
        offTimeSec: offTime,
        v1_enabled: false,
        v1_onTimeSec: onTime,
        v1_offTimeSec: offTime,
        v2_enabled: false,
        v2_onTimeSec: onTime,
        v2_offTimeSec: offTime,
        v3_enabled: false,
        v3_onTimeSec: onTime,
        v3_offTimeSec: offTime,
        v4_enabled: false,
        v4_onTimeSec: onTime,
        v4_offTimeSec: offTime,
        v5_enabled: false,
        v5_onTimeSec: onTime,
        v5_offTimeSec: offTime,
        v6_enabled: false,
        v6_onTimeSec: onTime,
        v6_offTimeSec: offTime,
        updatedAt: Date.now(),
      };
    }
    
    set(motorControlRef, dataToWrite).catch((error) => {
        console.error("Failed to write motor control data. Full error object:", error);
        if (isControlEnabled) { // Only show toast if writes are expected
            toast({
              title: "Firebase Write Error",
              description: `Could not send motor data. Reason: ${error.message}`,
              variant: "destructive",
            });
        }
    });

  }, [isControlEnabled, isCycleActive, speed, onTime, offTime, valveSelection, isClient, database, toast, isUserLoading, canControlMotor, motorControlPath]);


  const handleSwitchChange = (checked: boolean) => {
    if (!isClient || !canControlMotor) return;
    setIsControlEnabled(checked);
    if (!isUserLoading) {
        toast({
          title: checked ? "Realtime Control Enabled" : "Realtime Control Disabled",
          description: checked
            ? "Motor values are now being sent to the database."
            : "Motor control cycle stopped.",
        });
    }
  };

  if (!isClient) {
    return (
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mb-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-4 w-3/4 mt-2" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-2">
                <Skeleton className="h-6 w-11 rounded-full" />
                <Skeleton className="h-6 w-40" />
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-4 w-3/4 mt-2" />
            </CardHeader>
            <CardContent className="space-y-10 pt-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-1/2" />
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8">
      {!canControlMotor && (
        <Alert className="mb-6 border-amber-500/30 bg-amber-500/10 text-amber-200">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Motor Control Locked</AlertTitle>
          <AlertDescription>
            {role === "doctor"
              ? "Doctors can control the motor only during an active connected patient video call."
              : "Patients can control the motor only when they are not in a video call. During calls, the doctor is in command."}
          </AlertDescription>
        </Alert>
      )}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Master Control</CardTitle>
            <CardDescription>
              Enable or disable the motor and valve control cycle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Switch
                id="motor-control-switch"
                checked={isControlEnabled}
                onCheckedChange={handleSwitchChange}
                disabled={isUserLoading || !canControlMotor}
              />
              <Label htmlFor="motor-control-switch">
                Enable Realtime Control
              </Label>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Air Pump Motor</CardTitle>
            <CardDescription>
              Control the speed and timer cycle of the air pump motor and Valve 1.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 pt-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="bldc-speed">Speed</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {speed}
                </span>
              </div>
              <Slider
                id="bldc-speed"
                min={0}
                max={255}
                step={1}
                value={[speed]}
                onValueChange={(value) => setSpeed(value[0])}
                disabled={!canControlMotor}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>255</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="on-time">ON Time (sec)</Label>
                    <Input id="on-time" type="number" min="0" value={onTime} onChange={e => setOnTime(Number(e.target.value))} disabled={!canControlMotor} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="off-time">OFF Time (sec)</Label>
                    <Input id="off-time" type="number" min="0" value={offTime} onChange={e => setOffTime(Number(e.target.value))} disabled={!canControlMotor} />
                </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Solenoid Valves</CardTitle>
             <CardDescription>
              Toggle the valves below. Only selected valves will sync with the motor cycle.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <Button 
              onClick={() => setValveSelection(s => ({...s, v1: !s.v1}))}
              disabled={!canControlMotor}
              className={cn("font-bold transition-all", valveSelection.v1 ? (isControlEnabled && isCycleActive ? "bg-green-500 hover:bg-green-600" : "bg-emerald-600 hover:bg-emerald-700") : "bg-slate-700 hover:bg-slate-600 text-slate-300")}
            >Valve 1</Button>
            <Button 
              onClick={() => setValveSelection(s => ({...s, v2: !s.v2}))}
              disabled={!canControlMotor}
              className={cn("font-bold transition-all", valveSelection.v2 ? (isControlEnabled && isCycleActive ? "bg-green-500 hover:bg-green-600" : "bg-emerald-600 hover:bg-emerald-700") : "bg-slate-700 hover:bg-slate-600 text-slate-300")}
            >Valve 2</Button>
            <Button 
              onClick={() => setValveSelection(s => ({...s, v3: !s.v3}))}
              disabled={!canControlMotor}
              className={cn("font-bold transition-all", valveSelection.v3 ? (isControlEnabled && isCycleActive ? "bg-green-500 hover:bg-green-600" : "bg-emerald-600 hover:bg-emerald-700") : "bg-slate-700 hover:bg-slate-600 text-slate-300")}
            >Valve 3</Button>
            <Button 
              onClick={() => setValveSelection(s => ({...s, v4: !s.v4}))}
              disabled={!canControlMotor}
              className={cn("font-bold transition-all", valveSelection.v4 ? (isControlEnabled && isCycleActive ? "bg-green-500 hover:bg-green-600" : "bg-emerald-600 hover:bg-emerald-700") : "bg-slate-700 hover:bg-slate-600 text-slate-300")}
            >Valve 4</Button>
            <Button 
              onClick={() => setValveSelection(s => ({...s, v5: !s.v5}))}
              disabled={!canControlMotor}
              className={cn("font-bold transition-all", valveSelection.v5 ? (isControlEnabled && isCycleActive ? "bg-green-500 hover:bg-green-600" : "bg-emerald-600 hover:bg-emerald-700") : "bg-slate-700 hover:bg-slate-600 text-slate-300")}
            >Valve 5</Button>
            <Button 
              onClick={() => setValveSelection(s => ({...s, v6: !s.v6}))}
              disabled={!canControlMotor}
              className={cn("font-bold transition-all", valveSelection.v6 ? (isControlEnabled && isCycleActive ? "bg-green-500 hover:bg-green-600" : "bg-emerald-600 hover:bg-emerald-700") : "bg-slate-700 hover:bg-slate-600 text-slate-300")}
            >Valve 6</Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
