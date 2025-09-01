"use client";

import { Bar, BarChart, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
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

// Calculate summary statistics for a session
const getSessionStats = (session: Session) => {
  const stats: { [key: string]: { avg: number; range: number } } = {};

  SENSOR_NAMES.forEach((_, index) => {
    const key = `sensor${index}`;
    const values = session.data.map(d => d[key]);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length || 0;
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
      <CardContent className="grid gap-8">
        <div>
          <h3 className="text-lg font-semibold mb-2">Overall Improvement (Average Range of Motion)</h3>
          <div className="h-[250px] w-full">
            <ChartContainer config={{ avgRange: { label: "Avg. Range", color: "hsl(var(--primary))" } }}>
              <BarChart data={chartData} accessibilityLayer margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis domain={[0, 1]} tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent indicator="dot" />}
                />
                <Bar dataKey="avgRange" fill="var(--color-avgRange)" radius={4} />
              </BarChart>
            </ChartContainer>
          </div>
        </div>

        <div>
            <h3 className="text-lg font-semibold mb-2">Last Session Details</h3>
            <CardDescription className="mb-4">
                Recorded on {new Date(lastSession.date).toLocaleString()} for {lastSession.duration.toFixed(1)}s
            </CardDescription>
            <div className="overflow-x-auto">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Sensor</TableHead>
                    <TableHead className="text-right">Average Value</TableHead>
                    <TableHead className="text-right">Range of Motion</TableHead>
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
        Note: Range of Motion is the difference between the max and min values recorded for each sensor.
      </CardFooter>
    </Card>
  );
}
