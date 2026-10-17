export const METRICS = [
  {
    id: "hdi",
    label: "人類發展指數",
    short: "發展指數",
    unit: "越接近 1 越高",
    hint: "健康、教育與收入的綜合指標。",
    scale: "linear",
  },
  {
    id: "life",
    label: "預期壽命",
    short: "預期壽命",
    unit: "歲",
    hint: "出生時預期可以活到的年齡。",
    scale: "linear",
  },
  {
    id: "gdp",
    label: "人均 GDP",
    short: "人均產值",
    unit: "美元，購買力平價",
    hint: "每人平均產值。色階用對數，避免極高值吃掉差異。",
    scale: "log",
  },
  {
    id: "net",
    label: "網路普及率",
    short: "網路普及",
    unit: "人口百分比",
    hint: "使用網際網路的人口比例。",
    scale: "linear",
  },
  {
    id: "renew",
    label: "再生能源占比",
    short: "再生能源",
    unit: "電力百分比",
    hint: "電力來自再生能源的比例，不是總能源。",
    scale: "linear",
  },
  {
    id: "co2",
    label: "人均二氧化碳",
    short: "人均碳排",
    unit: "噸／人",
    hint: "每人每年排放。數值越高代表排放越多，不代表越好。",
    scale: "log",
  },
] as const;

export type MetricId = (typeof METRICS)[number]["id"];
export type Metric = (typeof METRICS)[number];

export function metricById(id: MetricId): Metric {
  const found = METRICS.find((metric) => metric.id === id);
  if (!found) throw new Error(`Unknown metric ${id}`);
  return found;
}

export function formatMetric(id: MetricId, value: number): string {
  switch (id) {
    case "hdi":
      return value.toFixed(3);
    case "life":
      return value.toFixed(1);
    case "gdp":
      return `US$${Math.round(value).toLocaleString("en-US")}`;
    case "net":
    case "renew":
      return `${Math.round(value)}%`;
    case "co2":
      return value.toFixed(1);
  }
}
