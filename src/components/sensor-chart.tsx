"use client";

import { Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { ChartTooltipContent, ChartContainer, ChartTooltip } from "@/components/ui/chart";

type SensorChartProps = {
  data: { timestamp: number; [key: string]: number }[];
  dataKey: string;
};

export function SensorChart({ data, dataKey }: SensorChartProps) {
  return (
    <div className="h-[200px] w-full">
      <ChartContainer
        config={{
          value: {
            label: "Sensor Value",
            color: "hsl(var(--accent))",
          },
        }}
      >
        <LineChart
          data={data}
          margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            tick={{ fontSize: 12 }}
          />
          <YAxis 
            domain={[0, 1]} 
            axisLine={false} 
            tickLine={false} 
            tickMargin={8}
            tickFormatter={(value) => value.toFixed(1)}
            tick={{ fontSize: 12 }} 
          />
          <ChartTooltip
            cursor={true}
            content={<ChartTooltipContent indicator="line" nameKey="value" />}
          />
          <Line
            dataKey={dataKey}
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={false}
            name="value"
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
