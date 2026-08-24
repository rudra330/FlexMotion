"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDatabase } from "@/firebase/provider";
import { listenForIncomingPatientCalls, acceptCall, declineCall } from "@/firebase/teleRehab";
import { Button } from "@/components/ui/button";
import { PhoneCall, PhoneOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function GlobalCallListener() {
  const database = useDatabase();
  const router = useRouter();
  
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [incomingCallId, setIncomingCallId] = useState<string | null>(null);
  const callerName = "Supervising Doctor";

  useEffect(() => {
    // Only run on client
    const storedRole = localStorage.getItem("flex_role");
    const uid = localStorage.getItem("flex_uid");
    if (storedRole === "patient" && uid) {
      setRole(storedRole);
      setUserId(uid);
    }
  }, []);

  useEffect(() => {
    if (role === "patient" && userId && database) {
      const unsubscribe = listenForIncomingPatientCalls(userId, (calls) => {
        const dialingCall = Object.entries(calls).find(([_, call]) => call.status === "dialing");
        
        if (dialingCall) {
          const [id] = dialingCall;
          setIncomingCallId((current) => current === id ? current : id);
        } else {
          setIncomingCallId(null);
        }
      }, database);

      return () => unsubscribe();
    }
  }, [role, userId, database]);

  if (!incomingCallId || !database) return null;

  const handleAccept = async () => {
    const callId = incomingCallId;
    try {
      await acceptCall(callId, database);
      sessionStorage.setItem("pending_call_id", callId);
      setIncomingCallId(null);
      router.push("/dashboard/gesture-control");
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Connection Failed",
        description: "Failed to accept the call. Please try again.",
      });
    }
  };

  const handleDecline = async () => {
    try {
      await declineCall(incomingCallId, database);
      setIncomingCallId(null);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl max-w-sm w-full mx-4 text-center animate-in zoom-in-95 duration-300">
        <div className="mx-auto w-20 h-20 bg-indigo-600/20 rounded-full flex items-center justify-center mb-6 animate-pulse">
          <PhoneCall className="h-10 w-10 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Incoming Call</h2>
        <p className="text-slate-400 mb-8">
          <strong className="text-slate-200">{callerName}</strong> is initiating a Tele-Rehabilitation session.
        </p>
        <div className="flex flex-col gap-3">
          <Button
            onClick={handleAccept}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-12 text-lg"
          >
            <PhoneCall className="mr-2 h-5 w-5" />
            Accept Call
          </Button>
          <Button
            onClick={handleDecline}
            variant="destructive"
            className="w-full bg-red-650 hover:bg-red-700 text-white rounded-xl h-12 text-lg"
          >
            <PhoneOff className="mr-2 h-5 w-5" />
            Decline
          </Button>
        </div>
      </div>
    </div>
  );
}
