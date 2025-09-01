"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/header";
import { SensorChart } from "@/components/sensor-chart";
import { HandModel } from "@/components/hand-model";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const SENSOR_COUNT = 6;
const SENSOR_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky", "Wrist"];

type SensorData = number[];
type RecordedDataPoint = {
  timestamp: number;
  [key: string]: number;
};

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [sensorData, setSensorData] = useState<SensorData>(Array(SENSOR_COUNT).fill(0));
  const [recordedData, setRecordedData] = useState<RecordedDataPoint[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        const newData: SensorData = Array.from({ length: SENSOR_COUNT }, () => Math.random());
        setSensorData(newData);
        
        const newPoint: RecordedDataPoint = { timestamp: Date.now() };
        newData.forEach((val, i) => {
          newPoint[`sensor${i}`] = val;
        });
        
        setRecordedData(currentRecordedData => [...currentRecordedData, newPoint]);
      }, 200);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isRecording]);

  const handleToggleRecording = () => {
    setIsRecording(!isRecording);
    if (!isRecording) {
      setRecordedData([]);
      toast({
        title: "Recording Started",
        description: "Generating and recording dummy sensor data.",
      });
    } else {
      toast({
        title: "Recording Stopped",
        description: "You can now download the collected data.",
      });
    }
  };

  const handleDownloadCsv = () => {
    if (recordedData.length === 0) {
      toast({
        title: "No data to export",
        description: "Start recording to generate data first.",
        variant: "destructive",
      });
      return;
    }

    const headers = ["timestamp", ...SENSOR_NAMES].join(",");
    const rows = recordedData.map(d => {
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

  const chartData = recordedData.slice(-150);

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
      </main>
    </div>
  );
}
