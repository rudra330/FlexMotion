"use client";

import { useEffect, useState } from "react";
import { Database } from "firebase/database";
import { useToast } from "@/hooks/use-toast";
import { getPatientsByDoctor, PatientProfile, listenToTherapySessions, TherapySessionRecord, deleteTherapySession, updateTherapySessionReport } from "@/firebase/teleRehab";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Loader2,
  ArrowRight,
  ClipboardList,
  FileText,
  Download,
  Trash2,
  Wifi
} from "lucide-react";
import Link from "next/link";
import { jsPDF } from "jspdf";
import { useLiveSensorTracking } from "@/hooks/use-live-sensor-tracking";

interface DoctorWorkspaceProps {
  database: Database;
  doctorId: string;
  doctorName: string;
}

export function DoctorWorkspace({ database, doctorId, doctorName }: DoctorWorkspaceProps) {
  const { toast } = useToast();
  const [patients, setPatients] = useState<Record<string, PatientProfile>>({});
  const [loadingPatients, setLoadingPatients] = useState(true);
  
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [therapySessions, setTherapySessions] = useState<TherapySessionRecord[]>([]);

  // Sensor Data via Custom Hook
  const sensorValues = useLiveSensorTracking(database, selectedPatientId);

  // PDF Generation State
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  
  // PDF Form Fields
  const [therapyProtocol, setTherapyProtocol] = useState("");
  const [doctorObservation, setDoctorObservation] = useState("");
  const [clinicalAssessment, setClinicalAssessment] = useState("");
  const [prescription, setPrescription] = useState("");
  const [followUpPlan, setFollowUpPlan] = useState("");
  const [feedback, setFeedback] = useState({
    pain: "",
    gloveComfort: "",
    pressureTooHigh: "",
    tiredness: "",
    continueProgram: ""
  });

  // Load Patients Roster
  useEffect(() => {
    async function loadPatients() {
      try {
        const roster = await getPatientsByDoctor(doctorId, database);
        setPatients(roster);
      } catch (err) {
        console.error("Failed to load patient roster:", err);
      } finally {
        setLoadingPatients(false);
      }
    }
    loadPatients();
  }, [database, doctorId]);


  // Load Selected Patient Sessions
  useEffect(() => {
    if (selectedPatientId && database) {
      const unsubscribe = listenToTherapySessions(doctorId, selectedPatientId, (sessions) => {
        setTherapySessions(sessions);
      }, database);
      return () => unsubscribe();
    } else {
      setTherapySessions([]);
    }
  }, [selectedPatientId, doctorId, database]);

  const handleDeleteSession = async (sessionId: string) => {
    if (!selectedPatientId || !database) return;
    if (confirm("Are you sure you want to delete this session entirely?")) {
      try {
        await deleteTherapySession(doctorId, selectedPatientId, sessionId, database);
        toast({ title: "Session Deleted", description: "The session record has been removed." });
      } catch (e: any) {
        toast({ variant: "destructive", title: "Error", description: e.message });
      }
    }
  };

  const generatePDF = async () => {
    if (!editingSessionId || !selectedPatientId || !database) return;
    
    const session = therapySessions.find(s => s.id === editingSessionId);
    if (!session) return;
    
    const doc = new jsPDF();
    
    // --- 1. PDF Design Style (Navy Blue & Soft Teal) ---
    const primaryColor: [number, number, number] = [30, 58, 95]; // #1E3A5F
    const accentColor: [number, number, number] = [42, 167, 165]; // #2AA7A5
    const textColor: [number, number, number] = [34, 34, 34]; // #222222
    const labelColor: [number, number, number] = [100, 100, 100]; // dark gray

    // --- Header ---
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("SMART PNEUMATIC HAND REHABILITATION SYSTEM", 105, 14, { align: 'center' });
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("Tele-Rehabilitation Therapy Session Report", 105, 22, { align: 'center' });

    let yOffset = 40;
    
    const addSectionTitle = (title: string) => {
      if (yOffset > 270) {
        doc.addPage();
        yOffset = 20;
      }
      doc.setFillColor(...accentColor);
      doc.rect(14, yOffset - 5, 3, 6, 'F');
      doc.setTextColor(...primaryColor);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(title, 20, yOffset);
      yOffset += 8;
    };

    const addKeyValue = (key: string, value: string) => {
      if (yOffset > 280) { doc.addPage(); yOffset = 20; }
      doc.setTextColor(...labelColor);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(`${key}:`, 20, yOffset);
      doc.setTextColor(...textColor);
      doc.setFont("helvetica", "normal");
      doc.text(value, 60, yOffset);
      yOffset += 6;
    };

    const addTextBlock = (text: string) => {
      doc.setTextColor(...textColor);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const splitText = doc.splitTextToSize(text || "None provided.", 170);
      doc.text(splitText, 20, yOffset);
      yOffset += (splitText.length * 5) + 6;
    };

    // 1. Report Information
    addSectionTitle("1. Report Information");
    addKeyValue("Report ID", session.id);
    addKeyValue("Session Number", session.sessionNumber.toString());
    addKeyValue("Generated Date", new Date().toLocaleDateString());
    addKeyValue("Report Status", "Finalized");
    yOffset += 4;

    // 2. Patient Information
    addSectionTitle("2. Patient Information");
    addKeyValue("Patient Name", session.patientName);
    addKeyValue("Patient ID", session.patientId);
    addKeyValue("Assigned Doctor", session.doctorName);
    addKeyValue("Therapy Type", "Pneumatic Mirror Therapy");
    addKeyValue("Session Mode", "Tele-Rehabilitation");
    yOffset += 4;

    // 3. Session Information
    addSectionTitle("3. Session Information");
    addKeyValue("Date and Time", new Date(session.startedAt).toLocaleString());
    addKeyValue("Therapy Duration", `${session.durationSec} Seconds`);
    addKeyValue("Video Call", "Completed");
    addKeyValue("Therapy Mode", session.recordingEnabled ? "Active (Recorded)" : "Active (Not Recorded)");
    yOffset += 4;

    // 4. Therapy Protocol
    addSectionTitle("4. Therapy Protocol");
    addTextBlock(therapyProtocol);
    
    // 5. Motor and Valve Activity Summary
    addSectionTitle("5. Motor and Valve Activity Summary");
    addKeyValue("Avg Motor Speed", (session.motorValveSummary?.motorSpeedAvg?.toFixed(1) || "0") + " PWM");
    addKeyValue("Total Run Time", (session.motorValveSummary?.totalPumpOnTimeSec || 0) + " Seconds");
    addKeyValue("Valve Activity", "Synced with Motor Cycle");
    addKeyValue("Emergency Stop", "Not Triggered");
    yOffset += 4;

    // 6. Sensor Recording Status
    addSectionTitle("6. Sensor Recording Status");
    addKeyValue("Recording Status", session.recordingEnabled ? "Recorded" : "Not Recorded");
    addKeyValue("CSV Data", "Available to doctor only (Secure Log)");
    yOffset += 4;

    // 7. Doctor’s Clinical Observation
    addSectionTitle("7. Doctor's Clinical Observation");
    addTextBlock(doctorObservation);

    // 8. Patient Feedback
    addSectionTitle("8. Patient Feedback");
    addKeyValue("Did you feel pain?", feedback.pain || "N/A");
    addKeyValue("Glove comfortable?", feedback.gloveComfort || "N/A");
    addKeyValue("Pressure too high?", feedback.pressureTooHigh || "N/A");
    addKeyValue("Did you feel tired?", feedback.tiredness || "N/A");
    addKeyValue("Continue program?", feedback.continueProgram || "N/A");
    yOffset += 4;

    // 9. Clinical Assessment
    addSectionTitle("9. Clinical Assessment");
    addTextBlock(clinicalAssessment);

    // 10. Prescription / Recommendation
    addSectionTitle("10. Prescription / Recommendation");
    addTextBlock(prescription);

    // 11. Follow-Up Plan
    addSectionTitle("11. Follow-Up Plan");
    addTextBlock(followUpPlan);

    // 12. Doctor Approval
    yOffset += 10;
    if (yOffset > 250) { doc.addPage(); yOffset = 20; }
    addSectionTitle("12. Doctor Approval");
    addKeyValue("Doctor Name", session.doctorName);
    addKeyValue("Signature", "___________________________");
    yOffset += 6;
    addKeyValue("Finalized Date", new Date().toLocaleDateString());

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    doc.setTextColor(...labelColor);
    doc.setFontSize(8);
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.text(`SMART PNEUMATIC HAND REHABILITATION SYSTEM | Page ${i} of ${pageCount}`, 105, 290, { align: 'center' });
    }

    const pdfBase64 = doc.output('datauristring');
    
    await updateTherapySessionReport(doctorId, selectedPatientId, session.id, {
      therapyProtocol,
      doctorObservation,
      clinicalAssessment,
      prescription,
      followUpPlan,
      patientFeedback: feedback,
      pdfGenerated: true,
      reportVisibleToPatient: true,
      files: {
        pdfBase64: pdfBase64
      }
    }, database);
    
    setEditingSessionId(null);
    toast({ title: "Report Generated", description: "PDF saved and published to patient." });
  };

  const downloadCSV = (session: TherapySessionRecord) => {
    if (!session.sensorLog || session.sensorLog.length === 0) {
      toast({ title: "No Data", description: "This session does not have CSV logs.", variant: "destructive" });
      return;
    }
    
    const headers = "timestamp,sessionTime,thumb,index,middle,ring,pinky,wrist\n";
    const rows = session.sensorLog.map(row => 
      `${row.timestamp},${row.sessionTime},${row.thumb},${row.index},${row.middle},${row.ring},${row.pinky},${row.wrist}`
    ).join("\n");
    
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Therapy_Log_${session.sessionNumber}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Clinician Header Card */}
      <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs uppercase font-bold tracking-widest text-indigo-400">
                Authorized Professional Portal
              </span>
              <h2 className="text-3xl font-bold tracking-tight text-white">
                Clinical Workspace
              </h2>
              <p className="text-slate-400 text-sm">
                Supervising Clinician: <span className="text-slate-200 font-semibold">{doctorName}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/dashboard/gesture-control">
                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-11 px-5 flex items-center gap-2">
                  <span>Enter Video Call Portal</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        {/* Left Column: Patient Roster & Sensor Signals */}
        <div className="space-y-6 lg:col-span-1">
          
          {/* Patient Roster */}
          <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase text-slate-400 flex items-center justify-between">
                Assigned Patients
                <User className="h-4 w-4 text-indigo-400" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingPatients ? (
                <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
              ) : Object.keys(patients).length === 0 ? (
                <div className="text-sm text-slate-500 p-2 text-center">No patients assigned.</div>
              ) : (
                <div className="space-y-2">
                  {Object.values(patients).map((p) => {
                    const safeId = p.email.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '_');
                    const isSelected = selectedPatientId === safeId;
                    return (
                      <div 
                        key={safeId} 
                        onClick={() => setSelectedPatientId(safeId)}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${isSelected ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-slate-950 border-slate-800 hover:bg-slate-800'}`}
                      >
                        <h4 className="text-white font-semibold text-sm">{p.name}</h4>
                        <p className="text-xs text-slate-400">{p.email}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sensor Signals Panel */}
          <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase text-slate-400 flex items-center justify-between">
                Live Sensor Signals
                <Wifi className="h-4 w-4 text-emerald-400 animate-pulse" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[
                  { label: "Thumb", idx: 0 },
                  { label: "Index", idx: 1 },
                  { label: "Middle", idx: 2 },
                  { label: "Ring", idx: 3 },
                  { label: "Pinky", idx: 4 },
                ].map(s => (
                  <div key={s.label} className="flex justify-between items-center text-sm p-2 bg-slate-950 rounded-lg border border-slate-800">
                    <span className="text-slate-300 font-medium w-16">{s.label}</span>
                    <div className="flex gap-2">
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] text-slate-500 font-bold uppercase mb-0.5">RAW</span>
                        <Badge variant="outline" className="text-slate-400 border-slate-700 bg-slate-800/50 font-mono w-14 justify-center">
                          {Math.round(sensorValues.raw[s.idx])}
                        </Badge>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] text-emerald-500 font-bold uppercase mb-0.5">LIVE DIFF</span>
                        <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 font-mono w-14 justify-center">
                          {Math.round(sensorValues.liveDifference[s.idx])}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

        </div>

        {/* Right Column: Reports & Therapy Sessions */}
        <div className="lg:col-span-2">
          <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md h-full">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-indigo-400" />
                Patient Reports
              </CardTitle>
              <CardDescription>
                Select a patient from the roster to view and manage their therapy session records.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedPatientId ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-3">
                  <User className="h-10 w-10 opacity-20" />
                  <p className="text-sm">Select a patient on the left to view reports.</p>
                </div>
              ) : therapySessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-3">
                  <ClipboardList className="h-10 w-10 opacity-20" />
                  <p className="text-sm">No therapy sessions recorded for this patient.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {therapySessions.map(session => (
                    <div key={session.id} className="p-4 bg-slate-950 rounded-xl border border-slate-850 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <h4 className="font-bold text-slate-200">Session {session.sessionNumber}</h4>
                        <p className="text-xs text-slate-400">Date: {new Date(session.startedAt).toLocaleString()}</p>
                        <p className="text-xs text-slate-400">Duration: {session.durationSec}s</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {session.pdfGenerated ? (
                          <a href={session.files?.pdfBase64} download={`Therapy_Session_${session.sessionNumber}.pdf`}>
                            <Button variant="outline" size="sm" className="gap-2 bg-indigo-500/10 text-indigo-300 border-indigo-500/50 hover:bg-indigo-500/20">
                              <Download className="h-4 w-4" /> PDF
                            </Button>
                          </a>
                        ) : (
                          <Button 
                            variant="secondary" 
                            size="sm"
                            className="bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30"
                            onClick={() => {
                              setEditingSessionId(session.id);
                              setTherapyProtocol(session.therapyProtocol || "");
                              setDoctorObservation(session.doctorObservation || "");
                              setClinicalAssessment(session.clinicalAssessment || "");
                              setPrescription(session.prescription || "");
                              setFollowUpPlan(session.followUpPlan || "");
                              setFeedback(session.patientFeedback || {
                                pain: "", gloveComfort: "", pressureTooHigh: "", tiredness: "", continueProgram: ""
                              });
                            }}
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            Finalize Report
                          </Button>
                        )}
                        {session.recordingEnabled && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="bg-emerald-500/10 text-emerald-300 border-emerald-500/50 hover:bg-emerald-500/20"
                            onClick={() => downloadCSV(session)}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            CSV
                          </Button>
                        )}
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                          onClick={() => handleDeleteSession(session.id)}
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
      </div>

      {/* Write Session Report PDF Modal */}
      {editingSessionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <Card className="w-full max-w-3xl bg-slate-900 border-slate-700">
            <CardHeader className="border-b border-slate-800">
              <CardTitle className="text-white">Finalize Clinical Report</CardTitle>
              <CardDescription className="text-slate-400">
                Complete the missing sections to generate the Tele-Rehabilitation PDF.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 max-h-[70vh] overflow-y-auto p-6">
              
              {/* Doctor inputs */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Therapy Protocol</label>
                  <textarea className="w-full p-2 bg-slate-950 border border-slate-800 text-white rounded-md text-sm" rows={2} value={therapyProtocol} onChange={e => setTherapyProtocol(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Doctor's Observation</label>
                  <textarea className="w-full p-2 bg-slate-950 border border-slate-800 text-white rounded-md text-sm" rows={2} value={doctorObservation} onChange={e => setDoctorObservation(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Clinical Assessment</label>
                  <textarea className="w-full p-2 bg-slate-950 border border-slate-800 text-white rounded-md text-sm" rows={2} value={clinicalAssessment} onChange={e => setClinicalAssessment(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Prescription / Recommendation</label>
                  <textarea className="w-full p-2 bg-slate-950 border border-slate-800 text-white rounded-md text-sm" rows={2} value={prescription} onChange={e => setPrescription(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-300">Follow-Up Plan</label>
                  <textarea className="w-full p-2 bg-slate-950 border border-slate-800 text-white rounded-md text-sm" rows={2} value={followUpPlan} onChange={e => setFollowUpPlan(e.target.value)} />
                </div>
              </div>

              {/* Patient feedback inputs */}
              <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <h4 className="text-sm font-bold text-slate-200">Patient Feedback Answers</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1"><label className="text-xs text-slate-400">Did you feel pain?</label>
                  <input className="w-full p-2 bg-slate-900 border border-slate-800 text-white rounded-md" value={feedback.pain} onChange={e => setFeedback({...feedback, pain: e.target.value})} /></div>
                  <div className="space-y-1"><label className="text-xs text-slate-400">Glove comfortable?</label>
                  <input className="w-full p-2 bg-slate-900 border border-slate-800 text-white rounded-md" value={feedback.gloveComfort} onChange={e => setFeedback({...feedback, gloveComfort: e.target.value})} /></div>
                  <div className="space-y-1"><label className="text-xs text-slate-400">Pressure too high?</label>
                  <input className="w-full p-2 bg-slate-900 border border-slate-800 text-white rounded-md" value={feedback.pressureTooHigh} onChange={e => setFeedback({...feedback, pressureTooHigh: e.target.value})} /></div>
                  <div className="space-y-1"><label className="text-xs text-slate-400">Did you feel tired?</label>
                  <input className="w-full p-2 bg-slate-900 border border-slate-800 text-white rounded-md" value={feedback.tiredness} onChange={e => setFeedback({...feedback, tiredness: e.target.value})} /></div>
                  <div className="col-span-2 space-y-1"><label className="text-xs text-slate-400">Continue this program?</label>
                  <input className="w-full p-2 bg-slate-900 border border-slate-800 text-white rounded-md" value={feedback.continueProgram} onChange={e => setFeedback({...feedback, continueProgram: e.target.value})} /></div>
                </div>
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setEditingSessionId(null)} className="border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</Button>
                <Button onClick={generatePDF} className="bg-indigo-600 hover:bg-indigo-700 text-white">Generate Final PDF</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}
