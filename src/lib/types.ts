export type RecordedDataPoint = {
  timestamp: number;
  [key: string]: number; // sensor0, sensor1, etc.
};

export type Session = {
  id: string;
  date: string; // ISO string
  duration: number; // in seconds
  data: RecordedDataPoint[];
};
