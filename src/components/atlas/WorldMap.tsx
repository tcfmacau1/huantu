import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { MAP_H, MAP_W, graticuleD, shapeByKey, shapes, sphereD } from "@/lib/atlas/world";

export type MapHandle = {
  zoomBy: (factor: number) => void;
  reset: () => void;
  flyTo: (key: string) => void;
  frameKeys: (keys: string[]) => void;
};

type Tip = { title: string; subtitle: string; value: string; note: string };

type Cam = { x: number; y: number; k: number };

type Props = {
  ref?: Ref<MapHandle>;
  fillFor: (key: string) => string;
  mutedFor?: (key: string) => boolean;
  selected: string | null;
  tipFor: (key: string) => Tip;
  onSelect: (key: string) => void;
};

const MIN_K = 1;
const MAX_K = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function zoomAt(cam: Cam, px: number, py: number, nextK: number): Cam {
  const k = clamp(nextK, MIN_K, MAX_K);
  const wx = (px - cam.x) / cam.k;
  const wy = (py - cam.y) / cam.k;
  return { k, x: px - k * wx, y: py - k * wy };
}

function frameOf(bounds: [[number, number], [number, number]], fill = 0.62): Cam {
  const [[x0, y0], [x1, y1]] = bounds;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const dx = Math.max(x1 - x0, 8);
  const dy = Math.max(y1 - y0, 8);
  const k = clamp(fill / Math.max(dx / MAP_W, dy / MAP_H), MIN_K, 6);
  return { k, x: MAP_W / 2 - k * cx, y: MAP_H / 2 - k * cy };
}

function boundsOf(keys: string[]): [[number, number], [number, number]] | null {
  const boxes = keys.flatMap((key) => {
    const shape = shapeByKey.get(key);
    return shape ? [shape.bounds] : [];
  });
  if (boxes.length === 0) return null;
  const compact = boxes.filter((box) => box[1][0] - box[0][0] <= MAP_W * 0.45);
  const use = compact.length > 0 ? compact : boxes;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [[left, top], [right, bottom]] of use) {
    x0 = Math.min(x0, left);
    y0 = Math.min(y0, top);
    x1 = Math.max(x1, right);
    y1 = Math.max(y1, bottom);
  }
  return [
    [x0, y0],
    [x1, y1],
  ];
}

