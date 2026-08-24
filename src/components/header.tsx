"use client";

import { HandMetal, LogOut, User, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarTrigger } from './ui/sidebar';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

export function Header() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  useEffect(() => {
    setName(localStorage.getItem("flex_name") || "");
    setRole(localStorage.getItem("flex_role") || "");
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("flex_role");
    localStorage.removeItem("flex_uid");
    localStorage.removeItem("flex_email");
    localStorage.removeItem("flex_name");
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-slate-900/50 backdrop-blur-md border-slate-800">
      <div className="container flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
            <SidebarTrigger className="text-slate-400 hover:text-white" />
            <div className='flex items-center gap-3 md:hidden'>
              <HandMetal className="h-7 w-7 text-indigo-500 animate-pulse" />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                FlexMotion
              </h1>
            </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          {name && (
            <div className="hidden sm:flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
              {role === 'doctor' ? (
                <Stethoscope className="h-4 w-4 text-indigo-400" />
              ) : (
                <User className="h-4 w-4 text-emerald-400" />
              )}
              <span className="text-sm font-medium text-slate-300">{name}</span>
              <Badge className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                role === 'doctor' ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20' : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20'
              }`}>
                {role}
              </Badge>
            </div>
          )}
          
          <ThemeToggle />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="flex items-center gap-2 text-slate-400 hover:text-red-400 hover:bg-red-950/20 border border-transparent hover:border-red-900/30 transition-all px-3"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">Sign Out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}