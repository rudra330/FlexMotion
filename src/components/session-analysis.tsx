"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { SENSOR_NAMES } from "@/app/page";
import type { Session } from "@/lib/types";
import { Button } from "./ui/button";
import { Trash2 } from "lucide-react";

type SessionAnalysisProps = {
  sessions: Session[];
  onClearSessions: () => void;
};

const getSessionStats = (session: Session) => {
  const stats: { [key: string]: { avg: number; range: number } } = {};

  SENSOR_NAMES.forEach((_, index) => {
    const key = `sensor${index}`;
    const values = session.data.map(d => d[key]).filter(v => v !== undefined);
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

export function SessionAnalysis({ sessions, onClearSessions }: SessionAnalysisProps) {
  if (sessions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Session Analysis</CardTitle>
          <CardDescription>No sessions recorded yet. Start a recording to begin analysis.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground p-8">
            Your recorded sessions will appear here.
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = sessions.map(session => {
    const stats = getSessionStats(session);
    const avgRange = SENSOR_NAMES.reduce((acc, _, i) => acc + stats[`sensor${i}`].range, 0) / SENSOR_NAMES.length;
    return {
      name: new Date(session.date).toLocaleDateString(),
      avgRange: parseFloat(avgRange.toFixed(3)),
    };
  });

  const lastSession = sessions[sessions.length - 1];
  const lastSessionStats = getSessionStats(lastSession);

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle>Session Analysis</CardTitle>
                <CardDescription>Review progress across all recorded sessions.</CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={onClearSessions} aria-label="Clear all sessions">
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-semibold">Overall Improvement</h3>
           <CardDescription>Average Range of Motion across all sensors per session.</CardDescription>
          <div className="h-[250px] w-full">
            <ChartContainer config={{ avgRange: { label: "Avg. Range", color: "hsl(var(--primary))" } }}>
              <BarChart data={chartData} accessibilityLayer margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
                <YAxis domain={[0, 1]} tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
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
            <h3 className="text-lg font-semibold">Last Session Details</h3>
            <CardDescription>
                Recorded on {new Date(lastSession.date).toLocaleString()} for {lastSession.duration.toFixed(1)}s
            </CardDescription>
            <div className="overflow-x-auto rounded-lg border">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Sensor</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Range</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {SENSOR_NAMES.map((name, index) => {
                    const stat = lastSessionStats[`sensor${index}`];
                    return (
                        <TableRow key={name}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell className="text-right">{stat.avg.toFixed(3)}</TableCell>
                        <TableCell className="text-right">{stat.range.toFixed(3)}</TableCell>
                        </TableRow>
                    );
                    })}
                </TableBody>
                </Table>
            </div>
        </div>
      </CardContent>
       <CardFooter className="text-xs text-muted-foreground">
        Note: Range of Motion is the difference between the max and min values recorded for each sensor during a session.
      </CardFooter>
    </Card>
  );
}
