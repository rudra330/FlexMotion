
"use client";

import { useState, useEffect } from "react";
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

export default function MotorControlPage() {
  const [airPressure, setAirPressure] = useState(0);
  const [bldcRpm, setBldcRpm] = useState(0);
  const [bldcTorque, setBldcTorque] = useState(0);
  const [bldcSpeed, setBldcSpeed] = useState(0);
  const [isControlEnabled, setIsControlEnabled] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const database = useDatabase();
  const { toast } = useToast();

  useEffect(() => {
    // This ensures this code runs only on the client, preventing hydration errors.
    setIsClient(true);
  }, []);

  useEffect(() => {
    // This effect runs only on the client and when dependencies change.
    if (isClient && isControlEnabled && database) {
      const motorControlRef = ref(database, "motorControl");
      const motorData = {
        airPressure,
        bldcRpm,
        bldcTorque,
        bldcSpeed,
      };
      set(motorControlRef, motorData).catch((error) => {
        console.error("Failed to write motor control data:", error);
        toast({
          title: "Firebase Write Error",
          description:
            "Could not send motor control data to the database.",
          variant: "destructive",
        });
      });
    }
  }, [
    airPressure,
    bldcRpm,
    bldcTorque,
    bldcSpeed,
    isControlEnabled,
    database,
    toast,
    isClient,
  ]);

  const handleSwitchChange = (checked: boolean) => {
    if (!isClient) return;
    setIsControlEnabled(checked);
    if (checked) {
      toast({
        title: "Realtime Control Enabled",
        description: "Motor values are now being sent to the database.",
      });
    } else {
      toast({
        title: "Realtime Control Disabled",
        description: "Motor values are no longer being sent.",
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
                     </CardContent>
                 </Card>
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
              Enable or disable sending motor control data to the database in
              real-time.
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
        {/* Air Pump Motor Card */}
        <Card>
          <CardHeader>
            <CardTitle>Air Pump Motor</CardTitle>
            <CardDescription>
              Control the pressure of the air pump motor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="air-pressure">Pressure</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {airPressure} kPa
                </span>
              </div>
              <Slider
                id="air-pressure"
                min={-85}
                max={600}
                step={1}
                value={[airPressure]}
                onValueChange={(value) => setAirPressure(value[0])}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>-85 kPa (Vacuum)</span>
                <span>600 kPa (6 Barr)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* BLDC Motor Card */}
        <Card>
          <CardHeader>
            <CardTitle>BLDC Motor</CardTitle>
            <CardDescription>
              Control the RPM, torque, and speed of the BLDC motor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="bldc-rpm">RPM</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {bldcRpm} RPM
                </span>
              </div>
              <Slider
                id="bldc-rpm"
                min={0}
                max={300}
                step={1}
                value={[bldcRpm]}
                onValueChange={(value) => setBldcRpm(value[0])}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>300</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="bldc-torque">Torque</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {bldcTorque} %
                </span>
              </div>
              <Slider
                id="bldc-torque"
                min={0}
                max={100}
                step={1}
                value={[bldcTorque]}
                onValueChange={(value) => setBldcTorque(value[0])}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="bldc-speed">Speed</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {bldcSpeed} %
                </span>
              </div>
              <Slider
                id="bldc-speed"
                min={0}
                max={100}
                step={1}
                value={[bldcSpeed]}
                onValueChange={(value) => setBldcSpeed(value[0])}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}


    