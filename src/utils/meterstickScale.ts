import type { Meterstick, MeterstickPoint } from '../types';

export interface MeterstickSegmentInfo {
  centerX: number;
  pixelsPerMeter: number;
  meters: number;
}

function segmentPixelSpan(a: MeterstickPoint, b: MeterstickPoint): number {
  return Math.abs(b.x - a.x);
}

export function defaultMeterstickPoints(stick: Meterstick): MeterstickPoint[] {
  return [
    { x: stick.x, y: stick.y },
    { x: stick.x + stick.length, y: stick.y },
  ];
}

export function defaultSegmentMeters(pointCount: number): number[] {
  return Array(Math.max(0, pointCount - 1)).fill(1);
}

export function normalizeSegmentMeters(pointCount: number, meters?: number[]): number[] {
  const need = Math.max(0, pointCount - 1);
  const base = (meters ?? []).slice(0, need).map((m) => (m > 0 ? m : 1));
  while (base.length < need) base.push(1);
  return base;
}

export function horizontalizeMeterstickPoints(points: MeterstickPoint[]): MeterstickPoint[] {
  if (points.length === 0) return points;
  const y = points[0].y;
  return points.map((p) => ({ x: p.x, y }));
}

export function meterstickFromPoints(
  points: MeterstickPoint[],
  segmentMeters?: number[]
): Meterstick {
  const flat = horizontalizeMeterstickPoints(points);
  if (flat.length < 2) {
    return { x: 80, y: 680, length: 160 };
  }
  const px = segmentPixelSpan(flat[0], flat[1]);
  const meters = normalizeSegmentMeters(flat.length, segmentMeters);
  const m0 = meters[0] > 0 ? meters[0] : 1;
  return {
    x: flat[0].x,
    y: flat[0].y,
    length: px > 0 ? px / m0 : 160,
  };
}

export function formatSegmentMetersLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '1 m';
  const rounded = Math.round(meters * 10000) / 10000;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${text} m`;
}

export function parseSegmentMetersInput(raw: string): number | null {
  const stripped = raw.trim().replace(/m$/i, '').trim();
  const n = parseFloat(stripped);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function buildMeterstickSegments(
  points: MeterstickPoint[],
  segmentMeters?: number[]
): MeterstickSegmentInfo[] {
  const flat = horizontalizeMeterstickPoints(points);
  const meters = normalizeSegmentMeters(flat.length, segmentMeters);
  const segments: MeterstickSegmentInfo[] = [];
  for (let i = 0; i + 1 < flat.length; i++) {
    const a = flat[i];
    const b = flat[i + 1];
    const px = segmentPixelSpan(a, b);
    const m = meters[i];
    if (px <= 0 || m <= 0) continue;
    segments.push({
      centerX: (a.x + b.x) / 2,
      pixelsPerMeter: px / m,
      meters: m,
    });
  }
  return segments.sort((a, b) => a.centerX - b.centerX);
}

export function adjustSegmentMetersForPointChange(
  prevPoints: MeterstickPoint[],
  nextPoints: MeterstickPoint[],
  prevMeters: number[]
): number[] {
  const prev = horizontalizeMeterstickPoints(prevPoints);
  const next = horizontalizeMeterstickPoints(nextPoints);
  const prevM = normalizeSegmentMeters(prev.length, prevMeters);

  if (next.length === prev.length) return prevM;

  if (next.length === prev.length + 1) {
    let pi = 0;
    let ni = 0;
    while (pi < prev.length && ni < next.length) {
      if (prev[pi].x === next[ni].x && prev[pi].y === next[ni].y) {
        pi++;
        ni++;
      } else {
        break;
      }
    }
    const insertIdx = ni;
    if (insertIdx === 0) return [1, ...prevM];
    if (insertIdx >= prev.length) return [...prevM, 1];
    return [
      ...prevM.slice(0, insertIdx - 1),
      prevM[insertIdx - 1],
      1,
      ...prevM.slice(insertIdx),
    ];
  }

  if (next.length === prev.length - 1) {
    let pi = 0;
    let ni = 0;
    while (ni < next.length) {
      if (pi < prev.length && prev[pi].x === next[ni].x && prev[pi].y === next[ni].y) {
        pi++;
        ni++;
      } else {
        break;
      }
    }
    const delIdx = pi;
    if (delIdx === 0) return prevM.slice(1);
    if (delIdx >= prev.length - 1) return prevM.slice(0, -1);
    return [...prevM.slice(0, delIdx - 1), prevM[delIdx - 1], ...prevM.slice(delIdx + 1)];
  }

  return normalizeSegmentMeters(next.length, prevM);
}

/** Position-dependent pixel scale from horizontal meterstick segments. */
export class MeterstickScale {
  readonly points: MeterstickPoint[];
  readonly segmentMeters: number[];
  private readonly segments: MeterstickSegmentInfo[];

  constructor(points: MeterstickPoint[], segmentMeters?: number[]) {
    this.points = horizontalizeMeterstickPoints(points);
    this.segmentMeters = normalizeSegmentMeters(this.points.length, segmentMeters);
    this.segments = buildMeterstickSegments(this.points, this.segmentMeters);
  }

  static fromVideo(video: {
    meterstickPoints: MeterstickPoint[];
    meterstickSegmentMeters?: number[];
    meterstick?: Meterstick;
  }): MeterstickScale {
    const points =
      video.meterstickPoints.length >= 2
        ? video.meterstickPoints
        : video.meterstick
          ? defaultMeterstickPoints(video.meterstick)
          : defaultMeterstickPoints({ x: 80, y: 680, length: 160 });
    return new MeterstickScale(points, video.meterstickSegmentMeters);
  }

  getPixelsPerMeter(x: number): number {
    if (this.segments.length === 0) return 0;
    if (this.segments.length === 1) return this.segments[0].pixelsPerMeter;

    const left = this.segments[0];
    const right = this.segments[this.segments.length - 1];
    if (x <= left.centerX) return left.pixelsPerMeter;
    if (x >= right.centerX) return right.pixelsPerMeter;

    for (let i = 0; i < this.segments.length - 1; i++) {
      const a = this.segments[i];
      const b = this.segments[i + 1];
      if (x >= a.centerX && x <= b.centerX) {
        const span = b.centerX - a.centerX;
        if (span <= 0) return a.pixelsPerMeter;
        const t = (x - a.centerX) / span;
        return a.pixelsPerMeter + t * (b.pixelsPerMeter - a.pixelsPerMeter);
      }
    }

    return right.pixelsPerMeter;
  }

  yAtX(_x: number): number | null {
    if (this.points.length < 2) return null;
    return this.points[0].y;
  }

  isCalibrated(): boolean {
    return this.segments.length > 0 && this.segments.every((s) => s.pixelsPerMeter > 0);
  }

  ppmForPointPair(p1: { x: number }, p2: { x: number }): number {
    return this.getPixelsPerMeter((p1.x + p2.x) / 2);
  }
}

export type PixelsPerMeterFn = (x: number) => number;

export function scaleToPpmFn(scale: MeterstickScale): PixelsPerMeterFn {
  return (x) => scale.getPixelsPerMeter(x);
}
