"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/header";
import { SensorChart } from "@/components/sensor-chart";
import { HandModel } from "@/components/hand-model";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { SessionAnalysis } from "@/components/session-analysis";
import type { RecordedDataPoint, Session } from "@/lib/types";

const SENSOR_COUNT = 6;
export const SENSOR_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky", "Wrist"];


export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [sensorData, setSensorData] = useState<number[]>(Array(SENSOR_COUNT).fill(0));
  const [currentRecording, setCurrentRecording] = useState<RecordedDataPoint[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  
  const { toast } = useToast();

  useEffect(() => {
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

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        const newData: number[] = Array.from({ length: SENSOR_COUNT }, () => Math.random());
        setSensorData(newData);
        
        const newPoint: RecordedDataPoint = { timestamp: Date.now() };
        newData.forEach((val, i) => {
          newPoint[`sensor${i}`] = val;
        });
        
        setCurrentRecording(currentData => [...currentData, newPoint]);
      }, 200);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isRecording]);

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
        description: "Generating and recording dummy sensor data.",
      });
    }
  };

  const handleDownloadCsv = () => {
    if (currentRecording.length === 0) {
      toast({
        title: "No data to export",
        description: "Start recording to generate data first.",
        variant: "destructive",
      });
      return;
    }

    const headers = ["timestamp", ...SENSOR_NAMES].join(",");
    const rows = currentRecording.map(d => {
      const sensorValues = SENSOR_NAMES.map((_, i) => (d[`sensor${i}`] ?? 0).toFixed(4));
      return [d.timestamp, ...sensorValues].join(",");
    });

    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "flexmotion_data.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({
      title: "Download Started",
      description: "Your flexmotion_data.csv file is downloading.",
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

  const chartData = currentRecording.slice(-150);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header
        isRecording={isRecording}
        onToggleRecording={handleToggleRecording}
        onDownloadCsv={handleDownloadCsv}
      />
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {SENSOR_NAMES.map((name, index) => (
            <Card key={name}>
              <CardHeader>
                <CardTitle>{name} Sensor</CardTitle>
              </CardHeader>
              <CardContent>
                <SensorChart data={chartData} dataKey={`sensor${index}`} />
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
              <HandModel hand="left" sensorData={sensorData} isRecording={isRecording} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Right Hand 3D Model</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden">
              <HandModel hand="right" sensorData={sensorData} isRecording={isRecording} />
            </CardContent>
          </Card>
        </div>
        
        <div className="mt-6">
          <SessionAnalysis 
            sessions={sessions} 
            onClearSessions={handleClearSessions}
            onDeleteSession={handleDeleteSession}
          />
        </div>
      </main>
    </div>
  );
}
