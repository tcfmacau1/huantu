export const CONTINENTS = [
  { id: "asia", label: "亞洲" },
  { id: "europe", label: "歐洲" },
  { id: "north-america", label: "北美洲" },
  { id: "south-america", label: "南美洲" },
  { id: "africa", label: "非洲" },
  { id: "oceania", label: "大洋洲" },
] as const;

export type ContinentId = (typeof CONTINENTS)[number]["id"];

const BY_REGION: Record<string, ContinentId> = {
  東亞: "asia",
  東南亞: "asia",
  南亞: "asia",
  西亞: "asia",
  中亞: "asia",
  歐洲: "europe",
  北美: "north-america",
  中美加勒比: "north-america",
  南美: "south-america",
  非洲: "africa",
  大洋洲: "oceania",
};

export function continentOf(region: string): ContinentId | null {
  return BY_REGION[region] ?? null;
}

export const REGIONS_BY_CONTINENT: Record<ContinentId, readonly string[]> = {
  asia: ["東亞", "東南亞", "南亞", "西亞", "中亞"],
  europe: ["歐洲"],
  "north-america": ["北美", "中美加勒比"],
  "south-america": ["南美"],
  africa: ["非洲"],
  oceania: ["大洋洲"],
};

export function regionsFor(id: ContinentId, present: Iterable<string>): string[] {
  const has = new Set(present);
  const ordered = REGIONS_BY_CONTINENT[id].filter((region) => has.has(region));
  for (const region of has) {
    if (continentOf(region) === id && !ordered.includes(region)) ordered.push(region);
  }
  return ordered.length > 1 ? ordered : [];
}

export function continentLabel(id: ContinentId): string {
  return CONTINENTS.find((item) => item.id === id)?.label ?? id;
}

export function placeLabel(region: string, continent: ContinentId | null): string {
  if (!continent) return region;
  const label = continentLabel(continent);
  return label === region ? label : `${label} · ${region}`;
}
