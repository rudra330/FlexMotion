"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useDatabase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import {
  registerDoctor,
  registerPatient,
  loginUserByEmailAndRole,
  getDoctorsList,
  DoctorProfile
} from "@/firebase/teleRehab";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HandMetal, Stethoscope, User, Mail, MapPin, Loader2, ArrowRight, Lock, Eye, EyeOff } from "lucide-react";

async function requestInitialMediaPermission(
  role: "doctor" | "patient",
  userId: string,
  toast: ReturnType<typeof useToast>["toast"]
) {
  if (typeof window === "undefined") return;
  const permissionKey = `flex_media_ready_${role}_${userId}`;
  if (localStorage.getItem(permissionKey) === "true") return;

  if (!navigator.mediaDevices?.getUserMedia) {
    toast({
      title: "Camera setup skipped",
      description: "This browser does not expose camera and microphone permission APIs.",
      variant: "destructive",
    });
    return;
  }

  toast({
    title: "Camera and microphone setup",
    description: "Please allow access once. FlexMotion will use camera and audio only during video calls; Mirror Therapy uses the patient camera.",
  });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    stream.getTracks().forEach((track) => track.stop());
    localStorage.setItem(permissionKey, "true");
    toast({
      title: "Media access ready",
      description: "Camera and microphone permission is saved for this browser.",
    });
  } catch (error) {
    const err = error as Error;
    localStorage.setItem(permissionKey, "failed");
    toast({
      title: "Media permission not granted",
      description: `${err.name || "PermissionError"}: ${err.message || "Please allow camera and microphone before video calls."}`,
      variant: "destructive",
    });
  }
}

