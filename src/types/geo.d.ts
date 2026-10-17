declare module "d3-geo" {
  export function geoEqualEarth(): {
    fitExtent(extent: [[number, number], [number, number]], object: unknown): unknown;
  };
  export function geoGraticule10(): unknown;
  export function geoPath(projection?: unknown): {
    (object: unknown): string | null;
    bounds(object: unknown): [[number, number], [number, number]];
  };
}

declare module "topojson-client" {
  export function feature(topology: unknown, object: unknown): unknown;
}
