"use client";

import { useState, useEffect } from "react";
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

  const { toast } = useToast();
  const database = useDatabase();

  useEffect(() => {
    if (!database) return;

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

        const newPoint: RecordedDataPoint = { timestamp: Date.now() };
        newSensorData.forEach((val, i) => {
            newPoint[`sensor${i}`] = val;
        });

        setLiveData(currentData => [...currentData.slice(-149), newPoint]);

        if (isRecording) {
            setCurrentRecording(currentData => [...currentData, newPoint]);
        }
      }
    });

    return () => {
      // Detach the listener when the component unmounts
      unsubscribe();
    };
  }, [database, isRecording]); // Rerun when isRecording or database changes

  useEffect(() => {
    setIsClient(true);
    // Load sessions from localStorage on initial render
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
    const wasRecording = isRecording;
    setIsRecording(!wasRecording);

    if (wasRecording) {
      // Stopping recording
      if (currentRecording.length > 0) {
        const newSession: Session = {
          id: `session_${Date.now()}`,
          date: new Date().toISOString(),
          duration: (currentRecording[currentRecording.length - 1].timestamp - currentRecording[0].timestamp) / 1000,
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
    } else {
      // Starting recording
      setCurrentRecording([]);
      toast({
        title: "Recording Started",
        description: "Recording live sensor data.",
      });
    }
  };

  const handleDownloadCsv = () => {
    if (sessions.length === 0) {
      toast({
        title: "No data to export",
        description: "Record a session to generate data first.",
        variant: "destructive",
      });
      return;
    }
    
    // a session must be selected to download
    const lastSession = sessions[sessions.length - 1];
    if (!lastSession) {
       toast({
        title: "No session selected",
        description: "Please select a session to download.",
        variant: "destructive",
      });
      return;
    }


    const headers = ["timestamp", ...SENSOR_NAMES].join(",");
    const rows = lastSession.data.map(d => {
      const sensorValues = SENSOR_NAMES.map((_, i) => (d[`sensor${i}`] ?? 0).toFixed(4));
      return [d.timestamp, ...sensorValues].join(",");
    });

    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `flexmotion_session_${lastSession.id}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({
      title: "Download Started",
      description: `Your ${`flexmotion_session_${lastSession.id}.csv`} file is downloading.`,
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

  const normalizedSensorData = sensorData.map(val => val / 100);

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
            <HandModel hand="left" sensorData={normalizedSensorData} isRecording={true} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Right Hand 3D Model</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden">
            <HandModel hand="right" sensorData={normalizedSensorData} isRecording={true} />
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