export default function LoginPage() {
  const router = useRouter();
  const database = useDatabase();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [role, setRole] = useState<"doctor" | "patient">("doctor");
  const [isLoading, setIsLoading] = useState(false);

  // Form Fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Doctor list for patient registration
  const [doctors, setDoctors] = useState<Record<string, DoctorProfile>>({});
  const [loadingDoctors, setLoadingDoctors] = useState(false);

  // Load saved credentials on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem("flex_saved_email");
    const savedPassword = localStorage.getItem("flex_saved_password");
    const savedRole = localStorage.getItem("flex_saved_role");
    const savedRemember = localStorage.getItem("flex_remember_me");
    if (savedRemember === "true" && savedEmail && savedPassword) {
      setEmail(savedEmail);
      setPassword(savedPassword);
      setRememberMe(true);
      if (savedRole === "doctor" || savedRole === "patient") {
        setRole(savedRole);
      }
    }
  }, []);

  // Load doctors if registering as a patient
  useEffect(() => {
    if (activeTab === "register" && role === "patient" && database) {
      setLoadingDoctors(true);
      getDoctorsList(database)
        .then((docList) => {
          setDoctors(docList);
          const keys = Object.keys(docList);
          if (keys.length > 0) {
            setSelectedDoctorId(keys[0]);
          }
        })
        .catch((err) => {
          console.error("Failed to load doctor list:", err);
          toast({
            title: "Failed to load doctors",
            description: "Could not retrieve the doctor list. Please try again.",
            variant: "destructive",
          });
        })
        .finally(() => {
          setLoadingDoctors(false);
        });
    }
  }, [activeTab, role, database, toast]);

  // Check existing session
  useEffect(() => {
    const storedRole = typeof window !== "undefined" ? localStorage.getItem("flex_role") : null;
    const storedUid = typeof window !== "undefined" ? localStorage.getItem("flex_uid") : null;
    if (storedRole && storedUid) {
      router.replace("/dashboard");
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        title: "Validation Error",
        description: "Please enter your email and password.",
        variant: "destructive",
      });
      return;
    }

    if (!database) {
      toast({
        title: "Database Error",
        description: "Firebase database is not connected yet.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await loginUserByEmailAndRole(database, email, role, password);
      if (result) {
        localStorage.setItem("flex_role", role);
        localStorage.setItem("flex_uid", result.id);
        localStorage.setItem("flex_email", result.profile.email);
        localStorage.setItem("flex_name", result.profile.name);

        // Save credentials if Remember Me is checked
        if (rememberMe) {
          localStorage.setItem("flex_saved_email", email);
          localStorage.setItem("flex_saved_password", password);
          localStorage.setItem("flex_saved_role", role);
          localStorage.setItem("flex_remember_me", "true");
        } else {
          localStorage.removeItem("flex_saved_email");
          localStorage.removeItem("flex_saved_password");
          localStorage.removeItem("flex_saved_role");
          localStorage.removeItem("flex_remember_me");
        }

        toast({
          title: "Login Successful",
          description: `Welcome back, ${result.profile.name}!`,
        });

        await requestInitialMediaPermission(role, result.id, toast);
        
        router.replace("/dashboard");
      } else {
        toast({
          title: "User Not Found",
          description: `No registered ${role} found with this email. Please sign up first.`,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Login Error",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !address || !password) {
      toast({
        title: "Validation Error",
        description: "Please fill in all fields including password.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Weak Password",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
      return;
    }

    if (!database) {
      toast({
        title: "Database Error",
        description: "Firebase database is not connected yet.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      let userId = "";
      if (role === "doctor") {
        userId = await registerDoctor(database, { name, email, address, password });
        localStorage.setItem("flex_role", "doctor");
        localStorage.setItem("flex_uid", userId);
        localStorage.setItem("flex_email", email);
        localStorage.setItem("flex_name", name);
      } else {
        const docName = selectedDoctorId ? doctors[selectedDoctorId]?.name || "Assigned Doctor" : "";
        userId = await registerPatient(database, {
          name,
          email,
          address,
          password,
          assignedDoctorId: selectedDoctorId,
          assignedDoctorName: docName,
        });
        localStorage.setItem("flex_role", "patient");
        localStorage.setItem("flex_uid", userId);
        localStorage.setItem("flex_email", email);
        localStorage.setItem("flex_name", name);
      }

      toast({
        title: "Registration Successful",
        description: `Your account has been registered as a ${role}.`,
      });

      await requestInitialMediaPermission(role, userId, toast);

      router.replace("/dashboard");
    } catch (err: any) {
      toast({
        title: "Registration Failed",
        description: err.message || "Could not register your profile.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100 overflow-hidden sm:px-6 lg:px-8">
      {/* Background visual accents */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px]" />

      <div className="w-full max-w-md space-y-8 relative z-10 mx-auto">
        <div className="flex flex-col items-center justify-center text-center space-y-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/30">
            <HandMetal className="h-8 w-8 text-white animate-pulse" />
          </div>
          <div className="space-y-1">
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              FlexMotion
            </h2>
            <p className="text-sm font-medium text-slate-400">
              Interactive Tele-Rehabilitation &amp; Hand Tracking
            </p>
          </div>
        </div>

        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-xl shadow-2xl">
          <CardHeader className="space-y-1 pb-6 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight text-white">
              Welcome
            </CardTitle>
            <CardDescription className="text-slate-400">
              Access the clinical portal or register a new profile
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={activeTab}
              onValueChange={(val) => setActiveTab(val as "login" | "register")}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 bg-slate-950 p-1 mb-6 border border-slate-800">
                <TabsTrigger
                  value="login"
                  className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white text-slate-400"
                >
                  Log In
                </TabsTrigger>
                <TabsTrigger
                  value="register"
                  className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white text-slate-400"
                >
                  Register
                </TabsTrigger>
              </TabsList>

              {/* Selector for Doctor vs Patient */}
              <div className="mb-6">
                <Label className="text-slate-400 text-xs uppercase font-semibold tracking-wider block mb-2">
                  Select User Role
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant={role === "doctor" ? "default" : "outline"}
                    onClick={() => setRole("doctor")}
                    className={`flex items-center justify-center gap-2 border-slate-800 h-11 ${
                      role === "doctor"
                        ? "bg-indigo-600 text-white hover:bg-indigo-700"
                        : "bg-slate-950 text-slate-400 hover:text-white"
                    }`}
                  >
                    <Stethoscope className="h-4 w-4" />
                    <span>Doctor</span>
                  </Button>
                  <Button
                    type="button"
                    variant={role === "patient" ? "default" : "outline"}
                    onClick={() => setRole("patient")}
                    className={`flex items-center justify-center gap-2 border-slate-800 h-11 ${
                      role === "patient"
                        ? "bg-indigo-600 text-white hover:bg-indigo-700"
                        : "bg-slate-950 text-slate-400 hover:text-white"
                    }`}
                  >
                    <User className="h-4 w-4" />
                    <span>Patient</span>
                  </Button>
                </div>
              </div>

              {/* Login View */}
              <TabsContent value="login" className="space-y-4">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email" className="text-slate-300">
                      Email Address
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-500" />
                      <Input
                        id="login-email"
                        placeholder="doctor@flexmotion.com"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-11 bg-slate-950 border-slate-800 text-white focus:border-indigo-500 focus:ring-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="text-slate-300">
                      Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-500" />
                      <Input
                        id="login-password"
                        placeholder="Enter your password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-11 pr-11 bg-slate-950 border-slate-800 text-white focus:border-indigo-500 focus:ring-indigo-500"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-3 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Remember Me */}
                  <div className="flex items-center gap-2">
                    <input
                      id="remember-me"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                    />
                    <Label htmlFor="remember-me" className="text-sm text-slate-400 cursor-pointer">
                      Remember my credentials
                    </Label>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-11 font-semibold transition-all mt-4"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Logging you in...
                      </>
                    ) : (
                      <>
                        Continue to Dashboard
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Register View */}
              <TabsContent value="register" className="space-y-4">
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name" className="text-slate-300">
                      Full Name
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-500" />
                      <Input
                        id="reg-name"
                        placeholder="Dr. Sarah Connor"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="pl-11 bg-slate-950 border-slate-800 text-white focus:border-indigo-500 focus:ring-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-email" className="text-slate-300">
                      Email Address
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-500" />
                      <Input
                        id="reg-email"
                        placeholder="sarah.connor@clinic.com"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-11 bg-slate-950 border-slate-800 text-white focus:border-indigo-500 focus:ring-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-password" className="text-slate-300">
                      Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-500" />
                      <Input
                        id="reg-password"
                        placeholder="Min 6 characters"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-11 pr-11 bg-slate-950 border-slate-800 text-white focus:border-indigo-500 focus:ring-indigo-500"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-3 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-address" className="text-slate-300">
                      Clinic/Home Address
                    </Label>
                    <div className="relative">
                      <MapPin className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-500" />
                      <Input
                        id="reg-address"
                        placeholder="Rehab Block B, General Hospital"
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="pl-11 bg-slate-950 border-slate-800 text-white focus:border-indigo-500 focus:ring-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  {role === "patient" && (
                    <div className="space-y-2">
                      <Label htmlFor="reg-doctor" className="text-slate-300">
                        Assigned Supervising Doctor
                      </Label>
                      {loadingDoctors ? (
                        <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                          Loading clinical roster...
                        </div>
                      ) : Object.keys(doctors).length === 0 ? (
                        <div className="text-amber-500 text-xs py-1">
                          No registered doctors found. Doctors must sign up first.
                        </div>
                      ) : (
                        <select
                          id="reg-doctor"
                          value={selectedDoctorId}
                          onChange={(e) => setSelectedDoctorId(e.target.value)}
                          className="w-full h-11 px-3 rounded bg-slate-950 border border-slate-800 text-white focus:border-indigo-500 focus:ring-indigo-500"
                        >
                          {Object.entries(doctors).map(([id, doc]) => (
                            <option key={id} value={id}>
                              {doc.name} ({doc.email})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-11 font-semibold transition-all mt-4"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating Profile...
                      </>
                    ) : (
                      <>
                        Complete Registration
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
