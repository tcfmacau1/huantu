import { geoEqualEarth, geoGraticule10, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import { countryRowByKey, type CountryRow } from "@/data/countries";
import { continentOf, type ContinentId } from "@/lib/atlas/continents";
import type { MetricId } from "@/data/metrics";

export const MAP_W = 960;
export const MAP_H = 520;

const HIDDEN = new Set(["010", "260"]);

const NAME_KEYS: Record<string, string> = {
  "N. Cyprus": "ncy",
  Somaliland: "sol",
  Kosovo: "xkx",
};

type AtlasFeature = {
  id?: string | number;
  properties?: { name?: string };
  type: "Feature";
  geometry: unknown;
};

type TopologyLike = {
  objects: { countries: object };
};

const topology = world as unknown as TopologyLike;
const collection = feature(
  world as never,
  topology.objects.countries as never,
) as unknown as { features: AtlasFeature[] };

function featureKey(item: AtlasFeature): string | null {
  if (item.id != null && String(item.id) !== "") {
    return String(item.id).padStart(3, "0");
  }
  const name = item.properties?.name;
  if (!name) return null;
  return NAME_KEYS[name] ?? null;
}

const visible = collection.features.filter((item) => {
  const key = featureKey(item);
  return key != null && !HIDDEN.has(key);
});

const projection = geoEqualEarth().fitExtent(
  [
    [8, 8],
    [MAP_W - 8, MAP_H - 8],
  ],
  { type: "FeatureCollection", features: visible } as never,
);

const path = geoPath(projection);

export const sphereD = path({ type: "Sphere" }) ?? "";
export const graticuleD = path(geoGraticule10()) ?? "";

export type CountryShape = {
  key: string;
  en: string;
  d: string;
  bounds: [[number, number], [number, number]];
};

export const shapes: CountryShape[] = visible.flatMap((item) => {
  const key = featureKey(item);
  const d = key ? path(item as never) : null;
  if (!key || !d) return [];
  return [
    {
      key,
      en: item.properties?.name ?? key,
      d,
      bounds: path.bounds(item as never) as [[number, number], [number, number]],
    },
  ];
});

export const shapeByKey = new Map(shapes.map((shape) => [shape.key, shape]));

export type AtlasCountry = {
  key: string;
  zh: string;
  en: string;
  region: string;
  continent: ContinentId | null;
  values: Record<MetricId, number | null>;
};

function fromRow(shape: CountryShape, row: CountryRow | undefined): AtlasCountry {
  const region = row?.region ?? "其他";
  return {
    key: shape.key,
    zh: row?.zh ?? shape.en,
    en: shape.en,
    region,
    continent: continentOf(region),
    values: row?.values ?? { hdi: null, life: null, gdp: null, net: null, renew: null, co2: null },
  };
}

export const countries: AtlasCountry[] = shapes.map((shape) =>
  fromRow(shape, countryRowByKey.get(shape.key)),
);

export const countryByKey = new Map(countries.map((country) => [country.key, country]));
