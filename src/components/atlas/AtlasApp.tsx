import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Compass,
  Download,
  MapPinned,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Upload,
  X,
} from "lucide-react";
import clsx from "clsx";
import { METRICS, formatMetric, metricById, type MetricId } from "@/data/metrics";
import { countries, type AtlasCountry } from "@/lib/atlas/world";
import { CONTINENTS, placeLabel, regionsFor, type ContinentId } from "@/lib/atlas/continents";
import { colorForValue, normalize, rampCss, valueAt } from "@/lib/atlas/scale";
import { WorldMap, type MapHandle } from "@/components/atlas/WorldMap";
import {
  downloadText,
  draftToCsv,
  mergeDraft,
  parseDraftText,
  sampleDraft,
  type DraftValues,
} from "@/lib/atlas/draft";

const DRAFT_KEY = "huantu-draft-v1";

const press =
  "transition-transform duration-150 ease-out active:not-disabled:scale-[0.96]";
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-9 shrink-0" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--color-surface-2)" stroke="var(--color-line)" />
      <path d="M16 5.5 19.2 16 16 14.2 12.8 16 Z" fill="var(--color-brass)" />
      <path d="M16 26.5 12.8 16 16 17.8 19.2 16 Z" fill="var(--color-muted)" />
    </svg>
  );
}

