import type { TrajectoryPoint } from '../types';
import { isPlottedPoint, plottedPoints } from '../utils/trajectorySegments';
import type { PixelsPerMeterFn } from '../utils/meterstickScale';
import { deltaSeconds, elapsedSeconds } from '../utils/frameTiming';

export type PixelsPerMeterSource = number | PixelsPerMeterFn;

export function resolvePpm(source: PixelsPerMeterSource, x: number): number {
  return typeof source === 'function' ? source(x) : source;
}

export function ppmValid(source: PixelsPerMeterSource, sampleX = 0): boolean {
  return resolvePpm(source, sampleX) > 0;
}

export interface SimPoint {
  x: number; // meters from launch
  y: number; // meters above launch point
}

/** Speed (m/s) between two plotted points using pixel scale and video framerate. */
export function speedBetweenPoints(
  p1: TrajectoryPoint,
  p2: TrajectoryPoint,
  pixelsPerMeter: PixelsPerMeterSource,
  framerate: number,
  frameTimes?: number[]
): number | null {
  if (!isPlottedPoint(p1) || !isPlottedPoint(p2)) return null;
  const ppm = resolvePpm(pixelsPerMeter, (p1.x + p2.x) / 2);
  if (ppm <= 0) return null;
  const dt = deltaSeconds(frameTimes, framerate, p1.frame, p2.frame);
  if (dt === null) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  const distM = distPx / ppm;
  return distM / dt;
}

/** Launch angle (degrees from horizontal) from the first two plotted points. */
export function angleBetweenPoints(
  p1: TrajectoryPoint,
  p2: TrajectoryPoint,
  pixelsPerMeter: PixelsPerMeterSource,
  xdir: 1 | -1 = 1
): number | null {
  if (!isPlottedPoint(p1) || !isPlottedPoint(p2)) return null;
  const ppm = resolvePpm(pixelsPerMeter, (p1.x + p2.x) / 2);
  if (ppm <= 0) return null;
  if (p2.frame - p1.frame <= 0) return null;
  const physDx = (xdir * (p2.x - p1.x)) / ppm;
  const physDy = (p1.y - p2.y) / ppm;
  return Math.atan2(physDy, physDx) * (180 / Math.PI);
}

export const GRAVITY_MS2 = 9.81;
/** Max simulated flight time (seconds) for integrate-until-land or range checks. */
export const SIM_MAX_TIME = 10;
/** Fixed physics timestep (seconds); must match across simulateShot and fit. */
export const SIM_DT = 0.005;

export function resolveMagnusPower(magnusPower?: number): number {
  return magnusPower ?? 2;
}

/**
 * Shift each point upward by ½g·t² (t = elapsed time from the first point) to undo
 * gravitational sag. The first point is unchanged.
 */
export function gravityCorrectedPoints(
  points: TrajectoryPoint[],
  pixelsPerMeter: PixelsPerMeterSource,
  framerate: number,
  frameTimes?: number[]
): TrajectoryPoint[] {
  const plotted = plottedPoints(points);
  if (plotted.length === 0 || !ppmValid(pixelsPerMeter)) return [];
  if (!frameTimes?.length && framerate <= 0) return [];
  const sorted = [...plotted].sort((a, b) => a.frame - b.frame);
  const frame0 = sorted[0].frame;
  return sorted.map((pt, i) => {
    if (i === 0) return { ...pt };
    const t = elapsedSeconds(frameTimes, framerate, pt.frame, frame0);
    const ppm = resolvePpm(pixelsPerMeter, pt.x);
    const offsetPx = 0.5 * GRAVITY_MS2 * t * t * ppm;
    return { x: pt.x, y: pt.y - offsetPx, frame: pt.frame };
  });
}

function toPhysicalMeters(points: TrajectoryPoint[], pixelsPerMeter: PixelsPerMeterSource): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const p0 = points[0];
  return points.map((p) => {
    const ppm = resolvePpm(pixelsPerMeter, (p.x + p0.x) / 2);
    return {
      x: (p.x - p0.x) / ppm,
      y: (p0.y - p.y) / ppm,
    };
  });
}

