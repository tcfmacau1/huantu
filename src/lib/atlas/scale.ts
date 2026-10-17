import type { MetricId } from "@/data/metrics";
import { metricById } from "@/data/metrics";

const RAMP = ["#14362f", "#1d5346", "#2f7a64", "#8fbf9a", "#e7d7a4", "#f0c56a"] as const;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  const channels = from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * t),
  );
  return `rgb(${channels[0]} ${channels[1]} ${channels[2]})`;
}

export function rampColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const x = clamped * (RAMP.length - 1);
  const index = Math.min(RAMP.length - 2, Math.floor(x));
  return mix(RAMP[index], RAMP[index + 1], x - index);
}

export function rampCss(): string {
  return `linear-gradient(90deg, ${RAMP.join(", ")})`;
}

function transform(value: number, metric: MetricId): number {
  if (metricById(metric).scale !== "log") return value;
  return Math.log(Math.max(value, 0.05));
}

export function normalize(value: number, min: number, max: number, metric: MetricId): number {
  const a = transform(min, metric);
  const b = transform(max, metric);
  if (b === a) return 0.5;
  return Math.min(1, Math.max(0, (transform(value, metric) - a) / (b - a)));
}

export function valueAt(t: number, min: number, max: number, metric: MetricId): number {
  if (metricById(metric).scale === "log") {
    const a = Math.log(Math.max(min, 0.05));
    const b = Math.log(Math.max(max, 0.05));
    return Math.exp(a + (b - a) * t);
  }
  return min + (max - min) * t;
}

export function colorForValue(
  value: number | null,
  min: number,
  max: number,
  metric: MetricId,
): string {
  if (value == null) return "var(--color-nodata)";
  return rampColor(normalize(value, min, max, metric));
}
