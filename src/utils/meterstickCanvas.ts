import type { MeterstickPoint } from '../types';
import { formatSegmentMetersLabel, horizontalizeMeterstickPoints } from './meterstickScale';

export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { dist: number; t: number; x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    const dist = Math.hypot(px - ax, py - ay);
    return { dist, t: 0, x: ax, y: ay };
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { dist: Math.hypot(px - x, py - y), t, x, y };
}

export interface MultiStickHit {
  kind: 'point' | 'segment' | 'none';
  pointIndex: number | null;
  segmentIndex: number | null;
  projectedX: number;
  projectedY: number;
}

export function hitMultiMeterstick(mx: number, my: number, points: MeterstickPoint[]): MultiStickHit {
  const flat = horizontalizeMeterstickPoints(points);
  const none: MultiStickHit = {
    kind: 'none',
    pointIndex: null,
    segmentIndex: null,
    projectedX: mx,
    projectedY: my,
  };
  if (flat.length < 2) return none;

  const lineY = flat[0].y;

  for (let i = 0; i < flat.length; i++) {
    const p = flat[i];
    if (Math.hypot(mx - p.x, my - p.y) <= 14) {
      return {
        kind: 'point',
        pointIndex: i,
        segmentIndex: null,
        projectedX: p.x,
        projectedY: lineY,
      };
    }
  }

  if (Math.abs(my - lineY) > 22) return none;

  let best: MultiStickHit = none;
  let bestDist = 22;
  for (let i = 0; i + 1 < flat.length; i++) {
    const a = flat[i];
    const b = flat[i + 1];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    if (mx < minX - 14 || mx > maxX + 14) continue;
    const dist = Math.abs(my - lineY);
    if (dist < bestDist) {
      bestDist = dist;
      best = {
        kind: 'segment',
        pointIndex: null,
        segmentIndex: i,
        projectedX: Math.max(minX, Math.min(maxX, mx)),
        projectedY: lineY,
      };
    }
  }
  return best;
}

export function isNearMeterstick(mx: number, my: number, points: MeterstickPoint[]): boolean {
  return hitMultiMeterstick(mx, my, points).kind !== 'none';
}

export function insertPointOnSegment(
  points: MeterstickPoint[],
  segmentIndex: number,
  x: number,
  _y: number
): MeterstickPoint[] {
  const flat = horizontalizeMeterstickPoints(points);
  const lineY = flat[0]?.y ?? _y;
  const next = [...flat];
  next.splice(segmentIndex + 1, 0, { x, y: lineY });
  return next;
}

export function deleteMeterstickPoint(points: MeterstickPoint[], index: number): MeterstickPoint[] {
  const flat = horizontalizeMeterstickPoints(points);
  if (flat.length <= 2) return flat;
  return flat.filter((_, i) => i !== index);
}

export function translateMeterstickPoints(
  points: MeterstickPoint[],
  dx: number,
  dy: number
): MeterstickPoint[] {
  return horizontalizeMeterstickPoints(points.map((p) => ({ x: p.x + dx, y: p.y + dy })));
}

export function moveMeterstickPointX(
  points: MeterstickPoint[],
  index: number,
  x: number
): MeterstickPoint[] {
  const flat = horizontalizeMeterstickPoints(points);
  const lineY = flat[0].y;
  return flat.map((p, i) => (i === index ? { x, y: lineY } : p));
}

/** Returns segment index when (mx, my) hits a segment length label, else null. */
export function hitSegmentLabel(
  mx: number,
  my: number,
  points: MeterstickPoint[],
  segmentMeters: number[]
): number | null {
  const flat = horizontalizeMeterstickPoints(points);
  if (flat.length < 2) return null;
  const lineY = flat[0].y;
  const labelBaselineY = lineY - 12;
  for (let i = 0; i + 1 < flat.length; i++) {
    const a = flat[i];
    const b = flat[i + 1];
    const cx = (a.x + b.x) / 2;
    const label = formatSegmentMetersLabel(segmentMeters[i] ?? 1);
    const approxWidth = Math.max(36, label.length * 7.5);
    const halfW = approxWidth / 2;
    const top = labelBaselineY - 14;
    const bottom = labelBaselineY + 4;
    if (mx >= cx - halfW && mx <= cx + halfW && my >= top && my <= bottom) {
      return i;
    }
  }
  return null;
}