/** R² of a linear fit (y ~ x) to points in physical coordinates. 1 = perfectly straight. */
export function lineFitR2(points: TrajectoryPoint[], pixelsPerMeter: PixelsPerMeterSource): number | null {
  if (points.length < 2 || !ppmValid(pixelsPerMeter)) return null;
  const phys = toPhysicalMeters(points, pixelsPerMeter);
  const n = phys.length;
  const xMean = phys.reduce((s, p) => s + p.x, 0) / n;
  const yMean = phys.reduce((s, p) => s + p.y, 0) / n;

  let sxx = 0;
  let sxy = 0;
  let ssTot = 0;
  for (const p of phys) {
    const dx = p.x - xMean;
    const dy = p.y - yMean;
    sxx += dx * dx;
    sxy += dx * dy;
    ssTot += dy * dy;
  }

  if (ssTot < 1e-18) return 1;

  let ssRes = 0;
  if (sxx < 1e-18) {
    const xVar = phys.reduce((s, p) => s + (p.x - xMean) ** 2, 0);
    return xVar < 1e-18 ? 1 : 0;
  }

  const m = sxy / sxx;
  const b = yMean - m * xMean;
  for (const p of phys) {
    const err = p.y - (m * p.x + b);
    ssRes += err * err;
  }
  return 1 - ssRes / ssTot;
}

/** Circumradius through three physical-space points (meters); null if nearly collinear. */
function circumradiusMeters(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): number | null {
  const a = Math.hypot(p2.x - p3.x, p2.y - p3.y);
  const b = Math.hypot(p1.x - p3.x, p1.y - p3.y);
  const c = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  const s = (a + b + c) / 2;
  const areaSq = s * (s - a) * (s - b) * (s - c);
  if (areaSq <= 1e-18) return null;
  return (a * b * c) / (4 * Math.sqrt(areaSq));
}

/** Mean circumradius over consecutive triplets; larger radius = straighter path. */
export function averageRadiusOfCurvature(
  points: TrajectoryPoint[],
  pixelsPerMeter: PixelsPerMeterSource
): number | null {
  if (points.length < 3 || !ppmValid(pixelsPerMeter)) return null;
  const phys = toPhysicalMeters(points, pixelsPerMeter);
  const radii: number[] = [];
  for (let i = 0; i < phys.length - 2; i++) {
    const r = circumradiusMeters(phys[i], phys[i + 1], phys[i + 2]);
    if (r !== null) radii.push(r);
  }
  if (radii.length === 0) return null;
  return radii.reduce((s, r) => s + r, 0) / radii.length;
}

export interface GravityCorrectionQuality {
  r2: number | null;
  avgRadiusOfCurvature: number | null;
}

/** Line-fit quality of gravity-corrected points used for exit estimates. */
export function gravityCorrectionQuality(
  points: TrajectoryPoint[],
  pixelsPerMeter: PixelsPerMeterSource,
  framerate: number,
  numPoints: number,
  frameTimes?: number[]
): GravityCorrectionQuality {
  const sorted = plottedPoints(points).sort((a, b) => a.frame - b.frame);
  const n = Math.max(2, Math.floor(numPoints));
  if (sorted.length < n || !ppmValid(pixelsPerMeter) || (!frameTimes?.length && framerate <= 0)) {
    return { r2: null, avgRadiusOfCurvature: null };
  }
  const corrected = gravityCorrectedPoints(
    sorted.slice(0, n),
    pixelsPerMeter,
    framerate,
    frameTimes
  );
  return {
    r2: lineFitR2(corrected, pixelsPerMeter),
    avgRadiusOfCurvature: averageRadiusOfCurvature(corrected, pixelsPerMeter),
  };
}

/** Each consecutive pair is weighted `ratio` times the next; normalized to sum to 1. */
export const EMPIRICAL_PAIR_WEIGHT_RATIO = 0.65;

