"use client";

import { Play, Square, Download, HandMetal } from 'lucide-react';
import { Button } from '@/components/ui/button';

type HeaderProps = {
  isRecording: boolean;
  onToggleRecording: () => void;
  onDownloadCsv: () => void;
};

export function Header({ isRecording, onToggleRecording, onDownloadCsv }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur-sm">
      <div className="container flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <HandMetal className="h-7 w-7 text-primary" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            FlexMotion Recorder
          </h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <Button onClick={onToggleRecording} variant={isRecording ? 'destructive' : 'default'} className="w-36 sm:w-40">
            {isRecording ? <Square className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {isRecording ? 'Stop' : 'Start Recording'}
          </Button>
          <Button onClick={onDownloadCsv} disabled={isRecording} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Download CSV</span>
            <span className="sm:hidden">CSV</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
