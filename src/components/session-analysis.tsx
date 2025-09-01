"use client";

import { useState } from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { format, isSameDay } from "date-fns";
import { Calendar as CalendarIcon, Trash2, XCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { SENSOR_NAMES } from "@/app/page";
import type { Session } from "@/lib/types";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar } from "./ui/calendar";
import { cn } from "@/lib/utils";

type SessionAnalysisProps = {
  sessions: Session[];
  onClearSessions: () => void;
  onDeleteSession: (sessionId: string) => void;
};

const getSessionStats = (session: Session) => {
  const stats: { [key: string]: { avg: number; range: number } } = {};

  SENSOR_NAMES.forEach((_, index) => {
    const key = `sensor${index}`;
    const values = session.data
      .map((d) => d[key])
      .filter((v) => v !== undefined);
    if (values.length === 0) {
      stats[key] = { avg: 0, range: 0 };
      return;
    }
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    stats[key] = { avg, range };
  });

  return stats;
};

export function SessionAnalysis({
  sessions,
  onClearSessions,
  onDeleteSession,
}: SessionAnalysisProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();

  if (sessions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Session Analysis</CardTitle>
          <CardDescription>
            No sessions recorded yet. Start a recording to begin analysis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground p-8">
            Your recorded sessions will appear here.
          </div>
        </CardContent>
      </Card>
    );
  }

  const overallChartData = sessions.map((session) => {
    const stats = getSessionStats(session);
    const avgRange =
      SENSOR_NAMES.reduce((acc, _, i) => acc + stats[`sensor${i}`].range, 0) /
      SENSOR_NAMES.length;
    return {
      name: format(new Date(session.date), "MMM d"),
      avgRange: parseFloat(avgRange.toFixed(3)),
    };
  });

  const filteredSessions = selectedDate
    ? sessions.filter((session) =>
        isSameDay(new Date(session.date), selectedDate)
      )
    : sessions;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <CardTitle>Session Analysis</CardTitle>
            <CardDescription>
              Review progress across all recorded sessions.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-[240px] justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? (
                    format(selectedDate, "PPP")
                  ) : (
                    <span>Filter by date...</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
             {selectedDate && (
                <Button variant="ghost" size="icon" onClick={() => setSelectedDate(undefined)}>
                    <XCircle className="h-4 w-4" />
                </Button>
             )}
            <Button
              variant="outline"
              size="icon"
              onClick={onClearSessions}
              aria-label="Clear all sessions"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-8">
        <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-4">
                <h3 className="text-lg font-semibold">Overall Improvement</h3>
                <CardDescription>
                    Average Range of Motion across all sensors per session.
                </CardDescription>
                <div className="h-[250px] w-full">
                    <ChartContainer
                    config={{
                        avgRange: { label: "Avg. Range", color: "hsl(var(--primary))" },
                    }}
                    >
                    <BarChart
                        data={overallChartData}
                        accessibilityLayer
                        margin={{ top: 20, right: 20, left: -10, bottom: 0 }}
                    >
                        <XAxis
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        fontSize={12}
                        />
                        <YAxis
                        domain={[0, 1]}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        fontSize={12}
                        />
                        <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent indicator="dot" />}
                        />
                        <Bar dataKey="avgRange" fill="var(--color-avgRange)" radius={4} />
                    </BarChart>
                    </ChartContainer>
                </div>
            </div>
            <div className="flex flex-col gap-4">
                <h3 className="text-lg font-semibold">Session History</h3>
                 <CardDescription>
                    {selectedDate ? `Showing sessions for ${format(selectedDate, "PPP")}` : "Showing all sessions"}
                </CardDescription>
                <div className="overflow-x-auto rounded-lg border max-h-[250px] overflow-y-auto">
                    <Table>
                    <TableHeader>
                        <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Duration (s)</TableHead>
                        <TableHead className="text-right">Avg. Range</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredSessions.length > 0 ? filteredSessions
                        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                        .map((session) => {
                            const stats = getSessionStats(session);
                            const avgRange = SENSOR_NAMES.reduce((acc, _, i) => acc + stats[`sensor${i}`].range, 0) / SENSOR_NAMES.length;
                            
                            return (
                                <TableRow key={session.id}>
                                    <TableCell className="font-medium">{format(new Date(session.date), 'PPp')}</TableCell>
                                    <TableCell className="text-right">{session.duration.toFixed(1)}</TableCell>
                                    <TableCell className="text-right">{avgRange.toFixed(3)}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => onDeleteSession(session.id)}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                            <span className="sr-only">Delete session</span>
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )
                        }) : (
                             <TableRow>
                                <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                                    No sessions found for this date.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                    </Table>
                </div>
            </div>
        </div>
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        Note: Range of Motion is the difference between the max and min values
        recorded for each sensor during a session.
      </CardFooter>
    </Card>
  );
}
