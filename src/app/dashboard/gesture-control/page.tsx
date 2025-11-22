"use client";

import { useState, useEffect, useRef } from 'react';
import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils
} from '@mediapipe/tasks-vision';
import { useDatabase } from '@/firebase';
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

type GestureData = HandAngles & { timestamp: number };

let lastVideoTime = -1;
let handLandmarker: HandLandmarker | null = null;
let animationFrameId: number;

export default function GestureControlPage() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSendingToDb, setIsSendingToDb] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [isLandmarkerReady, setIsLandmarkerReady] = useState(false);
  const [angles, setAngles] = useState<HandAngles | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [chartData, setChartData] = useState<GestureData[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();
  const database = useDatabase();

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

    return () => {
      if (handLandmarker) {
        handLandmarker.close();
        handLandmarker = null;
      }
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [toast]);

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
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.addEventListener('loadeddata', predictWebcam);
        }
        setHasCameraPermission(true);
        setIsStreaming(true);
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
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      videoRef.current.removeEventListener('loadeddata', predictWebcam);
    }
    setIsStreaming(false);
    if(animationFrameId) cancelAnimationFrame(animationFrameId);
    setAngles(null);
    setChartData([]);
  };

  // 3. Prediction Loop
  const predictWebcam = async () => {
    if (!videoRef.current || !canvasRef.current || !handLandmarker) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');

    if (!canvasCtx) return;

    if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }


    if (isStreaming && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const results = await handLandmarker.detectForVideo(video, Date.now());

      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      const drawingUtils = new DrawingUtils(canvasCtx);

      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        
        // Draw connections
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
          color: '#00FF00',
          lineWidth: 5
        });

        // Draw landmarks
        drawingUtils.drawLandmarks(landmarks, { color: '#FF0000', lineWidth: 2 });
        
        const calculatedAngles = calculateAngles(landmarks);
        setAngles(calculatedAngles);

        const newGestureData: GestureData = { ...calculatedAngles, timestamp: Math.floor(Date.now() / 1000) };
        setChartData(prev => [...prev.slice(-49), newGestureData]);

        if (isSendingToDb && database) {
          const gestureRef = ref(database, 'gestureData');
          set(gestureRef, { ...calculatedAngles, timestamp: serverTimestamp() }).catch(e => console.error("Firebase write failed:", e));
        }

      } else {
        setAngles(null);
      }
      canvasCtx.restore();
    }

    if (isStreaming) {
      animationFrameId = requestAnimationFrame(predictWebcam);
    }
  };
  
  const handleFullScreen = () => setIsFullScreen(!isFullScreen);

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
      <Card>
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
                disabled={!isStreaming}
              />
              <Label htmlFor="db-streaming">Send to Firebase</Label>
            </div>
            <Button onClick={toggleCamera} variant={isStreaming ? "destructive" : "default"}>
              {isStreaming ? <CameraOff className="mr-2 h-4 w-4" /> : <Camera className="mr-2 h-4 w-4" />}
              {isStreaming ? "Stop Camera" : "Start Camera"}
            </Button>
             <Button onClick={handleFullScreen} variant="outline" size="icon">
                {isFullScreen ? <Shrink/> : <Expand/>}
            </Button>
          </div>
        </CardHeader>
      </Card>
      
      {hasCameraPermission === false && (
        <Alert variant="destructive">
          <VideoOff className="h-4 w-4" />
          <AlertTitle>Camera Access Denied</AlertTitle>
          <AlertDescription>
            This feature requires camera access. Please grant permission in your browser settings and refresh the page.
          </AlertDescription>
        </Alert>
      )}

      <div className={`grid gap-6 ${isFullScreen ? 'grid-cols-1' : 'lg:grid-cols-3'}`}>
          <div className={`${isFullScreen ? 'col-span-1' : 'lg:col-span-2'}`}>
              <Card className="relative aspect-video overflow-hidden">
                <video ref={videoRef} className="w-full h-full object-cover transform -scale-x-100" autoPlay playsInline></video>
                <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full"></canvas>
                 {!isStreaming && (
                    <div className="absolute inset-0 bg-secondary flex flex-col items-center justify-center">
                        <Video className="h-16 w-16 text-muted-foreground mb-4"/>
                        <p className="text-muted-foreground">Camera is off</p>
                    </div>
                 )}
              </Card>
          </div>

          {!isFullScreen && (
              <div className="lg:col-span-1 flex flex-col gap-6">
                  <Card>
                      <CardHeader>
                          <CardTitle>Real-time Angles</CardTitle>
                      </CardHeader>
                       <CardContent className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-2 gap-4 text-center">
                          {angles ? (
                              Object.entries(angles.fingers).map(([key, value]) => (
                                <div key={key}>
                                  <p className="text-sm capitalize text-muted-foreground">{key}</p>
                                  <p className="text-2xl font-bold">{value.toFixed(0)}°</p>
                                </div>
                              ))
                          ) : (
                             Array.from({ length: 5 }).map((_, i) => (
                                <div key={i}>
                                    <p className="text-sm capitalize text-muted-foreground">...</p>
                                    <p className="text-2xl font-bold">-°</p>
                                </div>
                            ))
                          )}
                           <div>
                              <p className="text-sm capitalize text-muted-foreground">Wrist</p>
                              <p className="text-2xl font-bold">{angles?.wrist.flexion.toFixed(0) ?? '-'}°</p>
                            </div>
                      </CardContent>
                  </Card>
                  <Card>
                      <CardHeader>
                          <CardTitle>Angle Trends</CardTitle>
                      </CardHeader>
                       <CardContent className="h-[250px] p-0">
                          <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="timestamp" hide />
                                  <YAxis domain={[0, 180]}/>
                                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}/>
                                  <Legend />
                                  <Line type="monotone" dataKey="fingers.thumb" name="Thumb" stroke="#8884d8" dot={false} />
                                  <Line type="monotone" dataKey="fingers.index" name="Index" stroke="#82ca9d" dot={false} />
                                  <Line type="monotone" dataKey="fingers.middle" name="Middle" stroke="#ffc658" dot={false} />
                                  <Line type="monotone" dataKey="fingers.ring" name="Ring" stroke="#ff7300" dot={false} />
                                  <Line type="monotone" dataKey="fingers.pinky" name="Pinky" stroke="#0088fe" dot={false} />
                                  <Line type="monotone" dataKey="wrist.flexion" name="Wrist" stroke="#00C49F" dot={false} />
                              </LineChart>
                          </ResponsiveContainer>
                      </CardContent>
                  </Card>
              </div>
          )}
      </div>
    </main>
  );
}
