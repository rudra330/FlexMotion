"use client";

import { useEffect, useState } from "react";
import { useDatabase } from "@/firebase";
import { ref, onValue } from "firebase/database";
import { DoctorWorkspace } from "@/components/tele-rehab/DoctorWorkspace";
import { PatientWorkspace } from "@/components/tele-rehab/PatientWorkspace";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ensureDoctorRealtimeNodes, ensurePatientRealtimeNodes } from "@/firebase/teleRehab";

export default function DashboardPage() {
  const database = useDatabase();

  const [role, setRole] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [name, setName] = useState<string>("");

  // Patient clinical metadata
  const [assignedDoctorId, setAssignedDoctorId] = useState("");
  const [assignedDoctorName, setAssignedDoctorName] = useState("");
  const [loadingPatientProfile, setLoadingPatientProfile] = useState(false);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    const storedRole = localStorage.getItem("flex_role");
    const storedUid = localStorage.getItem("flex_uid");
    const storedName = localStorage.getItem("flex_name") || "User";

    setRole(storedRole);
    setUid(storedUid);
    setName(storedName);

    if (storedRole === "patient" && storedUid && database) {
      ensurePatientRealtimeNodes(database, storedUid)
        .catch((err) => console.error("Failed to repair patient RTDB nodes:", err));
      setLoadingPatientProfile(true);
      const patientRef = ref(database, `users/patients/${storedUid}/profile`);
      
      onValue(patientRef, (snapshot) => {
        if (snapshot.exists()) {
          const profile = snapshot.val();
          setAssignedDoctorId(profile.assignedDoctorId || "");
          setAssignedDoctorName(profile.assignedDoctorName || "Assigned Practitioner");
          setProfileError("");
        } else {
          setProfileError("Could not find your patient profile in the registry.");
        }
        setLoadingPatientProfile(false);
      }, (err) => {
        console.error(err);
        setProfileError("Database read failed while fetching clinical profile.");
        setLoadingPatientProfile(false);
      });
    } else if (storedRole === "doctor" && storedUid && database) {
      ensureDoctorRealtimeNodes(database, storedUid)
        .catch((err) => console.error("Failed to repair doctor RTDB nodes:", err));
    }
  }, [database]);

  if (!database) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mx-auto" />
          <p className="text-sm font-medium tracking-wide">Connecting to Clinical Signaling Server…</p>
        </div>
      </div>
    );
  }

  if (role === "patient" && loadingPatientProfile) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mx-auto" />
          <p className="text-sm font-medium tracking-wide">Synchronizing Clinical Care Profile…</p>
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 px-4">
        <Card className="max-w-md border-red-900/40 bg-red-950/10 text-red-200">
          <CardContent className="pt-6 text-center space-y-4">
            <ShieldAlert className="h-12 w-12 text-red-500 mx-auto" />
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white">Clinical Synchronization Failed</h3>
              <p className="text-xs text-red-300 leading-relaxed">
                {profileError} Please log out, clean your session history, and register a fresh profile.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <main className="p-4 sm:p-6 lg:p-8 bg-slate-950 min-h-screen text-slate-100">
      {role === "doctor" && uid && (
        <DoctorWorkspace 
          database={database} 
          doctorId={uid} 
          doctorName={name} 
        />
      )}

      {role === "patient" && uid && (
        <PatientWorkspace
          database={database}
          patientId={uid}
          patientName={name}
          assignedDoctorId={assignedDoctorId}
          assignedDoctorName={assignedDoctorName}
        />
      )}
    </main>
  );
}