export function geometricPairWeights(pairCount: number, ratio = EMPIRICAL_PAIR_WEIGHT_RATIO): number[] {
  if (pairCount <= 0) return [];
  if (pairCount === 1) return [1];
  const raw = Array.from({ length: pairCount }, (_, i) => ratio ** (pairCount - 1 - i));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/** Estimate exit speed/angle from the first N points using weighted consecutive pairs. */
export function empiricalFromPoints(
  points: TrajectoryPoint[],
  pixelsPerMeter: PixelsPerMeterSource,
  framerate: number,
  numPoints: number,
  xdir: 1 | -1 = 1,
  frameTimes?: number[],
  pairWeightRatio = EMPIRICAL_PAIR_WEIGHT_RATIO
): { speed: number | null; angle: number | null } {
  const sorted = plottedPoints(points).sort((a, b) => a.frame - b.frame);
  const n = Math.max(2, Math.floor(numPoints));
  if (sorted.length < n) return { speed: null, angle: null };

  const subset = sorted.slice(0, n);
  const corrected = gravityCorrectedPoints(subset, pixelsPerMeter, framerate, frameTimes);
  const pairCount = n - 1;
  const weights = geometricPairWeights(pairCount, pairWeightRatio);

  let speedSum = 0;
  let speedWeightSum = 0;
  let angleSum = 0;
  let angleWeightSum = 0;

  for (let i = 0; i < pairCount; i++) {
    const w = weights[i];
    const speed = speedBetweenPoints(corrected[i], corrected[i + 1], pixelsPerMeter, framerate, frameTimes);
    const angle = angleBetweenPoints(corrected[i], corrected[i + 1], pixelsPerMeter, xdir);
    if (speed !== null) {
      speedSum += w * speed;
      speedWeightSum += w;
    }
    if (angle !== null) {
      angleSum += w * angle;
      angleWeightSum += w;
    }
  }

  return {
    speed: speedWeightSum > 0 ? speedSum / speedWeightSum : null,
    angle: angleWeightSum > 0 ? angleSum / angleWeightSum : null,
  };
}

// Simulate projectile with drag (F = b * v^2) and Magnus perpendicular to velocity.
// Positive magnusGain = backspin (ω×v, spin axis out of screen); negative = topspin.
// Returns array of (x, y) in meters
export function simulateShot(
  exitVelocity: number,
  exitAngleDeg: number,
  dragCoefficient: number,
  magnusGain = 0,
  maxTime = SIM_MAX_TIME,
  dt = SIM_DT,
  magnusPower = 2,
  stopX?: number,
): SimPoint[] {
  const g = GRAVITY_MS2;
  const angleRad = (exitAngleDeg * Math.PI) / 180;

  let vx = exitVelocity * Math.cos(angleRad);
  let vy = exitVelocity * Math.sin(angleRad);
  let x = 0;
  let y = 0;

  const points: SimPoint[] = [{ x, y }];
  const shouldStopAtX = stopX !== undefined && Number.isFinite(stopX) && stopX > 0;

  for (let t = 0; t < maxTime; t += dt) {
    const prevX = x;
    const prevY = y;
    const v = Math.sqrt(vx * vx + vy * vy);
    const dragMag = dragCoefficient * v * v;
    const magnusMag = v > 0 ? magnusGain * v ** magnusPower : 0;
    const ax =
      v > 0 ? -(dragMag * (vx / v)) + magnusMag * (-vy / v) : 0;
    const ay =
      -g - (v > 0 ? dragMag * (vy / v) : 0) + (v > 0 ? magnusMag * (vx / v) : 0);

    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;

    if (shouldStopAtX && prevX < stopX && x >= stopX) {
      const u = (stopX - prevX) / (x - prevX || 1);
      points.push({ x: stopX, y: prevY + (y - prevY) * u });
      break;
    }

    points.push({ x, y });

    if (y < -1) break;
  }

  return points;
}

// Interpolate (x, y) from a fixed-dt simulation at time t (seconds).
// simPts[k] corresponds to t = k * dt. Returns null if t is past the flight.
export function interpSimAtTime(simPts: SimPoint[], t: number, dt = SIM_DT): SimPoint | null {
  if (t < 0) return null;
  const idx = t / dt;
  const i = Math.floor(idx);
  if (i >= simPts.length - 1) {
    return idx === simPts.length - 1 ? simPts[simPts.length - 1] : null;
  }
  const frac = idx - i;
  const a = simPts[i];
  const b = simPts[i + 1];
  return { x: a.x + frac * (b.x - a.x), y: a.y + frac * (b.y - a.y) };
}
