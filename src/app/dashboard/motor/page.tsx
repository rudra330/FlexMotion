
"use client";

import { useState, useEffect, useRef } from "react";
import { ref, set } from "firebase/database";
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
import { useDatabase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function MotorControlPage() {
  const [speed, setSpeed] = useState(128);
  const [onTime, setOnTime] = useState(5);
  const [offTime, setOffTime] = useState(2);
  const [isControlEnabled, setIsControlEnabled] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [isCycleActive, setIsCycleActive] = useState(false);

  const database = useDatabase();
  const { toast } = useToast();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

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
    if (!isClient || !database) return;

    const motorControlRef = ref(database, "motorControl");
    
    let dataToWrite;

    if (isControlEnabled) {
      dataToWrite = {
        masterEnabled: true,
        enabled: isCycleActive,
        speed: isCycleActive ? speed : 0,
        onTimeSec: onTime,
        offTimeSec: offTime,
        v1_enabled: isCycleActive,
        v1_onTimeSec: onTime,
        v1_offTimeSec: offTime,
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
      };
    }
    
    set(motorControlRef, dataToWrite).catch((error) => {
        console.error("Failed to write motor control data:", error);
        if (isControlEnabled) { // Only show toast if writes are expected
            toast({
              title: "Firebase Write Error",
              description: "Could not send motor control data to the database.",
              variant: "destructive",
            });
        }
    });

  }, [isControlEnabled, isCycleActive, speed, onTime, offTime, isClient, database, toast]);


  const handleSwitchChange = (checked: boolean) => {
    if (!isClient) return;
    setIsControlEnabled(checked);
    toast({
      title: checked ? "Realtime Control Enabled" : "Realtime Control Disabled",
      description: checked
        ? "Motor values are now being sent to the database."
        : "Motor control cycle stopped.",
    });
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
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>255</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="on-time">ON Time (sec)</Label>
                    <Input id="on-time" type="number" min="0" value={onTime} onChange={e => setOnTime(Number(e.target.value))} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="off-time">OFF Time (sec)</Label>
                    <Input id="off-time" type="number" min="0" value={offTime} onChange={e => setOffTime(Number(e.target.value))} />
                </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Solenoid Valves</CardTitle>
             <CardDescription>
              Valve 1 is synced with the motor cycle. Others are for demo.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <Button className={cn("font-bold", isControlEnabled && isCycleActive ? "bg-green-500 hover:bg-green-600" : "bg-destructive hover:bg-destructive/90")}>Valve 1</Button>
            <Button disabled>Valve 2</Button>
            <Button disabled>Valve 3</Button>
            <Button disabled>Valve 4</Button>
            <Button disabled>Valve 5</Button>
            <Button disabled>Valve 6</Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
