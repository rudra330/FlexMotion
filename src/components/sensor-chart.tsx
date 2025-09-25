
"use client";

import { Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { ChartTooltipContent, ChartContainer, ChartTooltip } from "@/components/ui/chart";

type SensorChartProps = {
  data: { timestamp: number; [key: string]: number }[];
  dataKey: string;
  color?: string;
};

export function SensorChart({ data, dataKey, color }: SensorChartProps) {
  const chartColor = color || "hsl(var(--accent))";
  
  return (
    <div className="h-[200px] w-full">
      <ChartContainer
        config={{
          [dataKey]: {
            label: "Sensor Value",
            color: chartColor,
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
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value) => `${value}s`}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            tick={{ fontSize: 12 }}
          />
          <YAxis 
            domain={[0, 100]} 
            axisLine={false} 
            tickLine={false} 
            tickMargin={8}
            tickFormatter={(value) => value.toFixed(0)}
            tick={{ fontSize: 12 }} 
          />
          <ChartTooltip
            cursor={true}
            content={<ChartTooltipContent indicator="line" nameKey={dataKey} />}
          />
          <Line
            dataKey={dataKey}
            type="monotone"
            stroke={`var(--color-${dataKey})`}
            strokeWidth={2}
            dot={false}
            name={dataKey}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
