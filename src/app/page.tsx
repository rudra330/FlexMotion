"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const role = typeof window !== "undefined" ? localStorage.getItem("flex_role") : null;
    const uid = typeof window !== "undefined" ? localStorage.getItem("flex_uid") : null;

    if (role && uid) {
      router.replace("/dashboard");
    } else {
      router.replace("/login");
    }
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
      <div className="text-center space-y-2">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-sm font-medium tracking-wide">Verifying secure session…</p>
      </div>
    </div>
  );
}
