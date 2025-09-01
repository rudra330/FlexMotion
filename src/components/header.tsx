"use client";

import { HandMetal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarTrigger } from './ui/sidebar';

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-card/95 backdrop-blur-sm">
      <div className="container flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
            <SidebarTrigger/>
            <div className='flex items-center gap-3 md:hidden'>
              <HandMetal className="h-7 w-7 text-primary" />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                FlexMotion
              </h1>
            </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

    