export function WorldMap({ ref, fillFor, mutedFor, selected, tipFor, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const camRef = useRef<Cam>({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });
  const pinch = useRef<{ dist: number; wx: number; wy: number } | null>(null);
  const raf = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipKey, setTipKey] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);

  function apply(cam = camRef.current) {
    groupRef.current?.setAttribute("transform", `translate(${cam.x} ${cam.y}) scale(${cam.k})`);
  }

  function clientToUser(cx: number, cy: number) {
    const svg = svgRef.current;
    if (!svg) return { x: cx, y: cy };
    const point = svg.createSVGPoint();
    point.x = cx;
    point.y = cy;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: cx, y: cy };
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  function cancelAnim() {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }

  function animateTo(target: Cam) {
    cancelAnim();
    const from = { ...camRef.current };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      camRef.current = target;
      apply();
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - started) / 460);
      const eased = 1 - (1 - u) ** 3;
      camRef.current = {
        k: from.k + (target.k - from.k) * eased,
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
      };
      apply();
      if (u < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }

  useImperativeHandle(ref, () => ({
    zoomBy(factor: number) {
      const cam = camRef.current;
      animateTo(zoomAt(cam, MAP_W / 2, MAP_H / 2, cam.k * factor));
    },
    reset() {
      animateTo({ x: 0, y: 0, k: 1 });
    },
    flyTo(key: string) {
      const shape = shapeByKey.get(key);
      if (!shape) return;
      animateTo(frameOf(shape.bounds));
    },
    frameKeys(keys: string[]) {
      const bounds = boundsOf(keys);
      if (!bounds) return;
      animateTo(frameOf(bounds, 0.8));
    },
  }));

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelAnim();
      let dy = event.deltaY;
      if (event.deltaMode === 1) dy *= 16;
      if (event.deltaMode === 2) dy *= MAP_H;
      const at = clientToUser(event.clientX, event.clientY);
      camRef.current = zoomAt(camRef.current, at.x, at.y, camRef.current.k * Math.exp(-dy * 0.0016));
      apply();
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", onWheel);
      cancelAnim();
    };
  }, []);

  function placeTip(x: number, y: number) {
    const el = tipRef.current;
    if (!el) return;
    const pad = 12;
    const rect = el.getBoundingClientRect();
    let left = x + 16;
    let top = y + 16;
    if (left + rect.width > window.innerWidth - pad) left = x - rect.width - 16;
    if (top + rect.height > window.innerHeight - pad) top = y - rect.height - 12;
    el.style.transform = `translate3d(${Math.max(pad, left)}px, ${Math.max(pad, top)}px, 0)`;
  }

  useLayoutEffect(() => {
    if (tipKey) placeTip(pointer.current.x, pointer.current.y);
  }, [tipKey]);

  function showTip(key: string | null, event?: ReactPointerEvent) {
    if (event?.pointerType === "touch") return;
    if (event) pointer.current = { x: event.clientX, y: event.clientY };
    setTipKey(key);
    if (key && event) placeTip(event.clientX, event.clientY);
  }

  const tip = tipKey ? tipFor(tipKey) : null;
  const selectedShape = selected ? shapeByKey.get(selected) : undefined;
  const hoverShape = tipKey ? shapeByKey.get(tipKey) : undefined;

  return (
    <div className="relative h-full min-h-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className={`h-full w-full touch-none select-none ${panning ? "map-panning" : ""}`}
        role="application"
        aria-label="世界色階地圖。拖曳可平移，滾輪或雙指可縮放。"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          cancelAnim();
          svgRef.current?.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          gesture.current = {
            moved: false,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
          };
          if (pointers.current.size === 2) {
            const pts = [...pointers.current.values()];
            const mid = clientToUser((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
            const cam = camRef.current;
            pinch.current = {
              dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
              wx: (mid.x - cam.x) / cam.k,
              wy: (mid.y - cam.y) / cam.k,
            };
          }
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) {
            if (tipKey && event.pointerType !== "touch") {
              pointer.current = { x: event.clientX, y: event.clientY };
              placeTip(event.clientX, event.clientY);
            }
            return;
          }
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const pts = [...pointers.current.values()];
          if (pts.length >= 2 && pinch.current) {
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
            const mid = clientToUser((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
            const k = clamp(camRef.current.k * (dist / pinch.current.dist), MIN_K, MAX_K);
            pinch.current = { ...pinch.current, dist };
            camRef.current = {
              k,
              x: mid.x - k * pinch.current.wx,
              y: mid.y - k * pinch.current.wy,
            };
            gesture.current.moved = true;
            setPanning(true);
            apply();
            return;
          }
          const travel = Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY);
          if (travel < 5) return;
          gesture.current.moved = true;
          setPanning(true);
          const before = clientToUser(gesture.current.lastX, gesture.current.lastY);
          const after = clientToUser(event.clientX, event.clientY);
          camRef.current = {
            ...camRef.current,
            x: camRef.current.x + (after.x - before.x),
            y: camRef.current.y + (after.y - before.y),
          };
          gesture.current.lastX = event.clientX;
          gesture.current.lastY = event.clientY;
          apply();
        }}
        onPointerUp={(event) => {
          const moved = gesture.current.moved;
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (pointers.current.size === 0) setPanning(false);
          if (moved) return;
          const hit = document.elementFromPoint(event.clientX, event.clientY);
          const key = hit?.getAttribute("data-key");
          if (key) onSelect(key);
        }}
        onPointerCancel={() => {
          pointers.current.clear();
          pinch.current = null;
          setPanning(false);
        }}
        onPointerLeave={() => {
          if (pointers.current.size === 0) showTip(null);
        }}
        onDoubleClick={(event) => {
          const at = clientToUser(event.clientX, event.clientY);
          animateTo(zoomAt(camRef.current, at.x, at.y, camRef.current.k * 1.7));
        }}
      >
        <path d={sphereD} fill="var(--color-ocean)" />
        <path
          d={graticuleD}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={0.7}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        <g ref={groupRef}>
          {shapes.map((shape) => (
            <path
              key={shape.key}
              data-key={shape.key}
              d={shape.d}
              className="land"
              fill={fillFor(shape.key)}
              style={mutedFor?.(shape.key) ? { opacity: 0.28 } : undefined}
              stroke="var(--color-coast)"
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
              role="button"
              tabIndex={-1}
              aria-label={tipFor(shape.key).title}
              onPointerEnter={(event) => showTip(shape.key, event)}
              onPointerLeave={(event) => {
                if (event.pointerType !== "touch") showTip(null);
              }}
            />
          ))}
          {hoverShape && hoverShape.key !== selected ? (
            <path
              d={hoverShape.d}
              fill="var(--color-fg)"
              fillOpacity={0.08}
              stroke="var(--color-brass)"
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
          {selectedShape ? (
            <>
              <path
                d={selectedShape.d}
                fill="none"
                stroke="var(--color-bg)"
                strokeWidth={5}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              <path
                d={selectedShape.d}
                fill="none"
                stroke="var(--color-brass)"
                strokeWidth={2.25}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            </>
          ) : null}
        </g>
      </svg>
      <div
        ref={tipRef}
        className={`panel-shadow pointer-events-none fixed top-0 left-0 z-50 w-52 rounded-xl border border-line bg-surface px-3 py-2.5 transition-opacity duration-150 ${tip ? "opacity-100" : "opacity-0"}`}
        aria-hidden={!tip}
      >
        {tip ? (
          <>
            <p className="font-display text-lg leading-tight text-fg">{tip.title}</p>
            <p className="text-xs text-faint">{tip.subtitle}</p>
            <p className="mt-2 font-display text-2xl tabular-nums leading-none text-brass">{tip.value}</p>
            <p className="mt-1 text-xs text-muted">{tip.note}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
