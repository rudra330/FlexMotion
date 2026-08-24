"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Database, onValue, ref } from "firebase/database";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  assignDoctorToPatient,
  getDoctorsList,
  listenToTherapySessions,
  TherapySessionRecord,
  deleteTherapySession,
  DoctorProfile,
  PatientMedicalAttachment,
  PatientProfile,
  savePatientMedicalDetails,
} from "@/firebase/teleRehab";
import {
  CheckCircle2,
  Download,
  FileText,
  Info,
  Loader2,
  Save,
  Trash2,
  Upload,
  UserRound,
  Wifi,
  X,
  XCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";

const MAX_MEDICAL_FILE_BYTES = 5 * 1024 * 1024;
const MAX_MEDICAL_FILES_TOTAL_BYTES = 12 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function isSupportedMedicalFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed" ||
    fileName.endsWith(".pdf") ||
    fileName.endsWith(".zip")
  );
}

interface PatientWorkspaceProps {
  database: Database;
  patientId: string;
  patientName: string;
  assignedDoctorId: string;
  assignedDoctorName: string;
}

export function PatientWorkspace({
  database,
  patientId,
  patientName,
  assignedDoctorId,
  assignedDoctorName
}: PatientWorkspaceProps) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<TherapySessionRecord[]>([]);
  const [deviceStatus, setDeviceStatus] = useState<any>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [doctors, setDoctors] = useState<Record<string, DoctorProfile>>({});
  const [currentDoctorId, setCurrentDoctorId] = useState(assignedDoctorId);
  const [currentDoctorName, setCurrentDoctorName] = useState(assignedDoctorName);
  const [assigningDoctorId, setAssigningDoctorId] = useState<string | null>(null);
  const [medicalForm, setMedicalForm] = useState({
    name: patientName,
    age: "",
    diseaseType: "",
    previousHistory: "",
  });
  const [medicalAttachments, setMedicalAttachments] = useState<Record<string, PatientMedicalAttachment>>({});
  const [isReadingFiles, setIsReadingFiles] = useState(false);
  const [isSavingMedicalDetails, setIsSavingMedicalDetails] = useState(false);
  const medicalFormDirtyRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setCurrentDoctorId(assignedDoctorId);
    setCurrentDoctorName(assignedDoctorName);
  }, [assignedDoctorId, assignedDoctorName]);

  useEffect(() => {
    if (!database || !patientId) return;
    return onValue(ref(database, `users/patients/${patientId}/profile`), (snapshot) => {
      if (!snapshot.exists() || medicalFormDirtyRef.current) return;
      const profile = snapshot.val() as PatientProfile;
      setMedicalForm({
        name: profile.name || "",
        age: profile.medicalDetails?.age?.toString() || "",
        diseaseType: profile.medicalDetails?.diseaseType || "",
        previousHistory: profile.medicalDetails?.previousHistory || "",
      });
      setMedicalAttachments(profile.medicalDetails?.attachments || {});
    });
  }, [database, patientId]);

  useEffect(() => {
    if (!database) return;
    const loadDoctors = async () => {
      try {
        setDoctors(await getDoctorsList(database));
      } catch (err) {
        console.error("Failed to load registered doctors:", err);
      }
    };
    loadDoctors();

    const doctorsRef = ref(database, "users/doctors");
    const unsubscribe = onValue(doctorsRef, (snapshot) => {
      if (!snapshot.exists()) {
        setDoctors({});
        return;
      }
      const raw = snapshot.val() as Record<string, { profile?: DoctorProfile } | DoctorProfile>;
      const normalized = Object.fromEntries(
        Object.entries(raw)
          .map(([id, node]) => [id, "profile" in node ? node.profile : node])
          .filter((entry): entry is [string, DoctorProfile] => !!entry[1])
      );
      setDoctors(normalized);
    });

    return () => unsubscribe();
  }, [database]);

  // Fetch only this patient's therapy sessions
  useEffect(() => {
    if (!database || !patientId || !currentDoctorId) {
      setSessions([]);
      return;
    }
    const unsubscribe = listenToTherapySessions(currentDoctorId, patientId, (fetchedSessions) => {
      setSessions(fetchedSessions);
    }, database);

    return () => unsubscribe();
  }, [database, patientId, currentDoctorId]);

  // Listen to ESP32 device status from devices/${patientId}
  useEffect(() => {
    if (!database || !patientId) return;
    
    const deviceRef = ref(database, `devices/${patientId}`);
    const unsubscribe = onValue(deviceRef, (snapshot) => {
      if (snapshot.exists()) {
        setDeviceStatus(snapshot.val());
      } else {
        setDeviceStatus(null);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [database, patientId]);

  const handleDelete = async (sessionId: string) => {
    if (!database || !currentDoctorId || !patientId) return;
    if (confirm("Are you sure you want to delete this report? This action cannot be undone.")) {
      try {
        await deleteTherapySession(currentDoctorId, patientId, sessionId, database);
        toast({ title: "Report Deleted", description: "The therapy report has been removed." });
      } catch (e: any) {
        toast({ variant: "destructive", title: "Error", description: e.message });
      }
    }
  };

  const handleChooseDoctor = async (doctorId: string) => {
    if (!database || !patientId) return;
    setAssigningDoctorId(doctorId);
    try {
      await assignDoctorToPatient(database, patientId, doctorId);
      setCurrentDoctorId(doctorId);
      setCurrentDoctorName(doctors[doctorId]?.name || "Assigned Doctor");
      toast({
        title: "Therapist Selected",
        description: `${doctors[doctorId]?.name || "This doctor"} can now start video calls with you.`,
      });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Therapist Selection Failed",
        description: e.message || "Could not assign this doctor.",
      });
    } finally {
      setAssigningDoctorId(null);
    }
  };

  const updateMedicalField = (field: keyof typeof medicalForm, value: string) => {
    medicalFormDirtyRef.current = true;
    setMedicalForm((current) => ({ ...current, [field]: value }));
  };

  const handleMedicalFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (selectedFiles.length === 0) return;

    const unsupported = selectedFiles.find((file) => !isSupportedMedicalFile(file));
    if (unsupported) {
      toast({
        variant: "destructive",
        title: "Unsupported file",
        description: `${unsupported.name} is not a PDF, image, or ZIP file.`,
      });
      return;
    }

    const oversized = selectedFiles.find((file) => file.size > MAX_MEDICAL_FILE_BYTES);
    if (oversized) {
      toast({
        variant: "destructive",
        title: "File is too large",
        description: `${oversized.name} exceeds the 5 MB per-file limit.`,
      });
      return;
    }

    const existingBytes = Object.values(medicalAttachments).reduce((total, file) => total + file.size, 0);
    const selectedBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
    if (existingBytes + selectedBytes > MAX_MEDICAL_FILES_TOTAL_BYTES) {
      toast({
        variant: "destructive",
        title: "Attachment limit reached",
        description: "Medical attachments can use up to 12 MB in total.",
      });
      return;
    }

    setIsReadingFiles(true);
    try {
      const uploadedAt = new Date().toISOString();
      const additions = await Promise.all(
        selectedFiles.map(async (file, index): Promise<PatientMedicalAttachment> => {
          const id = `${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
          return {
            id,
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            dataUrl: await readFileAsDataUrl(file),
            uploadedAt,
          };
        })
      );
      medicalFormDirtyRef.current = true;
      setMedicalAttachments((current) => ({
        ...current,
        ...Object.fromEntries(additions.map((attachment) => [attachment.id, attachment])),
      }));
    } catch (error) {
      toast({
        variant: "destructive",
        title: "File read failed",
        description: error instanceof Error ? error.message : "The selected file could not be read.",
      });
    } finally {
      setIsReadingFiles(false);
    }
  };

  const removeMedicalAttachment = (attachmentId: string) => {
    medicalFormDirtyRef.current = true;
    setMedicalAttachments((current) => {
      const next = { ...current };
      delete next[attachmentId];
      return next;
    });
  };

  const handleSaveMedicalDetails = async () => {
    const parsedAge = medicalForm.age.trim() ? Number(medicalForm.age) : null;
    if (parsedAge !== null && (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 130)) {
      toast({
        variant: "destructive",
        title: "Invalid age",
        description: "Enter a whole-number age between 0 and 130.",
      });
      return;
    }

    setIsSavingMedicalDetails(true);
    try {
      await savePatientMedicalDetails(database, patientId, {
        name: medicalForm.name,
        age: parsedAge,
        diseaseType: medicalForm.diseaseType,
        previousHistory: medicalForm.previousHistory,
        attachments: medicalAttachments,
      });
      localStorage.setItem("flex_name", medicalForm.name.trim());
      medicalFormDirtyRef.current = false;
      toast({
        title: "Patient information saved",
        description: "Your assigned doctor can now view these details in Therapy.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save patient information",
        description: error instanceof Error ? error.message : "The profile update failed.",
      });
    } finally {
      setIsSavingMedicalDetails(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Patient medical profile */}
      <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
            <UserRound className="h-5 w-5 text-emerald-400" />
            Patient Information
          </CardTitle>
          <CardDescription className="text-slate-400">
            Keep your clinical details and previous records available to your selected doctor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-2 text-xs font-semibold text-slate-300">
              Name
              <Input
                value={medicalForm.name}
                onChange={(event) => updateMedicalField("name", event.target.value)}
                className="border-slate-700 bg-slate-950 text-white"
              />
            </label>
            <label className="space-y-2 text-xs font-semibold text-slate-300">
              Age
              <Input
                type="number"
                min={0}
                max={130}
                inputMode="numeric"
                value={medicalForm.age}
                onChange={(event) => updateMedicalField("age", event.target.value)}
                className="border-slate-700 bg-slate-950 text-white"
              />
            </label>
            <label className="space-y-2 text-xs font-semibold text-slate-300">
              Disease Type
              <Input
                value={medicalForm.diseaseType}
                onChange={(event) => updateMedicalField("diseaseType", event.target.value)}
                className="border-slate-700 bg-slate-950 text-white"
              />
            </label>
          </div>

          <label className="block space-y-2 text-xs font-semibold text-slate-300">
            Previous History
            <textarea
              rows={5}
              value={medicalForm.previousHistory}
              onChange={(event) => updateMedicalField("previousHistory", event.target.value)}
              className="w-full resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-normal text-white outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </label>

          <div className="space-y-3 rounded-md border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-semibold text-white">Previous Medical Records</p>
                <p className="text-xs text-slate-500">PDF, image, or ZIP. Maximum 5 MB each and 12 MB total.</p>
              </div>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-slate-800 px-4 text-xs font-semibold text-slate-100 hover:bg-slate-700">
                {isReadingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isReadingFiles ? "Reading files" : "Add files"}
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed"
                  className="sr-only"
                  disabled={isReadingFiles || isSavingMedicalDetails}
                  onChange={handleMedicalFiles}
                />
              </label>
            </div>

            {Object.values(medicalAttachments).length > 0 && (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {Object.values(medicalAttachments).map((attachment) => (
                  <div key={attachment.id} className="flex min-w-0 items-center gap-2 rounded-md border border-slate-800 bg-slate-950 p-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-indigo-400" />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{attachment.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => removeMedicalAttachment(attachment.id)}
                      className="rounded p-1 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs text-slate-500">
              Assigned Doctor: <span className="font-semibold text-slate-300">{currentDoctorName || "Pending selection"}</span>
            </p>
            <Button
              onClick={handleSaveMedicalDetails}
              disabled={isSavingMedicalDetails || isReadingFiles}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {isSavingMedicalDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Information
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-white">Available Registered Doctors</CardTitle>
          <CardDescription className="text-slate-400">
            Choose your therapist. Only the selected doctor can start a video call with you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(doctors).length === 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
              No doctors are registered yet. Register a doctor account first, then return here to choose your therapist.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(doctors).map(([doctorId, doctor]) => {
                const isSelected = currentDoctorId === doctorId;
                return (
                  <div
                    key={doctorId}
                    className={`rounded-xl border p-4 transition-colors ${
                      isSelected
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-slate-800 bg-slate-950/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-bold text-white truncate">{doctor.name}</h4>
                        <p className="text-xs text-slate-400 truncate">{doctor.email}</p>
                        <p className="text-xs text-slate-500 truncate">{doctor.address}</p>
                      </div>
                      {isSelected && (
                        <Badge className="bg-emerald-600 text-white shrink-0">Selected</Badge>
                      )}
                    </div>
                    <Button
                      className={`mt-4 w-full ${
                        isSelected
                          ? "bg-emerald-700 hover:bg-emerald-700"
                          : "bg-indigo-600 hover:bg-indigo-700"
                      }`}
                      disabled={isSelected || assigningDoctorId === doctorId}
                      onClick={() => handleChooseDoctor(doctorId)}
                    >
                      {assigningDoctorId === doctorId ? "Assigning..." : isSelected ? "Current Therapist" : "Choose Therapist"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connect Rehabilitation Glove Card */}
      <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
              <Wifi className="h-5 w-5 text-blue-400" />
              Connect Rehabilitation Glove
            </CardTitle>
            <CardDescription className="text-slate-400">
              Pair your ESP32-based hardware for tele-rehabilitation.
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowSetup(!showSetup)}
            className="border-slate-700 hover:bg-slate-800"
          >
            <Info className="h-4 w-4 mr-2" />
            {showSetup ? "Hide Instructions" : "Setup Instructions"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          
          {showSetup && (
            <div className="bg-slate-950/80 p-4 rounded-lg border border-slate-850 text-sm text-slate-300 space-y-2 mb-4">
              <p className="font-bold text-white mb-2">First-Time Wi-Fi Setup Instructions:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Turn on the rehabilitation glove.</li>
                <li>Open Wi-Fi settings on your phone/laptop.</li>
                <li>Connect to <strong>MotionMirror-Glove-{patientId}</strong>.</li>
                <li>Open the ESP32 setup page or captive portal.</li>
                <li>Select your home Wi-Fi or mobile hotspot.</li>
                <li>Enter the password and save.</li>
                <li>Wait until the ESP32 connects.</li>
                <li>Reconnect your phone/laptop to your normal Wi-Fi.</li>
                <li>Return to this app and check device status below.</li>
              </ol>
              <p className="mt-3 text-xs text-amber-400">
                Note: During actual therapy, both your device and the ESP32 must be connected to your normal Wi-Fi, not the setup hotspot.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ESP32-1 Actuator Controller */}
            <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-850 space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm font-bold text-white">ESP32-1 Actuator Controller</p>
                <div className="flex items-center gap-2">
                  {deviceStatus?.esp32_1 === true &&
                  deviceStatus?.wifiConnected === true &&
                  currentTime - (deviceStatus.lastSeen || 0) <= 8000 ? (
                    <><CheckCircle2 className="h-4 w-4 text-emerald-500" /><span className="text-emerald-500 font-bold text-sm">Connected</span></>
                  ) : (
                    <><XCircle className="h-4 w-4 text-red-500" /><span className="text-red-500 font-bold text-sm">Offline</span></>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-slate-500 font-semibold">Device ID</p>
                  <p className="text-slate-300 font-mono truncate" title={patientId}>{patientId}</p>
                </div>
                <div>
                  <p className="text-slate-500 font-semibold">Wi-Fi & Signal</p>
                  <p className="text-slate-300">
                    {deviceStatus?.wifiConnected
                      ? `${deviceStatus.wifiRssi ?? 0} dBm`
                      : "Disconnected"}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-slate-500 font-semibold">Last Seen</p>
                  <p className="text-slate-300">
                    {deviceStatus?.lastSeen ? new Date(deviceStatus.lastSeen).toLocaleTimeString() : "Never"}
                  </p>
                </div>
              </div>
            </div>

            {/* ESP32-2 Sensor Reader */}
            <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-850 space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm font-bold text-white">ESP32-2 Sensor Reader</p>
                <div className="flex items-center gap-2">
                  {deviceStatus?.esp32_2 === true &&
                  deviceStatus?.sensorConnected === true &&
                  currentTime - (deviceStatus.lastSeen || 0) <= 8000 ? (
                    <><CheckCircle2 className="h-4 w-4 text-emerald-500" /><span className="text-emerald-500 font-bold text-sm">Connected</span></>
                  ) : (
                    <><XCircle className="h-4 w-4 text-red-500" /><span className="text-red-500 font-bold text-sm">Offline</span></>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-slate-500 font-semibold">Device ID</p>
                  <p className="text-slate-300 font-mono truncate" title={patientId}>{patientId}</p>
                </div>
                <div>
                  <p className="text-slate-500 font-semibold">Connection</p>
                  <p className="text-slate-300">
                    {deviceStatus?.sensorConnected ? "ESP-NOW connected" : "Disconnected"}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-slate-500 font-semibold">Last Seen</p>
                  <p className="text-slate-300">
                    {deviceStatus?.lastSeen ? new Date(deviceStatus.lastSeen).toLocaleTimeString() : "Never"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reports Section */}
      <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="h-5 w-5 text-indigo-400" />
            My Therapy Reports
          </CardTitle>
          <CardDescription className="text-slate-400">
            View clinical summaries generated by your doctor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <p>No therapy sessions recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between p-4 bg-slate-950/80 rounded-lg border border-slate-850">
                  <div className="space-y-1">
                    <h4 className="font-semibold text-slate-200">Session {session.sessionNumber}</h4>
                    <p className="text-xs text-slate-400">
                      {new Date(session.startedAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-300 mt-1">
                      Prescription:{" "}
                      {session.prescription ? (
                        <span className="text-emerald-300">{session.prescription}</span>
                      ) : (
                        <span className="text-amber-400">Pending</span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    {session.pdfGenerated && session.files?.pdfBase64 ? (
                      <a href={session.files.pdfBase64} download={`Therapy_Session_${session.sessionNumber}.pdf`}>
                        <Button variant="outline" size="sm" className="gap-2 bg-indigo-500/10 text-indigo-300 border-indigo-500/50 hover:bg-indigo-500/20">
                          <Download className="h-4 w-4" />
                          Download PDF
                        </Button>
                      </a>
                    ) : (
                      <Badge variant="outline" className="text-amber-400 border-amber-500/50 bg-amber-500/10">
                        Report Pending
                      </Badge>
                    )}
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                      onClick={() => handleDelete(session.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
