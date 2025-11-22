"use client";

import Link from "next/link";
import { Cog, Hand, HandMetal, LayoutDashboard } from "lucide-react";
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
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <>
      <Sidebar>
        <SidebarHeader>
           <div className="flex items-center gap-3">
              <HandMetal className="h-7 w-7 text-primary" />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight group-data-[collapsible=icon]:hidden">
                FlexMotion
              </h1>
            </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <Link href="/dashboard">
                <SidebarMenuButton isActive={isClient && pathname === '/dashboard'} tooltip="Dashboard">
                    <LayoutDashboard />
                    <span className="group-data-[collapsible=icon]:hidden">Dashboard</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
             <SidebarMenuItem>
                <Link href="/dashboard/motor">
                    <SidebarMenuButton isActive={isClient && pathname === '/dashboard/motor'} tooltip="Motor">
                        <Cog />
                        <span className="group-data-[collapsible=icon]:hidden">Motor</span>
                    </SidebarMenuButton>
                </Link>
            </SidebarMenuItem>
            <SidebarMenuItem>
                <Link href="/dashboard/gesture-control">
                    <SidebarMenuButton isActive={isClient && pathname === '/dashboard/gesture-control'} tooltip="Hand Gesture Control">
                        <Hand />
                        <span className="group-data-[collapsible=icon]:hidden">Hand Gesture Control</span>
                    </SidebarMenuButton>
                </Link>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <Header/>
        {children}
      </SidebarInset>
    </>
  );
}
