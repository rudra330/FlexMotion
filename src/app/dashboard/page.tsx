
"use client";

import { useState, useEffect, useRef } from "react";
import { ref, onValue } from "firebase/database";
import { SensorChart } from "@/components/sensor-chart";
import { HandModel } from "@/components/hand-model";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { SessionAnalysis } from "@/components/session-analysis";
import type { RecordedDataPoint, Session } from "@/lib/types";
import { useDatabase } from "@/firebase";

const SENSOR_COUNT = 6;
export const SENSOR_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky", "Wrist"];


export default function DashboardPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [sensorData, setSensorData] = useState<number[]>(Array(SENSOR_COUNT).fill(0));
  const [liveData, setLiveData] = useState<RecordedDataPoint[]>([]);
  const [currentRecording, setCurrentRecording] = useState<RecordedDataPoint[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isClient, setIsClient] = useState(false);
  const startTimeRef = useRef<number | null>(null);

  const { toast } = useToast();
  const database = useDatabase();

  useEffect(() => {
    if (!database) return;
    if (startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }

    const sensorDataRef = ref(database, 'sensorData');

    const unsubscribe = onValue(sensorDataRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const newSensorData = [
          data.finger1 || 0,
          data.finger2 || 0,
          data.finger3 || 0,
          data.finger4 || 0,
          data.finger5 || 0,
          data.wrist || 0,
        ];
        setSensorData(newSensorData);

        const now = Date.now();
        const elapsedTime = startTimeRef.current ? Math.round((now - startTimeRef.current) / 1000) : 0;
        
        const newPoint: RecordedDataPoint = { timestamp: elapsedTime };
        newSensorData.forEach((val, i) => {
            newPoint[`sensor${i}`] = val;
        });

        const newRawPoint: RecordedDataPoint = { timestamp: now };
         newSensorData.forEach((val, i) => {
            newRawPoint[`sensor${i}`] = val;
        });


        setLiveData(currentData => [...currentData.slice(-149), newPoint]);

        if (isRecording) {
            setCurrentRecording(currentData => [...currentData, newRawPoint]);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [database, isRecording]); 

  useEffect(() => {
    setIsClient(true);
    try {
      const savedSessions = localStorage.getItem("flexmotion-sessions");
      if (savedSessions) {
        setSessions(JSON.parse(savedSessions));
      }
    } catch (error) {
      console.error("Failed to load sessions from localStorage", error);
    }
  }, []);

  const updateSessions = (newSessions: Session[]) => {
    setSessions(newSessions);
    try {
      localStorage.setItem("flexmotion-sessions", JSON.stringify(newSessions));
    } catch (error) {
       toast({
        title: "Error Saving Session",
        description: "Could not save session to local storage. It might be full.",
        variant: "destructive",
      });
    }
  }


  const handleToggleRecording = () => {
    if (isRecording) {
      // Stopping recording
      if (currentRecording.length > 0) {
        const newSession: Session = {
          id: `session_${Date.now()}`,
          date: new Date().toISOString(),
          duration: (Date.now() - currentRecording[0].timestamp) / 1000,
          data: currentRecording,
        };
        updateSessions([...sessions, newSession]);
        toast({
          title: "Session Saved",
          description: "Your recording has been saved for analysis.",
        });
      } else {
        toast({
          title: "Recording Stopped",
          description: "No data was recorded in this session.",
        });
      }
       setCurrentRecording([]);
    } else {
      // Starting recording
      setCurrentRecording([]);
      toast({
        title: "Recording Started",
        description: "Recording live sensor data.",
      });
    }
    setIsRecording(!isRecording);
  };
  

  const handleDownloadCsv = (session: Session) => {
    if (!session) {
       toast({
        title: "No session data",
        description: "There is no data to export for this session.",
        variant: "destructive",
      });
      return;
    }

    const headers = ["timestamp", ...SENSOR_NAMES].join(",");
    const rows = session.data.map(d => {
      const sensorValues = SENSOR_NAMES.map((_, i) => (d[`sensor${i}`] ?? 0).toFixed(4));
      return [d.timestamp, ...sensorValues].join(",");
    });

    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `flexmotion_session_${session.id}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({
      title: "Download Started",
      description: `Your ${`flexmotion_session_${session.id}.csv`} file is downloading.`,
    });
  };

  const handleClearSessions = () => {
    updateSessions([]);
    toast({
      title: "All sessions cleared",
    });
  }

  const handleDeleteSession = (sessionId: string) => {
    const updatedSessions = sessions.filter(s => s.id !== sessionId);
    updateSessions(updatedSessions);
    toast({
      title: "Session deleted",
    });
  }

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {SENSOR_NAMES.map((name, index) => (
          <Card key={name}>
            <CardHeader>
              <CardTitle>{name} Sensor</CardTitle>
            </CardHeader>
            <CardContent>
              <SensorChart data={liveData} dataKey={`sensor${index}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2 mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Left Hand 3D Model</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden">
            <HandModel hand="left" sensorData={sensorData.map(v => v/100)} isRecording={isRecording} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Right Hand 3D Model</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden">
            <HandModel hand="right" sensorData={sensorData.map(v => v/100)} isRecording={isRecording} />
          </CardContent>
        </Card>
      </div>
      
      <div className="mt-6">
       {isClient && (
          <SessionAnalysis 
            sessions={sessions} 
            onClearSessions={handleClearSessions}
            onDeleteSession={handleDeleteSession}
            isRecording={isRecording}
            onToggleRecording={handleToggleRecording}
            onDownloadCsv={handleDownloadCsv}
          />
        )}
      </div>
    </main>
  );
}
