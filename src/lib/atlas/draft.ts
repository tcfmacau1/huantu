import { METRICS, type MetricId } from "@/data/metrics";

export type DraftValues = Record<string, Record<MetricId, number | null>>;

export type DraftCatalog = {
  key: string;
  zh: string;
  en: string;
};

export type DraftPatch = Record<string, Partial<Record<MetricId, number | null>>>;

export type DraftImport = {
  patch: DraftPatch;
  applied: number;
  skipped: string[];
};

const METRIC_IDS = METRICS.map((metric) => metric.id);

const COLUMN_ALIAS: Record<string, "key" | "zh" | "en" | MetricId> = {
  key: "key",
  id: "key",
  iso: "key",
  zh: "zh",
  中文: "zh",
  國家: "zh",
  en: "en",
  english: "en",
  name: "en",
  英文: "en",
  hdi: "hdi",
  人類發展指數: "hdi",
  發展指數: "hdi",
  life: "life",
  預期壽命: "life",
  gdp: "gdp",
  人均gdp: "gdp",
  人均產值: "gdp",
  net: "net",
  網路普及率: "net",
  網路普及: "net",
  renew: "renew",
  再生能源占比: "renew",
  再生能源: "renew",
  co2: "co2",
  人均二氧化碳: "co2",
  人均碳排: "co2",
};

function emptyValues(): Record<MetricId, number | null> {
  return { hdi: null, life: null, gdp: null, net: null, renew: null, co2: null };
}

export function sampleDraft(
  countries: Array<DraftCatalog & { values: Record<MetricId, number | null> }>,
): DraftValues {
  const draft: DraftValues = {};
  for (const country of countries) draft[country.key] = { ...country.values };
  return draft;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function draftToCsv(
  countries: Array<DraftCatalog & { region: string; values: Record<MetricId, number | null> }>,
): string {
  const header = ["key", "zh", "en", "region", ...METRIC_IDS];
  const lines = [header.join(",")];
  for (const country of countries) {
    lines.push(
      [
        country.key,
        csvCell(country.zh),
        csvCell(country.en),
        csvCell(country.region),
        ...METRIC_IDS.map((id) => (country.values[id] == null ? "" : String(country.values[id]))),
      ].join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const header = src.slice(0, src.indexOf("\n") === -1 ? src.length : src.indexOf("\n"));
  const commas = header.match(/,/g)?.length ?? 0;
  const semis = header.match(/;/g)?.length ?? 0;
  const tabs = header.match(/\t/g)?.length ?? 0;
  const delimiter = tabs > commas && tabs > semis ? "\t" : semis > commas ? ";" : ",";
  for (let index = 0; index < src.length; index += 1) {
    const char = src[index];
    if (quoted) {
      if (char === '"') {
        if (src[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((part) => part.trim() !== ""));
}

function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new Error("含有無法讀取的數字");
    return raw;
  }
  const text = String(raw).trim();
  if (text === "" || text === "-" || text === "—" || text === "無" || text.toLowerCase() === "null") return null;
  const value = Number(text.replaceAll(",", "").replace(/^US\$/i, "").replace(/%$/, ""));
  if (!Number.isFinite(value)) throw new Error(`無法讀取數字「${text}」`);
  return value;
}

function columnName(header: string): "key" | "zh" | "en" | MetricId | null {
  const name = COLUMN_ALIAS[header.trim().toLowerCase().replaceAll(" ", "")];
  return name ?? null;
}

function rowsFromCsv(text: string): Array<Record<string, string>> {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("底稿至少要有標題列和一列資料");
  const headers = table[0].map((header) => columnName(header));
  if (!headers.some((header) => header === "key" || header === "zh" || header === "en")) {
    throw new Error("標題列需要 key、中文名或英文名");
  }
  return table.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = cells[index] ?? "";
    });
    return record;
  });
}

function rowsFromJson(text: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;
  if (!rows) throw new Error("JSON 需為陣列，或含 rows 陣列");
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

export function parseDraftText(text: string, catalog: DraftCatalog[]): DraftImport {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("檔案是空的");
  const records = trimmed.startsWith("{") || trimmed.startsWith("[") ? rowsFromJson(trimmed) : rowsFromCsv(trimmed);
  const byKey = new Map(catalog.map((country) => [country.key, country.key]));
  const byZh = new Map(catalog.map((country) => [country.zh, country.key]));
  const byEn = new Map(catalog.map((country) => [country.en.toLowerCase(), country.key]));
  const patch: DraftPatch = {};
  const skipped: string[] = [];
  let applied = 0;

  records.forEach((raw, index) => {
    const record: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(raw)) {
      const column = columnName(name);
      if (column) record[column] = value;
    }
    const keyRaw = String(record.key ?? "").trim();
    const zh = String(record.zh ?? "").trim();
    const en = String(record.en ?? "").trim();
    const key = byKey.get(keyRaw.padStart(3, "0")) ?? byKey.get(keyRaw) ?? byZh.get(zh) ?? byEn.get(en.toLowerCase());
    if (!key) {
      skipped.push(`第 ${index + 1} 筆找不到國家`);
      return;
    }
    const values: Partial<Record<MetricId, number | null>> = {};
    let touched = false;
    for (const id of METRIC_IDS) {
      if (!(id in record)) continue;
      values[id] = parseNumber(record[id]);
      touched = true;
    }
    if (!touched) {
      skipped.push(`第 ${index + 1} 筆沒有指標欄`);
      return;
    }
    patch[key] = values;
    applied += 1;
  });

  if (applied === 0) throw new Error(skipped[0] ?? "沒有可套用的資料列");
  return { patch, applied, skipped };
}

export function mergeDraft(base: DraftValues, patch: DraftPatch): DraftValues {
  const next: DraftValues = {};
  for (const [key, values] of Object.entries(base)) next[key] = { ...values };
  for (const [key, values] of Object.entries(patch)) {
    const current = { ...(next[key] ?? emptyValues()) };
    for (const id of METRIC_IDS) {
      if (id in values) current[id] = values[id] ?? null;
    }
    next[key] = current;
  }
  return next;
}
