
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils
} from '@mediapipe/tasks-vision';
import { useDatabase, useFirebase } from '@/firebase';
import { ref, set, serverTimestamp } from 'firebase/database';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Camera, CameraOff, Video, VideoOff, Expand, Shrink } from 'lucide-react';
import { calculateAngles, type HandAngles } from '@/lib/angle-calculator';

type ChartDataPoint = {
  timestamp: number;
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
  wrist: number;
};

let lastVideoTime = -1;
let handLandmarker: HandLandmarker | null = null;

export default function GestureControlPage() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSendingToDb, setIsSendingToDb] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [isLandmarkerReady, setIsLandmarkerReady] = useState(false);
  const [angles, setAngles] = useState<HandAngles | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  const { toast } = useToast();
  const database = useDatabase();
  const { isUserLoading } = useFirebase();

  // 1. Initialize HandLandmarker
  useEffect(() => {
    const createHandLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });
        setIsLandmarkerReady(true);
        toast({ title: "Hand Landmarker Ready", description: "You can now start the camera." });
      } catch (error) {
        console.error('Failed to create HandLandmarker:', error);
        toast({
          variant: 'destructive',
          title: 'Initialization Failed',
          description: 'Could not load the hand tracking model. Please refresh the page.',
        });
      }
    };
    createHandLandmarker();

    // Cleanup function
    return () => {
      if (handLandmarker) {
        handLandmarker.close();
        handLandmarker = null;
      }
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
       if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [toast]);

  const predictWebcam = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !handLandmarker || !isStreaming) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');

    if (!canvasCtx) return;
    
    if (video.videoWidth > 0 && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const results = handLandmarker.detectForVideo(video, Date.now());

      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      const drawingUtils = new DrawingUtils(canvasCtx);

      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: '#BF5FFF', lineWidth: 5 });
        drawingUtils.drawLandmarks(landmarks, { color: '#87CEEB', lineWidth: 2, radius: 4 });
        
        const calculatedAngles = calculateAngles(landmarks);
        setAngles(calculatedAngles);

        const newDataPoint: ChartDataPoint = {
          timestamp: Date.now(),
          thumb: calculatedAngles.fingers.thumb,
          index: calculatedAngles.fingers.index,
          middle: calculatedAngles.fingers.middle,
          ring: calculatedAngles.fingers.ring,
          pinky: calculatedAngles.fingers.pinky,
          wrist: calculatedAngles.wrist.flexion
        };
        setChartData(prev => [...prev.slice(-49), newDataPoint]);


        if (isSendingToDb && database && !isUserLoading) {
            const gestureRef = ref(database, 'handgesturedata');
            const dataToSend = {
                ...calculatedAngles,
                status: "active",
                timestamp: serverTimestamp()
            };
            set(gestureRef, dataToSend).catch(e => {
                console.error("Firebase write failed. Full error object:", e);
                toast({
                    title: "Firebase Write Error",
                    description: `Could not send gesture data. Reason: ${e.message}`,
                    variant: "destructive",
                });
            });
        }

      } else {
        setAngles(null);
      }
      canvasCtx.restore();
    }

    if (isStreaming) {
      animationFrameId.current = requestAnimationFrame(predictWebcam);
    }
  }, [isStreaming, database, isSendingToDb, isUserLoading, toast]);

  // 2. Handle Camera
  const toggleCamera = () => {
    if (isStreaming) {
      stopCamera();
    } else {
      startCamera();
    }
  };
  
  const startCamera = async () => {
    if (!handLandmarker) {
      toast({ title: 'Please wait', description: 'Hand Landmarker is still loading.' });
      return;
    }
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.addEventListener('loadeddata', () => {
             setIsStreaming(true);
          });
        }
        setHasCameraPermission(true);
      } catch (error) {
        console.error('Error accessing camera:', error);
        setHasCameraPermission(false);
        toast({
          variant: 'destructive',
          title: 'Camera Access Denied',
          description: 'Please enable camera permissions in your browser settings.',
        });
      }
    }
  };

  const stopCamera = () => {
    setIsStreaming(false);
    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setAngles(null);
    setChartData([]);
  };

   // Effect to start/stop prediction loop based on isStreaming state
  useEffect(() => {
    if (isStreaming && handLandmarker) {
      predictWebcam();
    } else {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    }
    // Cleanup on unmount or when isStreaming changes
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isStreaming, isLandmarkerReady, predictWebcam]);

  
  const handleFullScreen = () => setIsFullScreen(!isFullScreen);

  const fingerNames = ["thumb", "index", "middle", "ring", "pinky"] as const;

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
      <Card className={isFullScreen ? 'hidden' : ''}>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Hand Gesture Control</CardTitle>
            <CardDescription>Use your camera to control devices with hand gestures.</CardDescription>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center space-x-2">
              <Switch
                id="db-streaming"
                checked={isSendingToDb}
                onCheckedChange={setIsSendingToDb}
                disabled={!isStreaming || isUserLoading}
              />
              <Label htmlFor="db-streaming">Send to Firebase</Label>
            </div>
            <Button onClick={toggleCamera} variant={isStreaming ? "destructive" : "default"} disabled={!isLandmarkerReady}>
              {isStreaming ? <CameraOff className="mr-2 h-4 w-4" /> : <Camera className="mr-2 h-4 w-4" />}
              {isStreaming ? "Stop Camera" : "Start Camera"}
            </Button>
             <Button onClick={handleFullScreen} variant="outline" size="icon">
                <Expand/>
            </Button>
          </div>
        </CardHeader>
      </Card>
      
      {hasCameraPermission === false && !isFullScreen && (
        <Alert variant="destructive">
          <VideoOff className="h-4 w-4" />
          <AlertTitle>Camera Access Denied</AlertTitle>
          <AlertDescription>
            This feature requires camera access. Please grant permission in your browser settings and refresh the page.
          </AlertDescription>
        </Alert>
      )}

      <div className={`grid gap-6 ${isFullScreen ? 'grid-cols-1' : 'lg:grid-cols-3'}`}>
          <div className={`${isFullScreen ? 'fixed inset-0 z-50 bg-background' : 'lg:col-span-2 relative'}`}>
              <div className="relative w-full aspect-video overflow-hidden rounded-lg">
                <video ref={videoRef} className="w-full h-full object-cover transform -scale-x-100" autoPlay playsInline></video>
                <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full transform -scale-x-100"></canvas>
                 {!isStreaming && (
                    <div className="absolute inset-0 bg-secondary flex flex-col items-center justify-center">
                        <Video className="h-16 w-16 text-muted-foreground mb-4"/>
                        <p className="text-muted-foreground">{isLandmarkerReady ? 'Camera is off' : 'Loading hand model...'}</p>
                    </div>
                 )}
                 {isFullScreen && (
                    <div className="absolute top-4 right-4 z-[60] flex items-center gap-2">
                         <Button onClick={toggleCamera} variant={isStreaming ? "destructive" : "default"} disabled={!isLandmarkerReady}>
                            {isStreaming ? <CameraOff className="mr-2 h-4 w-4" /> : <Camera className="mr-2 h-4 w-4" />}
                            {isStreaming ? "Stop Camera" : "Start Camera"}
                        </Button>
                        <Button onClick={handleFullScreen} variant="outline" size="icon">
                            <Shrink/>
                        </Button>
                    </div>
                 )}
              </div>
          </div>

          <div className={`lg:col-span-1 grid-rows-2 gap-6 ${isFullScreen ? 'hidden' : 'grid'}`}>
              <Card>
                  <CardHeader>
                      <CardTitle>Real-time Angles</CardTitle>
                      <CardDescription>Current computed angles for each joint.</CardDescription>
                  </CardHeader>
                   <CardContent className="grid grid-cols-3 gap-4 text-center">
                      {fingerNames.map((key) => (
                        <div key={key} className="p-2 bg-muted rounded-lg">
                          <p className="text-sm capitalize text-muted-foreground">{key}</p>
                          <p className="text-2xl font-bold">{angles?.fingers[key]?.toFixed(0) ?? '-'}°</p>
                        </div>
                      ))}
                       <div className="p-2 bg-muted rounded-lg">
                          <p className="text-sm capitalize text-muted-foreground">Wrist</p>
                          <p className="text-2xl font-bold">{angles?.wrist.flexion.toFixed(0) ?? '-'}°</p>
                        </div>
                  </CardContent>
              </Card>
              <Card>
                  <CardHeader>
                      <CardTitle>Angle Trends</CardTitle>
                       <CardDescription>Live chart of angle changes over time.</CardDescription>
                  </CardHeader>
                   <CardContent className="h-[250px] p-0">
                      <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="timestamp" hide/>
                              <YAxis domain={[0, 180]}/>
                              <Tooltip 
                                contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                                formatter={(value: number) => `${value.toFixed(1)}°`}
                              />
                              <Legend />
                              <Line type="monotone" dataKey="thumb" name="Thumb" stroke="hsl(var(--chart-1))" dot={false} />
                              <Line type="monotone" dataKey="index" name="Index" stroke="hsl(var(--chart-2))" dot={false} />
                              <Line type="monotone" dataKey="middle" name="Middle" stroke="hsl(var(--chart-3))" dot={false} />
                              <Line type="monotone" dataKey="ring" name="Ring" stroke="hsl(var(--chart-4))" dot={false} />
                              <Line type="monotone" dataKey="pinky" name="Pinky" stroke="hsl(var(--chart-5))" dot={false} />
                              <Line type="monotone" dataKey="wrist" name="Wrist" stroke="hsl(var(--accent))" dot={false} />
                          </LineChart>
                      </ResponsiveContainer>
                  </CardContent>
              </Card>
          </div>
      </div>
    </main>
  );
}