function MetricSwitcher({
  metric,
  onChange,
}: {
  metric: MetricId;
  onChange: (metric: MetricId) => void;
}) {
  return (
    <div role="radiogroup" aria-label="指標" className="no-scrollbar flex flex-nowrap gap-2 overflow-x-auto">
      {METRICS.map((item) => {
        const active = item.id === metric;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={item.label}
            onClick={() => onChange(item.id)}
            className={clsx(
              "h-11 shrink-0 rounded-full px-4 text-sm font-medium",
              press,
              focusRing,
              active ? "bg-brass text-brass-ink" : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {item.short}
          </button>
        );
      })}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={clsx(
        "flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-fg",
        press,
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

export function AtlasApp() {
  const [metric, setMetric] = useState<MetricId>("hdi");
  const [selectedKey, setSelectedKey] = useState<string | null>("156");
  const [query, setQuery] = useState("");
  const [continent, setContinent] = useState<ContinentId | "all">("all");
  const [region, setRegion] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"rank" | "detail" | null>(null);
  const [draft, setDraft] = useState<DraftValues | null>(null);
  const [note, setNote] = useState("匯出底稿後可用試算表修改，再匯入。空白儲存格代表無資料。");
  const mapRef = useRef<MapHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const meta = metricById(metric);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as DraftValues;
      if (!stored || typeof stored !== "object") return;
      setDraft(stored);
      setNote("已載入本機儲存的資料底稿。");
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  const liveCountries = useMemo(
    () =>
      countries.map((country) => ({
        ...country,
        values: { ...country.values, ...draft?.[country.key] },
      })),
    [draft],
  );
  const liveByKey = useMemo(
    () => new Map(liveCountries.map((country) => [country.key, country])),
    [liveCountries],
  );
  const ranges = useMemo(() => {
    const next = {} as Record<MetricId, { min: number; max: number }>;
    for (const item of METRICS) {
      const values = liveCountries
        .flatMap((country) => {
          const value = country.values[item.id];
          return value == null ? [] : [value];
        })
        .sort((a, b) => a - b);
      next[item.id] = { min: values[0] ?? 0, max: values[values.length - 1] ?? 1 };
    }
    return next;
  }, [liveCountries]);

  const stats = useMemo(() => {
    const ranked = liveCountries
      .flatMap((country) => {
        const value = country.values[metric];
        return value == null ? [] : [{ country, value }];
      })
      .sort((a, b) => b.value - a.value || a.country.zh.localeCompare(b.country.zh, "zh-Hant"));
    const asc = ranked.map((row) => row.value).sort((a, b) => a - b);
    const median =
      asc.length === 0
        ? 0
        : asc.length % 2 === 1
          ? asc[(asc.length - 1) / 2]
          : (asc[asc.length / 2 - 1] + asc[asc.length / 2]) / 2;
    return {
      ranked,
      min: asc[0] ?? 0,
      max: asc[asc.length - 1] ?? 1,
      median,
      total: ranked.length,
      rankByKey: new Map(ranked.map((row, index) => [row.country.key, index + 1])),
      top: ranked[0],
    };
  }, [metric, liveCountries]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let pool = liveCountries;
    if (continent !== "all") pool = pool.filter((country) => country.continent === continent);
    if (region) pool = pool.filter((country) => country.region === region);
    pool = q
      ? pool.filter(
          (country) =>
            country.zh.includes(query.trim()) ||
            country.en.toLowerCase().includes(q) ||
            country.region.includes(query.trim()) ||
            placeLabel(country.region, country.continent).includes(query.trim()),
        )
      : pool.filter((country) => country.values[metric] != null);
    return [...pool].sort((a, b) => {
      const av = a.values[metric];
      const bv = b.values[metric];
      if (av == null && bv == null) return a.zh.localeCompare(b.zh, "zh-Hant");
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av || a.zh.localeCompare(b.zh, "zh-Hant");
    });
  }, [metric, query, liveCountries, continent, region]);

  const regionOptions = useMemo(() => {
    if (continent === "all") return [];
    return regionsFor(
      continent,
      countries.filter((country) => country.continent === continent).map((country) => country.region),
    );
  }, [continent]);

  const selected = selectedKey ? (liveByKey.get(selectedKey) ?? null) : null;

  useEffect(() => {
    if (!selectedKey) return;
    document.querySelectorAll<HTMLElement>(`[data-rank="${selectedKey}"]`).forEach((node) => {
      if (node.offsetParent !== null) node.scrollIntoView({ block: "nearest" });
    });
  }, [selectedKey, metric, sheet, continent, region]);

  function fillFor(key: string) {
    const country = liveByKey.get(key);
    return colorForValue(country?.values[metric] ?? null, stats.min, stats.max, metric);
  }

  function persist(next: DraftValues, message: string) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    setDraft(next);
    setNote(message);
  }

  function editValue(key: string, id: MetricId, value: number | null) {
    const base = draft ?? sampleDraft(countries);
    const previous = base[key] ?? liveByKey.get(key)?.values;
    if (!previous) return;
    persist({ ...base, [key]: { ...previous, [id]: value } }, "已改底稿，地圖已更新。");
  }

  function exportDraft() {
    downloadText("huantu-draft.csv", draftToCsv(liveCountries), "text/csv;charset=utf-8");
    setNote("已匯出資料底稿。");
  }

  async function importDraft(file: File) {
    try {
      const result = parseDraftText(await file.text(), countries);
      const next = mergeDraft(draft ?? sampleDraft(countries), result.patch);
      const skipped = result.skipped.length ? `略過 ${result.skipped.length} 筆。` : "";
      persist(next, `已匯入 ${result.applied} 國。${skipped}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "無法讀取底稿");
    }
  }

  function resetDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setDraft(null);
    setNote("已還原內建範例。");
  }

  function focusPlaces(id: ContinentId, regionName: string | null) {
    const keys = countries
      .filter((country) => country.continent === id && (regionName == null || country.region === regionName))
      .map((country) => country.key);
    mapRef.current?.frameKeys(keys);
  }

  function pickContinent(id: ContinentId | "all") {
    setContinent(id);
    setRegion(null);
    if (id === "all") mapRef.current?.reset();
    else focusPlaces(id, null);
  }

  function pickRegion(name: string | null) {
    setRegion(name);
    if (continent !== "all") focusPlaces(continent, name);
  }

  function updateQuery(value: string) {
    setQuery(value);
    if (value.trim() && window.matchMedia("(max-width: 1279px)").matches) setSheet("rank");
  }

  function choose(key: string, fly: boolean) {
    setSelectedKey(key);
    if (fly) mapRef.current?.flyTo(key);
    if (window.matchMedia("(max-width: 1279px)").matches) setSheet("detail");
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="shrink-0 border-b border-line">
        <div className="flex items-center gap-4 px-4 py-3 xl:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Mark />
            <div className="min-w-0">
              <h1 className="font-display text-xl leading-none tracking-tight text-balance">寰圖</h1>
              <p className="mt-1 truncate text-xs text-muted">色階世界地圖</p>
            </div>
          </div>
          <div className="hidden min-w-0 flex-1 xl:block">
            <MetricSwitcher metric={metric} onChange={setMetric} />
          </div>
          <div className="ml-auto flex shrink-0 gap-2">
            <button
              type="button"
              aria-label="匯出資料底稿"
              onClick={exportDraft}
              className={clsx(
                "flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 text-sm text-fg",
                press,
                focusRing,
              )}
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">匯出</span>
            </button>
            <button
              type="button"
              aria-label="匯入資料底稿"
              onClick={() => fileRef.current?.click()}
              className={clsx(
                "flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 text-sm text-fg",
                press,
                focusRing,
              )}
            >
              <Upload className="size-4" />
              <span className="hidden sm:inline">匯入</span>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,.json,application/json"
            className="hidden"
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importDraft(file);
            }}
          />
        </div>
        <div className="px-4 pb-3 xl:hidden">
          <MetricSwitcher metric={metric} onChange={setMetric} />
        </div>
        <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5 xl:px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchField query={query} onQuery={updateQuery} className="w-full sm:w-60 sm:shrink-0" />
            <ContinentFilters continent={continent} onContinent={pickContinent} />
          </div>
          {regionOptions.length > 0 ? (
            <RegionFilters region={region} options={regionOptions} onRegion={pickRegion} />
          ) : null}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2">
          <p role="status" className="min-w-0 flex-1 truncate text-xs text-muted">
            {note}
          </p>
          {draft ? (
            <button
              type="button"
              onClick={resetDraft}
              className={clsx("shrink-0 text-xs text-brass", focusRing)}
            >
              還原範例
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-line xl:flex xl:flex-col">
          <RankList
            listRef={listRef}
            query={query}
            continent={continent}
            region={region}
            metric={metric}
            shown={shown}
            selectedKey={selectedKey}
            total={stats.total}
            fillFor={fillFor}
            onSelect={(key) => choose(key, true)}
          />
        </aside>

        <main className="relative min-w-0 flex-1">
          <WorldMap
            ref={mapRef}
            fillFor={fillFor}
            mutedFor={
              continent === "all"
                ? undefined
                : (key) => {
                    const country = liveByKey.get(key);
                    if (!country || country.continent !== continent) return true;
                    return region != null && country.region !== region;
                  }
            }
            selected={selectedKey}
            onSelect={(key) => choose(key, false)}
            tipFor={(key) => {
              const country = liveByKey.get(key);
              const value = country?.values[metric] ?? null;
              const rank = stats.rankByKey.get(key);
              return {
                title: country?.zh ?? key,
                subtitle: country ? `${country.en} · ${placeLabel(country.region, country.continent)}` : "",
                value: value == null ? "無資料" : formatMetric(metric, value),
                note:
                  value == null
                    ? meta.label
                    : rank
                      ? `第 ${rank} 名 · 共 ${stats.total} 國`
                      : meta.label,
              };
            }}
          />
          <div className="absolute top-3 right-3 flex flex-col gap-2">
            <IconButton label="放大" onClick={() => mapRef.current?.zoomBy(1.35)}>
              <Plus className="size-5" />
            </IconButton>
            <IconButton label="縮小" onClick={() => mapRef.current?.zoomBy(1 / 1.35)}>
              <Minus className="size-5" />
            </IconButton>
            <IconButton label="重設視野" onClick={() => mapRef.current?.reset()}>
              <RotateCcw className="size-5" />
            </IconButton>
          </div>
          <Legend metaLabel={meta.label} hint={meta.hint} min={stats.min} max={stats.max} metric={metric} />
        </main>

        <aside className="hidden w-80 shrink-0 border-l border-line xl:block">
          <Detail
            country={selected}
            metric={metric}
            stats={stats}
            onMetric={setMetric}
            onFly={() => selected && mapRef.current?.flyTo(selected.key)}
            onOpenTop={() => stats.top && choose(stats.top.country.key, true)}
            ranges={ranges}
            onEdit={editValue}
          />
        </aside>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-line p-2 xl:hidden">
        <button
          type="button"
          onClick={() => setSheet("rank")}
          className={clsx("h-11 flex-1 rounded-xl bg-surface-2 text-sm font-medium text-fg", press, focusRing)}
        >
          排行
        </button>
        <button
          type="button"
          onClick={() => selected && setSheet("detail")}
          disabled={!selected}
          className={clsx(
            "h-11 min-w-0 flex-[1.4] truncate rounded-xl bg-surface-2 px-3 text-sm font-medium text-fg disabled:text-faint",
            press,
            focusRing,
          )}
        >
          {selected ? selected.zh : "尚未選擇"}
        </button>
      </div>

      {sheet ? (
        <div className="fixed inset-0 z-40 xl:hidden">
          <button type="button" className="absolute inset-0 bg-bg/70" aria-label="關閉面板" onClick={() => setSheet(null)} />
          <div className="panel-shadow absolute inset-x-0 bottom-0 flex max-h-[62dvh] flex-col rounded-t-2xl border border-line bg-surface">
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-medium text-fg">{sheet === "rank" ? "國家排行" : "國家詳細"}</p>
              <button
                type="button"
                onClick={() => setSheet(null)}
                className={clsx("flex size-11 items-center justify-center rounded-xl text-muted", press, focusRing)}
                aria-label="關閉"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {sheet === "rank" ? (
                <RankList
                  listRef={listRef}
                  query={query}
                  continent={continent}
                  region={region}
                  metric={metric}
                  shown={shown}
                  selectedKey={selectedKey}
                  total={stats.total}
                  fillFor={fillFor}
                  onSelect={(key) => choose(key, true)}
                />
              ) : (
                <Detail
                  country={selected}
                  metric={metric}
                  stats={stats}
                  onMetric={setMetric}
                  onFly={() => {
                    if (!selected) return;
                    mapRef.current?.flyTo(selected.key);
                    setSheet(null);
                  }}
                  onOpenTop={() => stats.top && choose(stats.top.country.key, true)}
                  ranges={ranges}
                  onEdit={editValue}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SearchField({
  query,
  onQuery,
  className,
}: {
  query: string;
  onQuery: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={clsx("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="搜尋國家"
        aria-label="搜尋國家"
        className={clsx(
          "h-11 w-full rounded-xl border border-line bg-surface-2 pr-10 pl-10 text-sm text-fg placeholder:text-muted",
          focusRing,
        )}
        suppressHydrationWarning
      />
      {query ? (
        <button
          type="button"
          aria-label="清除搜尋"
          onClick={() => onQuery("")}
          className={clsx(
            "absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted",
            press,
          )}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function ContinentFilters({
  continent,
  onContinent,
}: {
  continent: ContinentId | "all";
  onContinent: (value: ContinentId | "all") => void;
}) {
  return (
    <div role="radiogroup" aria-label="洲別" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
      {([{ id: "all", label: "全部" }, ...CONTINENTS] as const).map((item) => {
        const active = item.id === continent;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onContinent(item.id)}
            className={clsx(
              "h-11 rounded-full px-3 text-sm font-medium",
              press,
              focusRing,
              active ? "bg-brass text-brass-ink" : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function RegionFilters({
  region,
  options,
  onRegion,
}: {
  region: string | null;
  options: string[];
  onRegion: (region: string | null) => void;
}) {
  const items = [{ id: "all", label: "全洲" }, ...options.map((name) => ({ id: name, label: name }))];
  return (
    <div role="radiogroup" aria-label="分區" className="flex flex-wrap items-center gap-1.5">
      <span className="pr-1 text-xs text-faint">分區</span>
      {items.map((item) => {
        const active = item.id === "all" ? region == null : item.id === region;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onRegion(item.id === "all" ? null : item.id)}
            className={clsx(
              "h-11 rounded-full px-3 text-sm font-medium",
              press,
              focusRing,
              active ? "bg-brass text-brass-ink" : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function Legend({
  metaLabel,
  hint,
  min,
  max,
  metric,
}: {
  metaLabel: string;
  hint: string;
  min: number;
  max: number;
  metric: MetricId;
}) {
  const mid = valueAt(0.5, min, max, metric);
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 w-44 rounded-2xl border border-line bg-surface p-2.5 xl:w-52 xl:p-3">
      <p className="text-sm font-medium text-fg">{metaLabel}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-snug text-pretty text-muted xl:line-clamp-none">{hint}</p>
      <div className="mt-2.5 h-2 rounded-full" style={{ background: rampCss() }} />
      <div className="mt-1.5 flex justify-between gap-1 text-xs tabular-nums text-faint">
        <span>{formatMetric(metric, min)}</span>
        <span className="hidden sm:inline">{formatMetric(metric, mid)}</span>
        <span>{formatMetric(metric, max)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span className="size-3 rounded-sm bg-nodata" />
        無資料
      </div>
      <p className="mt-2 hidden text-xs text-faint sm:block">拖曳平移 · 滾輪或雙指縮放</p>
    </div>
  );
}

function RankList({
  listRef,
  query,
  continent,
  region,
  metric,
  shown,
  selectedKey,
  total,
  fillFor,
  onSelect,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  query: string;
  continent: ContinentId | "all";
  region: string | null;
  metric: MetricId;
  shown: AtlasCountry[];
  selectedKey: string | null;
  total: number;
  fillFor: (key: string) => string;
  onSelect: (key: string) => void;
}) {
  const scope = region ?? (continent === "all" ? null : CONTINENTS.find((item) => item.id === continent)?.label);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-3 pt-3 pb-1 text-xs text-faint">
        {query
          ? `${shown.length} 個結果${scope ? ` · ${scope}` : ""}`
          : scope
            ? `${shown.length} 國 · ${scope} · 由高到低`
            : `${total} 國有資料 · 由高到低`}
      </p>
      <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 ? (
          <p className="px-2 py-6 text-sm text-muted">沒有符合的國家。</p>
        ) : (
          <ol>
            {shown.map((country) => {
              const value = country.values[metric];
              const active = country.key === selectedKey;
              return (
                <li key={country.key}>
                  <button
                    data-rank={country.key}
                    type="button"
                    onClick={() => onSelect(country.key)}
                    className={clsx(
                      "relative flex h-11 w-full items-center gap-2 rounded-lg px-2 text-left",
                      press,
                      focusRing,
                      active ? "bg-surface-2" : "hover:bg-surface-2",
                    )}
                  >
                    {active ? <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-brass" /> : null}
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: fillFor(country.key) }} />
                    <span className={clsx("min-w-0 flex-1 truncate text-sm", active ? "text-fg" : "text-muted")}>
                      {country.zh}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-fg">
                      {value == null ? "—" : formatMetric(metric, value)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <p className="px-2 pt-3 text-xs leading-relaxed text-faint">範例資料，約當 2023 年，僅供介面示範。</p>
      </div>
    </div>
  );
}

type Stats = {
  min: number;
  max: number;
  median: number;
  total: number;
  rankByKey: Map<string, number>;
  top?: { country: AtlasCountry; value: number };
};

function ValueField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      aria-label={`${label}數值`}
      inputMode="decimal"
      value={text ?? (value == null ? "" : String(value))}
      placeholder="無"
      onFocus={() => setText(value == null ? "" : String(value))}
      onBlur={(event) => {
        const raw = event.currentTarget.value.trim();
        setText(null);
        if (raw === "") {
          if (value != null) onCommit(null);
          return;
        }
        const next = Number(raw.replaceAll(",", ""));
        if (Number.isFinite(next) && next !== value) onCommit(next);
      }}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={clsx(
        "h-11 w-24 shrink-0 rounded-lg border border-line bg-bg px-2 text-right text-xs tabular-nums text-fg placeholder:text-faint",
        focusRing,
      )}
      suppressHydrationWarning
    />
  );
}

function Detail({
  country,
  metric,
  stats,
  onMetric,
  onFly,
  onOpenTop,
  ranges,
  onEdit,
}: {
  country: AtlasCountry | null;
  metric: MetricId;
  stats: Stats;
  onMetric: (metric: MetricId) => void;
  onFly: () => void;
  onOpenTop: () => void;
  ranges: Record<MetricId, { min: number; max: number }>;
  onEdit: (key: string, metric: MetricId, value: number | null) => void;
}) {
  if (!country) {
    const top = stats.top;
    return (
      <div className="flex h-full flex-col justify-between p-5">
        <div>
          <Compass className="size-6 text-brass" />
          <h2 className="mt-4 font-display text-3xl leading-tight text-balance">選擇一個國家</h2>
          <p className="mt-2 text-sm leading-relaxed text-pretty text-muted">
            點地圖上的國界，或從排行挑選。拖曳可平移，滾輪與雙擊可放大。
          </p>
        </div>
        {top ? (
          <button
            type="button"
            onClick={onOpenTop}
            className={clsx("mt-6 rounded-2xl border border-line bg-surface-2 p-4 text-left", press, focusRing)}
          >
            <p className="text-xs text-faint">此指標目前最高</p>
            <p className="mt-1 font-display text-2xl text-fg">{top.country.zh}</p>
            <p className="mt-1 text-sm tabular-nums text-brass">{formatMetric(metric, top.value)}</p>
          </button>
        ) : null}
      </div>
    );
  }

  const value = country.values[metric];
  const rank = stats.rankByKey.get(country.key);
  const t = value == null ? 0 : normalize(value, stats.min, stats.max, metric);
  const medianT = normalize(stats.median, stats.min, stats.max, metric);
  const meta = metricById(metric);

  return (
    <div key={`${country.key}-${metric}`} className="scroll-thin detail-in h-full overflow-y-auto p-5">
      <p className="text-xs text-brass">{placeLabel(country.region, country.continent)}</p>
      <h2 className="mt-1 font-display text-4xl leading-tight text-balance text-fg">{country.zh}</h2>
      <p className="mt-1 text-sm text-muted">{country.en}</p>

      <p className="mt-6 text-sm text-muted">{meta.label}</p>
      <p className="mt-1 font-display text-5xl tabular-nums leading-none text-fg">
        {value == null ? "—" : formatMetric(metric, value)}
      </p>
      <p className="mt-2 text-sm text-muted">{value == null ? "此指標沒有資料" : meta.unit}</p>

      {value != null && rank ? (
        <p className="mt-4 text-sm text-fg">
          第 {rank} 名
          <span className="text-muted"> · 共 {stats.total} 國</span>
        </p>
      ) : null}

      {value != null ? (
        <div className="mt-4">
          <div className="relative h-1.5 rounded-full bg-bg">
            <div className="h-full rounded-full bg-brass" style={{ width: `${t * 100}%` }} />
            <span
              className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-fg"
              style={{ left: `${medianT * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-faint">
            短線是中位數 {formatMetric(metric, stats.median)}
            {value >= stats.median ? " · 高於或等於中位數" : " · 低於中位數"}
          </p>
        </div>
      ) : null}

      <div className="mt-6 border-t border-line pt-4">
        <p className="text-xs text-faint">全部指標</p>
        <ul className="mt-2">
          {METRICS.map((item) => {
            const itemValue = country.values[item.id];
            const active = item.id === metric;
            return (
              <li key={item.id} className={clsx("flex h-11 items-center gap-2 rounded-lg px-1", active && "bg-surface-2")}>
                <button
                  type="button"
                  onClick={() => onMetric(item.id)}
                  className={clsx("flex min-w-0 flex-1 items-center gap-3 text-left", press, focusRing)}
                >
                  <span className={clsx("w-20 shrink-0 text-sm", active ? "text-fg" : "text-muted")}>
                    {item.short}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block h-1 rounded-full bg-bg">
                      <span
                        className="block h-full rounded-full bg-brass"
                        style={{
                          width:
                            itemValue == null
                              ? "0%"
                              : `${normalize(itemValue, ranges[item.id].min, ranges[item.id].max, item.id) * 100}%`,
                        }}
                      />
                    </span>
                  </span>
                </button>
                <ValueField
                  label={item.label}
                  value={itemValue}
                  onCommit={(next) => onEdit(country.key, item.id, next)}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        onClick={onFly}
        className={clsx(
          "mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 text-sm font-medium text-fg",
          press,
          focusRing,
        )}
      >
        <MapPinned className="size-4 text-brass" />
        在地圖上顯示
      </button>
      <p className="mt-4 text-xs leading-relaxed text-faint">
        右側可直接改數字。匯出的 CSV 是同一份底稿，空白儲存格代表無資料。
      </p>
    </div>
  );
}
