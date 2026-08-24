"use client";

import Link from "next/link";
import { Cog, Hand, HandMetal, LayoutDashboard, Loader2 } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Header } from "@/components/header";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GlobalCallListener } from "@/components/global-call-listener";
import { ActiveCallProvider } from "@/components/tele-rehab/ActiveCallProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isClient, setIsClient] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    setIsClient(true);
    
    const storedRole = localStorage.getItem("flex_role");
    const uid = localStorage.getItem("flex_uid");

    if (!storedRole || !uid) {
      router.replace("/login");
    } else {
      setRole(storedRole);
      setAuthorized(true);
    }
  }, [router]);

  if (!isClient || !authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mx-auto" />
          <p className="text-sm font-medium tracking-wide">Securing Tele-Rehabilitation Session…</p>
        </div>
      </div>
    );
  }

  // Dynamic visible navigation label based on role
  let gestureLabel = "Gesture Control";
  if (role === "doctor") {
    gestureLabel = "Therapy";
  } else if (role === "patient") {
    gestureLabel = "Mirror Therapy";
  }

  return (
    <>
      <Sidebar className="border-slate-800 bg-slate-950">
        <SidebarHeader className="border-b border-slate-850 p-4">
           <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 shadow-md shadow-indigo-500/20">
                <HandMetal className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white group-data-[collapsible=icon]:hidden">
                FlexMotion
              </h1>
            </div>
        </SidebarHeader>
        <SidebarContent className="p-2 bg-slate-950">
          <SidebarMenu>
            <SidebarMenuItem>
              <Link href="/dashboard">
                <SidebarMenuButton 
                  isActive={pathname === '/dashboard'} 
                  tooltip="Dashboard"
                  className={`text-slate-400 hover:text-white hover:bg-slate-900 ${
                    pathname === '/dashboard' ? 'bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/10 hover:text-indigo-400 font-semibold' : ''
                  }`}
                >
                    <LayoutDashboard className="h-5 w-5" />
                    <span className="group-data-[collapsible=icon]:hidden">Workspace</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
             <SidebarMenuItem>
                <Link href="/dashboard/motor">
                    <SidebarMenuButton 
                      isActive={pathname === '/dashboard/motor'} 
                      tooltip="Motor"
                      className={`text-slate-400 hover:text-white hover:bg-slate-900 ${
                        pathname === '/dashboard/motor' ? 'bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/10 hover:text-indigo-400 font-semibold' : ''
                      }`}
                    >
                        <Cog className="h-5 w-5" />
                        <span className="group-data-[collapsible=icon]:hidden">Motor Controls</span>
                    </SidebarMenuButton>
                </Link>
            </SidebarMenuItem>
            <SidebarMenuItem>
                <Link href="/dashboard/gesture-control">
                    <SidebarMenuButton 
                      isActive={pathname === '/dashboard/gesture-control'} 
                      tooltip={gestureLabel}
                      className={`text-slate-400 hover:text-white hover:bg-slate-900 ${
                        pathname === '/dashboard/gesture-control' ? 'bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/10 hover:text-indigo-400 font-semibold' : ''
                      }`}
                    >
                        <Hand className="h-5 w-5" />
                        <span className="group-data-[collapsible=icon]:hidden">{gestureLabel}</span>
                    </SidebarMenuButton>
                </Link>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <ActiveCallProvider>
        <SidebarInset className="bg-slate-950 text-slate-100 flex flex-col min-h-screen">
          <Header/>
          <div className="flex-1 bg-slate-950">
            {children}
          </div>
        </SidebarInset>
        <GlobalCallListener />
      </ActiveCallProvider>
    </>
  );
}
