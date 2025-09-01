"use client";

import Link from "next/link";
import { Cog, HandMetal, LayoutDashboard } from "lucide-react";
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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
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
              <Link href="/dashboard" passHref>
                <SidebarMenuButton asChild isActive={pathname === '/dashboard'} tooltip="Dashboard">
                  <>
                    <LayoutDashboard />
                    <span className="group-data-[collapsible=icon]:hidden">Dashboard</span>
                  </>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
             <SidebarMenuItem>
                <Link href="/dashboard/motor" passHref>
                    <SidebarMenuButton asChild isActive={pathname === '/dashboard/motor'} tooltip="Motor">
                        <>
                            <Cog />
                            <span className="group-data-[collapsible=icon]:hidden">Motor</span>
                        </>
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