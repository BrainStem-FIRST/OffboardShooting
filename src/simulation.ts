import type { GeneratedTrajectory, TrajGenParams, TrajectoryPoint, TrajGroup } from './types';
import { isPlottedPoint, plottedPoints } from './utils/trajectorySegments';
import type { PixelsPerMeterFn } from './utils/meterstickScale';
import { buildStoreZip } from './utils/zipStore';

export type PixelsPerMeterSource = number | PixelsPerMeterFn;

function resolvePpm(source: PixelsPerMeterSource, x: number): number {
  return typeof source === 'function' ? source(x) : source;
}

function ppmValid(source: PixelsPerMeterSource, sampleX = 0): boolean {
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
  framerate: number
): number | null {
  if (!isPlottedPoint(p1) || !isPlottedPoint(p2)) return null;
  const ppm = resolvePpm(pixelsPerMeter, (p1.x + p2.x) / 2);
  if (ppm <= 0 || framerate <= 0) return null;
  const frameDelta = p2.frame - p1.frame;
  if (frameDelta <= 0) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  const distM = distPx / ppm;
  const dt = frameDelta / framerate;
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

/**
 * Shift each point upward by ½g·t² (t = elapsed time from the first point) to undo
 * gravitational sag. The first point is unchanged.
 */
export function gravityCorrectedPoints(
  points: TrajectoryPoint[],
  pixelsPerMeter: PixelsPerMeterSource,
  framerate: number
): TrajectoryPoint[] {
  const plotted = plottedPoints(points);
  if (plotted.length === 0 || !ppmValid(pixelsPerMeter) || framerate <= 0) return [];
  const sorted = [...plotted].sort((a, b) => a.frame - b.frame);
  const frame0 = sorted[0].frame;
  return sorted.map((pt, i) => {
    if (i === 0) return { ...pt };
    const t = (pt.frame - frame0) / framerate;
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
  numPoints: number
): GravityCorrectionQuality {
  const sorted = plottedPoints(points).sort((a, b) => a.frame - b.frame);
  const n = Math.max(2, Math.floor(numPoints));
  if (sorted.length < n || !ppmValid(pixelsPerMeter) || framerate <= 0) {
    return { r2: null, avgRadiusOfCurvature: null };
  }
  const corrected = gravityCorrectedPoints(
    sorted.slice(0, n),
    pixelsPerMeter,
    framerate
  );
  return {
    r2: lineFitR2(corrected, pixelsPerMeter),
    avgRadiusOfCurvature: averageRadiusOfCurvature(corrected, pixelsPerMeter),
  };
}

/** Normalized weights favoring earlier consecutive pairs (first pair highest). */
export function decreasingPairWeights(pairCount: number): number[] {
  if (pairCount <= 0) return [];
  if (pairCount === 1) return [1];
  const raw = Array.from({ length: pairCount }, (_, i) => (pairCount - i) ** 2);
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/** Estimate exit speed/angle from the first N points using weighted consecutive pairs. */
export function empiricalFromPoints(
  points: TrajectoryPoint[],
  pixelsPerMeter: PixelsPerMeterSource,
  framerate: number,
  numPoints: number,
  xdir: 1 | -1 = 1
): { speed: number | null; angle: number | null } {
  const sorted = plottedPoints(points).sort((a, b) => a.frame - b.frame);
  const n = Math.max(2, Math.floor(numPoints));
  if (sorted.length < n) return { speed: null, angle: null };

  const subset = sorted.slice(0, n);
  const corrected = gravityCorrectedPoints(subset, pixelsPerMeter, framerate);
  const pairCount = n - 1;
  const weights = decreasingPairWeights(pairCount);

  let speedSum = 0;
  let speedWeightSum = 0;
  let angleSum = 0;
  let angleWeightSum = 0;

  for (let i = 0; i < pairCount; i++) {
    const w = weights[i];
    const speed = speedBetweenPoints(corrected[i], corrected[i + 1], pixelsPerMeter, framerate);
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

// Simulate projectile with drag (F = b * v^2) and Magnus (ay += magnusGain * v^magnusPower, upward)
// Returns array of (x, y) in meters
export function simulateShot(
  exitVelocity: number,
  exitAngleDeg: number,
  dragCoefficient: number,
  magnusGain = 0,
  maxTime = SIM_MAX_TIME,
  dt = SIM_DT,
  magnusPower = 2
): SimPoint[] {
  const g = GRAVITY_MS2;
  const angleRad = (exitAngleDeg * Math.PI) / 180;

  let vx = exitVelocity * Math.cos(angleRad);
  let vy = exitVelocity * Math.sin(angleRad);
  let x = 0;
  let y = 0;

  const points: SimPoint[] = [{ x, y }];

  for (let t = 0; t < maxTime; t += dt) {
    const v = Math.sqrt(vx * vx + vy * vy);
    const dragMag = dragCoefficient * v * v;
    const magnusMag = v > 0 ? magnusGain * v ** magnusPower : 0;
    const ax = v > 0 ? -(dragMag * (vx / v)) : 0;
    const ay = -g - (v > 0 ? dragMag * (vy / v) : 0) + magnusMag;

    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;

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

export interface FitTargetParams {
  fitExitVelocity: boolean;
  fitExitAngle: boolean;
  fitDrag: boolean;
  fitMagnus: boolean;
  fitMagnusPower: boolean;
}

export const DEFAULT_FIT_TARGET_PARAMS: FitTargetParams = {
  fitExitVelocity: false,
  fitExitAngle: false,
  fitDrag: true,
  fitMagnus: true,
  fitMagnusPower: false,
};

export interface FitGridConfig {
  dragMin: number;
  dragMax: number;
  magnusMin: number;
  magnusMax: number;
  magnusPowerMin: number;
  magnusPowerMax: number;
  velocityMin: number;
  velocityMax: number;
  angleMin: number;
  angleMax: number;
  numSplits: number;
  numRecursions: number;
  fitTargets: FitTargetParams;
  fitWholeVideo: boolean;
  fitAllVideos: boolean;
}

export const DEFAULT_FIT_GRID_CONFIG: FitGridConfig = {
  dragMin: 0,
  dragMax: 0.2,
  magnusMin: -0.4,
  magnusMax: -0.1,
  magnusPowerMin: 1,
  magnusPowerMax: 1.5,
  velocityMin: 0,
  velocityMax: 30,
  angleMin: -90,
  angleMax: 90,
  numSplits: 8,
  numRecursions: 3,
  fitTargets: DEFAULT_FIT_TARGET_PARAMS,
  fitWholeVideo: false,
  fitAllVideos: false,
};

export interface FitProgress {
  recursion: number;
  numRecursions: number;
  iteration: number;
  gridSize: number;
  totalEvals: number;
  progress: number;
}

export interface TrajGenProgress {
  phase: 'searching' | 'refining';
  current: number;
  total: number;
  found: number;
  progress: number;
}

export interface FitRankEntry {
  rank: number;
  visibleMeanDistance: number;
  exitVelocity: number;
  exitAngle: number;
  dragCoefficient: number;
  magnusGain: number;
}

export interface TrajectoryFitResult {
  exitVelocity: number;
  exitAngle: number;
  dragCoefficient: number;
  magnusGain: number;
  magnusPower: number;
  meanDistance: number;
  rmse: number;
  topFits: FitRankEntry[];
}

const TOP_FIT_COUNT = 500;

/** @deprecated Use TrajectoryFitResult */
export type DragMagnusFitResult = TrajectoryFitResult;

export function countFitDimensions(targets: FitTargetParams): number {
  return (
    (targets.fitExitVelocity ? 1 : 0) +
    (targets.fitExitAngle ? 1 : 0) +
    (targets.fitDrag ? 1 : 0) +
    (targets.fitMagnus ? 1 : 0) +
    (targets.fitMagnusPower ? 1 : 0)
  );
}

export function computeFitTotalEvals(
  numSplits: number,
  numRecursions: number,
  targets: FitTargetParams,
  trajectoryCount = 1
): number {
  const dims = countFitDimensions(targets);
  if (dims === 0) return 0;
  const n = Math.max(2, Math.floor(numSplits));
  const r = Math.max(1, Math.floor(numRecursions));
  const gridEvals = r * n ** dims;
  return gridEvals * Math.max(1, trajectoryCount);
}

const FIT_PENALTY = 100;
const FIT_YIELD_EVERY = 8;
const TRAJ_GEN_YIELD_EVERY = 50;

type FitDimKey = 'velocity' | 'angle' | 'drag' | 'magnus' | 'magnusPower';

interface FitSimParams {
  exitVelocity: number;
  exitAngle: number;
  drag: number;
  magnus: number;
  magnusPower: number;
}

interface FitDimSpec {
  key: FitDimKey;
  lo: number;
  hi: number;
  clampMin: number;
  clampMax: number;
}

function buildGrid(lo: number, hi: number, numSplits: number): number[] {
  const n = Math.max(1, Math.floor(numSplits));
  if (n === 1) return [(lo + hi) / 2];
  const step = (hi - lo) / n;
  return Array.from({ length: n }, (_, i) => lo + i * step);
}

function preprocessObservations(
  trajectory: TrajectoryPoint[],
  ppmSource: PixelsPerMeterSource,
  framerate: number,
  xdir: 1 | -1 = 1
): { obs: { t: number; x: number; y: number }[]; simMaxTime: number } | null {
  const sorted = plottedPoints(trajectory).sort((a, b) => a.frame - b.frame);
  if (sorted.length < 3 || !ppmValid(ppmSource) || framerate <= 0) return null;

  const launch = sorted[0];
  const frame0 = launch.frame;
  const obs = sorted.map((p) => {
    const ppm = resolvePpm(ppmSource, p.x);
    if (ppm <= 0) return null;
    return {
      t: (p.frame - frame0) / framerate,
      x: (xdir * (p.x - launch.x)) / ppm,
      y: (launch.y - p.y) / ppm,
    };
  }).filter((o): o is { t: number; x: number; y: number } => o !== null);
  if (obs.length < 3 || obs[obs.length - 1].t <= 0) return null;

  return {
    obs,
    simMaxTime: Math.min(SIM_MAX_TIME, obs[obs.length - 1].t + 0.05),
  };
}

export interface FitTrajectoryInput {
  points: { x: number; y: number; frame: number }[];
  exitVelocity: number;
  exitAngle: number;
  dragCoefficient: number;
  magnusGain: number;
  magnusPower: number;
  pixelsPerMeter: PixelsPerMeterSource;
  framerate: number;
  xdir?: 1 | -1;
}

interface FitObservationSet {
  obs: { t: number; x: number; y: number }[];
  simMaxTime: number;
  fixed: FitSimParams;
}

function buildObservationSets(trajectories: FitTrajectoryInput[]): FitObservationSet[] {
  const sets: FitObservationSet[] = [];
  for (const traj of trajectories) {
    const prepped = preprocessObservations(
      traj.points,
      traj.pixelsPerMeter,
      traj.framerate,
      traj.xdir ?? 1
    );
    if (!prepped) continue;
    sets.push({
      ...prepped,
      fixed: {
        exitVelocity: traj.exitVelocity,
        exitAngle: traj.exitAngle,
        drag: traj.dragCoefficient,
        magnus: traj.magnusGain,
        magnusPower: traj.magnusPower,
      },
    });
  }
  return sets;
}

function mergeTrialParams(
  trial: FitSimParams,
  fixed: FitSimParams,
  fitTargets: FitTargetParams
): FitSimParams {
  return {
    exitVelocity: fitTargets.fitExitVelocity ? trial.exitVelocity : fixed.exitVelocity,
    exitAngle: fitTargets.fitExitAngle ? trial.exitAngle : fixed.exitAngle,
    drag: fitTargets.fitDrag ? trial.drag : fixed.drag,
    magnus: fitTargets.fitMagnus ? trial.magnus : fixed.magnus,
    magnusPower: fitTargets.fitMagnusPower ? trial.magnusPower : fixed.magnusPower,
  };
}

function evaluateFitCost(
  params: FitSimParams,
  obs: { t: number; x: number; y: number }[],
  simMaxTime: number
): { cost: number; meanDistance: number; rmse: number } {
  if (params.exitVelocity <= 0) {
    return { cost: Infinity, meanDistance: Infinity, rmse: Infinity };
  }

  const sim = simulateShot(
    params.exitVelocity,
    params.exitAngle,
    params.drag,
    params.magnus,
    simMaxTime,
    SIM_DT,
    params.magnusPower
  );
  let sumDist = 0;
  let sumSq = 0;
  let count = 0;

  for (const o of obs) {
    if (o.t <= 0) continue;
    const s = interpSimAtTime(sim, o.t, SIM_DT);
    if (s === null) {
      sumDist += FIT_PENALTY;
      sumSq += FIT_PENALTY * FIT_PENALTY;
    } else {
      const d = Math.hypot(s.x - o.x, s.y - o.y);
      sumDist += d;
      sumSq += d * d;
    }
    count++;
  }

  if (count === 0) {
    return { cost: Infinity, meanDistance: Infinity, rmse: Infinity };
  }

  return {
    cost: sumSq / count,
    meanDistance: sumDist / count,
    rmse: Math.sqrt(sumSq / count),
  };
}

export interface TrajectoryFitCost {
  cost: number;
  meanDistance: number;
  rmse: number;
}

/** Same cost metric as fit: mean squared time-aligned point distance (m²). */
export function computeTrajectoryFitCost(
  points: { x: number; y: number; frame: number }[],
  params: {
    exitVelocity: number;
    exitAngle: number;
    dragCoefficient: number;
    magnusGain: number;
    magnusPower: number;
  },
  ppm: PixelsPerMeterSource,
  framerate: number,
  xdir: 1 | -1 = 1
): TrajectoryFitCost | null {
  const prepped = preprocessObservations(points, ppm, framerate, xdir);
  if (!prepped) return null;
  const metrics = evaluateFitCost(
    {
      exitVelocity: params.exitVelocity,
      exitAngle: params.exitAngle,
      drag: params.dragCoefficient,
      magnus: params.magnusGain,
      magnusPower: params.magnusPower,
    },
    prepped.obs,
    prepped.simMaxTime
  );
  if (!Number.isFinite(metrics.cost)) return null;
  return metrics;
}

function evaluateCombinedFitCost(
  trial: FitSimParams,
  observationSets: FitObservationSet[],
  fitTargets: FitTargetParams,
  useMinAcrossTrajectories: boolean
): { cost: number; meanDistance: number; rmse: number } {
  if (observationSets.length === 0) {
    return { cost: Infinity, meanDistance: Infinity, rmse: Infinity };
  }

  const perTraj = observationSets.map((set) =>
    evaluateFitCost(
      mergeTrialParams(trial, set.fixed, fitTargets),
      set.obs,
      set.simMaxTime
    )
  );

  if (useMinAcrossTrajectories && observationSets.length > 1) {
    let bestIdx = 0;
    let bestCost = perTraj[0].cost;
    for (let i = 1; i < perTraj.length; i++) {
      if (perTraj[i].cost < bestCost) {
        bestCost = perTraj[i].cost;
        bestIdx = i;
      }
    }
    return perTraj[bestIdx];
  }

  if (perTraj.length === 1) return perTraj[0];

  const cost = perTraj.reduce((s, m) => s + m.cost, 0);
  const meanDistance = perTraj.reduce((s, m) => s + m.meanDistance, 0) / perTraj.length;
  const rmse = perTraj.reduce((s, m) => s + m.rmse, 0) / perTraj.length;
  return { cost, meanDistance, rmse };
}

function buildActiveFitDims(config: FitGridConfig): FitDimSpec[] {
  const dims: FitDimSpec[] = [];
  const { fitTargets: t } = config;

  if (t.fitExitVelocity) {
    dims.push({
      key: 'velocity',
      lo: config.velocityMin,
      hi: config.velocityMax,
      clampMin: config.velocityMin,
      clampMax: config.velocityMax,
    });
  }
  if (t.fitExitAngle) {
    dims.push({
      key: 'angle',
      lo: config.angleMin,
      hi: config.angleMax,
      clampMin: config.angleMin,
      clampMax: config.angleMax,
    });
  }
  if (t.fitDrag) {
    dims.push({
      key: 'drag',
      lo: config.dragMin,
      hi: config.dragMax,
      clampMin: config.dragMin,
      clampMax: config.dragMax,
    });
  }
  if (t.fitMagnus) {
    dims.push({
      key: 'magnus',
      lo: config.magnusMin,
      hi: config.magnusMax,
      clampMin: config.magnusMin,
      clampMax: config.magnusMax,
    });
  }
  if (t.fitMagnusPower) {
    dims.push({
      key: 'magnusPower',
      lo: config.magnusPowerMin,
      hi: config.magnusPowerMax,
      clampMin: config.magnusPowerMin,
      clampMax: config.magnusPowerMax,
    });
  }

  return dims;
}

function paramsFromIndices(
  dims: FitDimSpec[],
  grids: number[][],
  indices: number[],
  fixed: FitSimParams
): FitSimParams {
  const result = { ...fixed };
  for (let d = 0; d < dims.length; d++) {
    const v = grids[d][indices[d]];
    switch (dims[d].key) {
      case 'velocity': result.exitVelocity = v; break;
      case 'angle': result.exitAngle = v; break;
      case 'drag': result.drag = v; break;
      case 'magnus': result.magnus = v; break;
      case 'magnusPower': result.magnusPower = v; break;
    }
  }
  return result;
}

function shrinkDimRange(grid: number[], bestIndex: number, numSplits: number, spec: FitDimSpec): { lo: number; hi: number } {
  let lo = grid[Math.max(0, bestIndex - 1)];
  let hi = grid[Math.min(numSplits - 1, bestIndex + 1)];
  lo = Math.max(spec.clampMin, lo);
  hi = Math.min(spec.clampMax, hi);
  if (hi - lo < 1e-6) {
    lo = spec.clampMin;
    hi = spec.clampMax;
  }
  return { lo, hi };
}

// Recursive N-D grid search over selected launch/physics parameters.
// Cost = mean squared distance between each plotted point and the sim at the
// same time of flight. With multiple trajectories, cost is the lowest among them.
// Runs async in chunks to stay responsive and cancellable.
export function fitDragMagnusAsync(
  trajectories: FitTrajectoryInput[],
  onProgress: (progress: FitProgress) => void,
  signal: { cancelled: boolean },
  config: FitGridConfig = DEFAULT_FIT_GRID_CONFIG
): Promise<TrajectoryFitResult | null> {
  return new Promise((resolve) => {
    const numSplits = Math.max(2, Math.floor(config.numSplits));
    const numRecursions = Math.max(1, Math.floor(config.numRecursions));
    const numDims = countFitDimensions(config.fitTargets);

    if (numDims === 0) {
      resolve(null);
      return;
    }

    const useMultipleTrajectories = config.fitAllVideos || config.fitWholeVideo;
    const activeTrajectories = useMultipleTrajectories
      ? trajectories
      : trajectories.slice(0, 1);
    const observationSets = buildObservationSets(activeTrajectories);

    if (observationSets.length === 0) {
      resolve(null);
      return;
    }

    const primary = activeTrajectories[0];
    if (!config.fitTargets.fitExitVelocity) {
      const needsVelocity = useMultipleTrajectories
        ? observationSets.every((set) => set.fixed.exitVelocity > 0)
        : primary.exitVelocity > 0;
      if (!needsVelocity) {
        resolve(null);
        return;
      }
    }

    const gridEvalsPerRecursion = numSplits ** numDims;
    const totalGridEvals = numRecursions * gridEvalsPerRecursion;
    const totalEvals = totalGridEvals * observationSets.length;
    const useMinCost = observationSets.length > 1;

    const initial: FitSimParams = {
      exitVelocity: primary.exitVelocity,
      exitAngle: primary.exitAngle,
      drag: primary.dragCoefficient,
      magnus: primary.magnusGain,
      magnusPower: primary.magnusPower,
    };

    let activeDims = buildActiveFitDims(config);
    let currentParams = { ...initial };
    let bestMetrics = { cost: Infinity, meanDistance: Infinity, rmse: Infinity };

    interface TopFitCandidate {
      cost: number;
      visibleMeanDistance: number;
      exitVelocity: number;
      exitAngle: number;
      dragCoefficient: number;
      magnusGain: number;
    }
    const topFitCandidates: TopFitCandidate[] = [];

    function topFitKey(e: TopFitCandidate): string {
      return `${e.exitVelocity}|${e.exitAngle}|${e.dragCoefficient}|${e.magnusGain}`;
    }

    function recordTopFit(trial: FitSimParams, fitCost: number) {
      if (!Number.isFinite(fitCost)) return;

      const primarySet = observationSets[0];
      const merged = mergeTrialParams(trial, primarySet.fixed, config.fitTargets);
      const visibleMetrics = evaluateFitCost(merged, primarySet.obs, primarySet.simMaxTime);
      if (!Number.isFinite(visibleMetrics.meanDistance)) return;

      const entry: TopFitCandidate = {
        cost: fitCost,
        visibleMeanDistance: visibleMetrics.meanDistance,
        exitVelocity: merged.exitVelocity,
        exitAngle: merged.exitAngle,
        dragCoefficient: merged.drag,
        magnusGain: merged.magnus,
      };

      const key = topFitKey(entry);
      const dupeIdx = topFitCandidates.findIndex((e) => topFitKey(e) === key);
      if (dupeIdx >= 0) {
        if (fitCost >= topFitCandidates[dupeIdx].cost) return;
        topFitCandidates.splice(dupeIdx, 1);
      }

      if (
        topFitCandidates.length >= TOP_FIT_COUNT &&
        fitCost >= topFitCandidates[topFitCandidates.length - 1].cost
      ) {
        return;
      }

      topFitCandidates.push(entry);
      topFitCandidates.sort((a, b) => a.cost - b.cost);
      if (topFitCandidates.length > TOP_FIT_COUNT) {
        topFitCandidates.length = TOP_FIT_COUNT;
      }
    }

    let completedEvals = 0;
    let recursionIndex = 0;

    function reportProgress(iteration: number) {
      onProgress({
        recursion: recursionIndex,
        numRecursions,
        iteration,
        gridSize: gridEvalsPerRecursion,
        totalEvals,
        progress: (completedEvals * observationSets.length) / totalEvals,
      });
    }

    function finishFit() {
      const topFits: FitRankEntry[] = topFitCandidates.map((e, i) => ({
        rank: i + 1,
        visibleMeanDistance: e.visibleMeanDistance,
        exitVelocity: e.exitVelocity,
        exitAngle: e.exitAngle,
        dragCoefficient: e.dragCoefficient,
        magnusGain: e.magnusGain,
      }));
      resolve({
        exitVelocity: currentParams.exitVelocity,
        exitAngle: currentParams.exitAngle,
        dragCoefficient: currentParams.drag,
        magnusGain: currentParams.magnus,
        magnusPower: currentParams.magnusPower,
        meanDistance: bestMetrics.meanDistance,
        rmse: bestMetrics.rmse,
        topFits,
      });
    }

    function decodeFlatIndex(flat: number): number[] {
      const indices = new Array(activeDims.length);
      let rem = flat;
      for (let d = activeDims.length - 1; d >= 0; d--) {
        indices[d] = rem % numSplits;
        rem = Math.floor(rem / numSplits);
      }
      return indices;
    }

    function runRecursion() {
      if (signal.cancelled) {
        resolve(null);
        return;
      }

      recursionIndex++;

      const grids = activeDims.map((d) => buildGrid(d.lo, d.hi, numSplits));
      let localBestCost = Infinity;
      let localBestMetrics = bestMetrics;
      let localBestIndices = new Array(activeDims.length).fill(0);

      function runGridFlat(flatIndex: number) {
        if (signal.cancelled) {
          resolve(null);
          return;
        }

        if (flatIndex >= gridEvalsPerRecursion) {
          currentParams = paramsFromIndices(activeDims, grids, localBestIndices, initial);
          bestMetrics = localBestMetrics;

          if (recursionIndex < numRecursions) {
            activeDims = activeDims.map((dim, d) => {
              const shrunk = shrinkDimRange(grids[d], localBestIndices[d], numSplits, dim);
              return { ...dim, lo: shrunk.lo, hi: shrunk.hi };
            });
            setTimeout(runRecursion, 0);
          } else {
            finishFit();
          }
          return;
        }

        const indices = decodeFlatIndex(flatIndex);
        const trial = paramsFromIndices(activeDims, grids, indices, initial);
        const metrics = evaluateCombinedFitCost(
          trial,
          observationSets,
          config.fitTargets,
          useMinCost
        );

        if (metrics.cost < localBestCost) {
          localBestCost = metrics.cost;
          localBestMetrics = metrics;
          localBestIndices = indices;
        }

        recordTopFit(trial, metrics.cost);

        completedEvals++;
        reportProgress(flatIndex + 1);

        const advance = () => runGridFlat(flatIndex + 1);
        if (completedEvals % FIT_YIELD_EVERY === 0) setTimeout(advance, 0);
        else advance();
      }

      runGridFlat(0);
    }

    setTimeout(runRecursion, 0);
  });
}

// Compute the peak height (meters above launch) reached during flight
export function simulatePeakHeight(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  dt = SIM_DT
): number {
  const pts = simulateShot(exitVelocity, exitAngleDeg, drag, magnus, SIM_MAX_TIME, dt);
  return pts.reduce((peak, p) => Math.max(peak, p.y), 0);
}

// Compute the impact angle (degrees below horizontal) at targetDx.
// Returns positive number = descending into goal.
export function simulateImpactAngle(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  targetDx: number,
  dt = SIM_DT
): number | null {
  const pts = simulateShot(exitVelocity, exitAngleDeg, drag, magnus, SIM_MAX_TIME, dt);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.x <= targetDx && b.x >= targetDx) {
      const vx = (b.x - a.x) / dt;
      const vy = (b.y - a.y) / dt;
      return -(Math.atan2(vy, vx) * 180) / Math.PI;
    }
  }
  return null;
}

// Simulate a single shot and return where the trajectory crosses targetDy (goal height).
// Uses the last forward crossing (descending leg) when the arc passes through dy twice.
export function simulateLanding(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  targetDy: number
): { landingX: number; landingY: number; timeOfFlight: number } | null {
  const pts = simulateShot(exitVelocity, exitAngleDeg, drag, magnus, SIM_MAX_TIME, SIM_DT);
  let lastCross: { landingX: number; landingY: number; timeOfFlight: number } | null = null;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const crosses =
      (a.y <= targetDy && b.y >= targetDy) || (a.y >= targetDy && b.y <= targetDy);
    if (!crosses) continue;
    const dy = b.y - a.y;
    if (Math.abs(dy) < 1e-12) continue;
    const t2 = (targetDy - a.y) / dy;
    if (t2 < 0 || t2 > 1) continue;
    const x = a.x + t2 * (b.x - a.x);
    if (x < 0) continue;
    lastCross = {
      landingX: x,
      landingY: targetDy,
      timeOfFlight: (i + t2) * SIM_DT,
    };
  }

  return lastCross;
}

export interface TrajectoryMoe {
  speedMoe: number;
  angleMoe: number;
  combinedMoe: number;
  speedMoePlus: number;
  speedMoeMinus: number;
  angleMoePlus: number;
  angleMoeMinus: number;
}

const MOE_MAX_ITER = 50;
const MOE_SPEED_MAX_DELTA = 15; // m/s
const MOE_ANGLE_MAX_DELTA = 45; // deg

function shotLandsInGoal(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  targetDy: number,
  targetDx: number,
  goalHalfWidth: number,
): boolean {
  if (exitVelocity <= 0) return false;
  const landing = simulateLanding(exitVelocity, exitAngleDeg, drag, magnus, targetDy);
  if (landing === null) return false;
  return Math.abs(landing.landingX - targetDx) <= goalHalfWidth + 1e-12;
}

function landingEdgeError(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  targetDy: number,
  targetDx: number,
  goalHalfWidth: number,
): number | null {
  if (exitVelocity <= 0) return null;
  const landing = simulateLanding(exitVelocity, exitAngleDeg, drag, magnus, targetDy);
  if (landing === null) return null;
  return Math.abs(landing.landingX - targetDx) - goalHalfWidth;
}

/** Binary-search one-sided margin (delta ≥ 0) until the shot misses the goal edge. */
function binarySearchOneSidedMargin(
  inGoalAtDelta: (delta: number) => boolean,
  edgeErrorAtDelta: (delta: number) => number | null,
  maxDelta: number,
): number {
  if (!inGoalAtDelta(0)) return 0;
  if (inGoalAtDelta(maxDelta)) return maxDelta;

  let lo = 0;
  let hi = Math.min(maxDelta, 0.05);
  while (hi < maxDelta && inGoalAtDelta(hi)) {
    lo = hi;
    hi = Math.min(maxDelta, hi * 2);
  }
  if (inGoalAtDelta(maxDelta)) return maxDelta;

  let good = lo;
  let bad = inGoalAtDelta(hi) ? maxDelta : hi;

  for (let i = 0; i < MOE_MAX_ITER; i++) {
    const mid = (good + bad) / 2;
    if (inGoalAtDelta(mid)) good = mid;
    else bad = mid;
    const err = edgeErrorAtDelta(good);
    if (err !== null && err >= -REFINE_THRESHOLD_M) break;
    if (bad - good < 1e-10) break;
  }
  return good;
}

export function computeTrajectoryMoe(
  traj: GeneratedTrajectory,
  targetDx: number,
  targetDy: number,
  goalHalfWidth: number,
  drag: number,
  magnus: number,
): TrajectoryMoe | null {
  if (traj.successfulBracket === false || traj.accurate === false) return null;

  const inGoal = (vel: number, angle: number) =>
    shotLandsInGoal(vel, angle, drag, magnus, targetDy, targetDx, goalHalfWidth);

  const nominalVel = traj.exitVelocity;
  const nominalAngle = traj.exitAngle;

  if (!inGoal(nominalVel, nominalAngle)) return null;

  const edgeErr = (vel: number, angle: number) =>
    landingEdgeError(vel, angle, drag, magnus, targetDy, targetDx, goalHalfWidth);

  const speedMoePlus = binarySearchOneSidedMargin(
    (d) => inGoal(nominalVel + d, nominalAngle),
    (d) => edgeErr(nominalVel + d, nominalAngle),
    MOE_SPEED_MAX_DELTA,
  );
  const speedMoeMinus = binarySearchOneSidedMargin(
    (d) => nominalVel - d > 0 && inGoal(nominalVel - d, nominalAngle),
    (d) => (nominalVel - d > 0 ? edgeErr(nominalVel - d, nominalAngle) : null),
    nominalVel,
  );
  const angleMoePlus = binarySearchOneSidedMargin(
    (d) => inGoal(nominalVel, nominalAngle + d),
    (d) => edgeErr(nominalVel, nominalAngle + d),
    MOE_ANGLE_MAX_DELTA,
  );
  const angleMoeMinus = binarySearchOneSidedMargin(
    (d) => inGoal(nominalVel, nominalAngle - d),
    (d) => edgeErr(nominalVel, nominalAngle - d),
    MOE_ANGLE_MAX_DELTA,
  );

  const speedMoe = Math.min(speedMoePlus, speedMoeMinus);
  const angleMoe = Math.min(angleMoePlus, angleMoeMinus);
  // const combinedMoe = Math.min(0.5, speedMoe);
  const combinedMoe = Math.min(0.5, speedMoe) * Math.min(angleMoe, 1) * 0.1;

  return {
    speedMoe,
    angleMoe,
    combinedMoe,
    speedMoePlus,
    speedMoeMinus,
    angleMoePlus,
    angleMoeMinus,
  };
}

export interface MoeRecalcProgress {
  current: number;
  total: number;
  progress: number;
}

function appendTrajectoryMoe(
  map: Map<string, TrajectoryMoe>,
  g: TrajGroup,
  t: GeneratedTrajectory,
  half: number,
  forceRecalculate: boolean,
): void {
  if (!forceRecalculate && t.speedMoe !== undefined && t.angleMoe !== undefined) {
    map.set(t.id, {
      speedMoe: t.speedMoe,
      angleMoe: t.angleMoe,
      combinedMoe: t.speedMoe * t.angleMoe * 0.1,
      speedMoePlus: t.speedMoe,
      speedMoeMinus: t.speedMoe,
      angleMoePlus: t.angleMoe,
      angleMoeMinus: t.angleMoe,
    });
    return;
  }
  const moe = computeTrajectoryMoe(t, g.dx, g.dy, half, g.drag, g.magnus);
  if (moe) map.set(t.id, moe);
}

export function buildTrajectoryMoeMap(
  groups: TrajGroup[],
  errorTolerance: number,
  forceRecalculate = false,
): Map<string, TrajectoryMoe> {
  const map = new Map<string, TrajectoryMoe>();
  const half = errorTolerance / 2;
  for (const g of groups) {
    for (const t of g.trajectories) {
      appendTrajectoryMoe(map, g, t, half, forceRecalculate);
    }
  }
  return map;
}

export function buildTrajectoryMoeMapAsync(
  groups: TrajGroup[],
  errorTolerance: number,
  forceRecalculate: boolean,
  onProgress: (progress: MoeRecalcProgress) => void,
  signal?: { cancelled: boolean },
): Promise<Map<string, TrajectoryMoe>> {
  return new Promise((resolve) => {
    const map = new Map<string, TrajectoryMoe>();
    const half = errorTolerance / 2;
    type WorkItem = { group: TrajGroup; traj: GeneratedTrajectory };
    const items: WorkItem[] = [];
    for (const g of groups) {
      for (const t of g.trajectories) items.push({ group: g, traj: t });
    }
    const total = items.length;
    let index = 0;

    onProgress({ current: 0, total, progress: total > 0 ? 0 : 1 });

    function step() {
      if (signal?.cancelled) {
        resolve(map);
        return;
      }

      let batch = TRAJ_GEN_YIELD_EVERY;
      while (batch > 0 && index < total) {
        const { group, traj } = items[index];
        appendTrajectoryMoe(map, group, traj, half, forceRecalculate);
        index++;
        batch--;
      }

      onProgress({ current: index, total, progress: total > 0 ? index / total : 1 });

      if (index < total) {
        setTimeout(step, 0);
      } else {
        resolve(map);
      }
    }

    step();
  });
}

export function enumerateDxValues(dxMin: number, dxMax: number, dxStep: number): number[] {
  const values: number[] = [];
  let dx = dxMin;
  while (dx <= dxMax + 1e-9) {
    values.push(Math.round(dx * 1e6) / 1e6);
    dx = Math.round((dx + dxStep) * 1e6) / 1e6;
  }
  return values;
}

export function closestIntervalPosition(landingX: number, dxValues: number[]): number {
  if (dxValues.length === 0) return landingX;
  let best = dxValues[0];
  let bestDist = Math.abs(landingX - best);
  for (const dx of dxValues) {
    const dist = Math.abs(landingX - dx);
    if (dist < bestDist) {
      bestDist = dist;
      best = dx;
    }
  }
  return best;
}

/** Fixed horizontal tolerance for raw trajectory generation and in-goal success checks. */
export const RAW_TRAJECTORY_ERROR_TOLERANCE = 0.5;

// Sweep exit velocity and angle once; keep trajectories whose x at goal height
// falls within [dxMin - RAW/2, dxMax + RAW/2].
export function generateTrajectories(
  params: TrajGenParams,
  drag: number,
  magnus: number
): GeneratedTrajectory[] {
  const results: GeneratedTrajectory[] = [];
  const xMin = params.dxMin - RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
  const xMax = params.dxMax + RAW_TRAJECTORY_ERROR_TOLERANCE / 2;

  let vel = params.velocityMin;
  while (vel <= params.velocityMax + 1e-9) {
    let angle = params.exitAngleMin;
    while (angle <= params.exitAngleMax + 1e-9) {
      const landing = simulateLanding(vel, angle, drag, magnus, params.dy);
      if (
        landing !== null &&
        landing.landingX >= xMin &&
        landing.landingX <= xMax
      ) {
        const impact = simulateImpactAngle(vel, angle, drag, magnus, landing.landingX);
        if (impact !== null && impact >= params.impactAngleMin && impact <= params.impactAngleMax) {
          results.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            exitVelocity: Math.round(vel * 100) / 100,
            exitAngle: Math.round(angle * 100) / 100,
            impactAngle: Math.round(impact * 100) / 100,
            timeOfFlight: Math.round(landing.timeOfFlight * 1000) / 1000,
            landingX: Math.round(landing.landingX * 1000) / 1000,
          });
        }
      }
      angle = Math.round((angle + params.angleStep) * 1e6) / 1e6;
    }
    vel = Math.round((vel + params.velocityStep) * 1e6) / 1e6;
  }

  return results;
}

export function countTrajGenCombinations(params: TrajGenParams): number {
  let count = 0;
  let vel = params.velocityMin;
  while (vel <= params.velocityMax + 1e-9) {
    let angle = params.exitAngleMin;
    while (angle <= params.exitAngleMax + 1e-9) {
      count++;
      angle = Math.round((angle + params.angleStep) * 1e6) / 1e6;
    }
    vel = Math.round((vel + params.velocityStep) * 1e6) / 1e6;
  }
  return count;
}

function assignRefinedTrajectory(
  traj: GeneratedTrajectory,
  params: TrajGenParams,
  dxValues: number[],
  groupTrajs: Map<number, GeneratedTrajectory[]>,
  drag: number,
  magnus: number
): void {
  const targetDx = closestIntervalPosition(traj.landingX, dxValues);
  const gParams = { ...params, dx: targetDx };
  const { trajectory: refined, successfulBracket, accurate } = refineTrajectory(
    traj,
    gParams,
    drag,
    magnus,
      REFINE_MAX_ITER,
      REFINE_THRESHOLD_M,
      'angle'
  );

  if (!successfulBracket) {
    groupTrajs.get(targetDx)!.push(refined);
    return;
  }

  const impact = simulateImpactAngle(
    refined.exitVelocity,
    refined.exitAngle,
    drag,
    magnus,
    targetDx
  );
  const withImpact = {
    ...refined,
    impactAngle: impact !== null ? Math.round(impact * 100) / 100 : refined.impactAngle,
    landingX: targetDx,
  };
  const landing = simulateLanding(refined.exitVelocity, refined.exitAngle, drag, magnus, params.dy);
  const inGoal =
    successfulBracket &&
    landing !== null &&
    Math.abs(landing.landingX - targetDx) <= RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
  const finalTraj: GeneratedTrajectory = {
    ...withImpact,
    successfulBracket: inGoal,
    accurate: inGoal && accurate,
  };
  groupTrajs.get(targetDx)!.push(finalTraj);
}

function buildTrajectoryGroups(
  dxValues: number[],
  groupTrajs: Map<number, GeneratedTrajectory[]>,
  params: TrajGenParams,
  drag: number,
  magnus: number
): TrajGroup[] {
  const batchId = Date.now();
  const groups: TrajGroup[] = dxValues.map((dx) => {
    const trajectories = dedupeTrajectories(groupTrajs.get(dx) ?? []);
    return {
      id: `${dx.toFixed(6)}-${params.dy.toFixed(6)}-${batchId}-${Math.random().toString(36).slice(2)}`,
      dx,
      dy: params.dy,
      drag,
      magnus,
      trajectories,
    };
  });

  return groups.filter((g) => g.trajectories.length > 0);
}

// Generate trajectories once, assign each to the nearest distance interval, refine, and group.
export function generateAndRefineTrajectoryGroups(
  params: TrajGenParams,
  drag: number,
  magnus: number
): TrajGroup[] {
  const dxValues = enumerateDxValues(params.dxMin, params.dxMax, params.dxStep);
  if (dxValues.length === 0) return [];

  const raw = generateTrajectories(params, drag, magnus);
  const groupTrajs = new Map<number, GeneratedTrajectory[]>();
  for (const dx of dxValues) groupTrajs.set(dx, []);

  for (const traj of raw) {
    assignRefinedTrajectory(traj, params, dxValues, groupTrajs, drag, magnus);
  }

  return buildTrajectoryGroups(dxValues, groupTrajs, params, drag, magnus);
}

function assignUnrefinedToGroups(
  raw: GeneratedTrajectory[],
  dxValues: number[],
  groupTrajs: Map<number, GeneratedTrajectory[]>
): void {
  for (const traj of raw) {
    const targetDx = closestIntervalPosition(traj.landingX, dxValues);
    groupTrajs.get(targetDx)!.push(traj);
  }
}

// Async search-only: sweep angle × velocity and group candidates without refining.
export function generateTrajectoriesAsync(
  params: TrajGenParams,
  drag: number,
  magnus: number,
  onProgress: (progress: TrajGenProgress) => void,
  signal: { cancelled: boolean }
): Promise<TrajGroup[]> {
  return new Promise((resolve) => {
    const dxValues = enumerateDxValues(params.dxMin, params.dxMax, params.dxStep);
    if (dxValues.length === 0) {
      resolve([]);
      return;
    }

    const totalCombos = countTrajGenCombinations(params);
    const xMin = params.dxMin - RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
    const xMax = params.dxMax + RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
    const raw: GeneratedTrajectory[] = [];
    let comboIndex = 0;
    let vel = params.velocityMin;
    let angle = params.exitAngleMin;

    function reportSearch() {
      onProgress({
        phase: 'searching',
        current: comboIndex,
        total: totalCombos,
        found: raw.length,
        progress: totalCombos > 0 ? comboIndex / totalCombos : 0,
      });
    }

    function searchStep() {
      if (signal.cancelled) {
        resolve([]);
        return;
      }

      let batch = TRAJ_GEN_YIELD_EVERY;
      while (batch > 0 && vel <= params.velocityMax + 1e-9) {
        while (angle <= params.exitAngleMax + 1e-9) {
          const landing = simulateLanding(vel, angle, drag, magnus, params.dy);
          if (
            landing !== null &&
            landing.landingX >= xMin &&
            landing.landingX <= xMax
          ) {
            const impact = simulateImpactAngle(vel, angle, drag, magnus, landing.landingX);
            if (impact !== null && impact >= params.impactAngleMin && impact <= params.impactAngleMax) {
              raw.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                exitVelocity: Math.round(vel * 100) / 100,
                exitAngle: Math.round(angle * 100) / 100,
                impactAngle: Math.round(impact * 100) / 100,
                timeOfFlight: Math.round(landing.timeOfFlight * 1000) / 1000,
                landingX: Math.round(landing.landingX * 1000) / 1000,
              });
            }
          }

          comboIndex++;
          angle = Math.round((angle + params.angleStep) * 1e6) / 1e6;
          batch--;
          if (batch === 0) break;
        }

        if (angle > params.exitAngleMax + 1e-9) {
          vel = Math.round((vel + params.velocityStep) * 1e6) / 1e6;
          angle = params.exitAngleMin;
        }
      }

      if (vel <= params.velocityMax + 1e-9) {
        reportSearch();
        setTimeout(searchStep, 0);
        return;
      }

      onProgress({
        phase: 'searching',
        current: totalCombos,
        total: totalCombos,
        found: raw.length,
        progress: 1,
      });

      const groupTrajs = new Map<number, GeneratedTrajectory[]>();
      for (const dx of dxValues) groupTrajs.set(dx, []);
      assignUnrefinedToGroups(raw, dxValues, groupTrajs);
      resolve(buildTrajectoryGroups(dxValues, groupTrajs, params, drag, magnus));
    }

    reportSearch();
    setTimeout(searchStep, 0);
  });
}

// Async refine-only: refine existing candidates and regroup by distance interval.
export function refineTrajectoriesAsync(
  raw: GeneratedTrajectory[],
  params: TrajGenParams,
  drag: number,
  magnus: number,
  onProgress: (progress: TrajGenProgress) => void,
  signal: { cancelled: boolean }
): Promise<TrajGroup[]> {
  return new Promise((resolve) => {
    const dxValues = enumerateDxValues(params.dxMin, params.dxMax, params.dxStep);
    if (dxValues.length === 0 || raw.length === 0) {
      resolve([]);
      return;
    }

    const groupTrajs = new Map<number, GeneratedTrajectory[]>();
    for (const dx of dxValues) groupTrajs.set(dx, []);

    function reportRefine(index: number) {
      const total = raw.length;
      onProgress({
        phase: 'refining',
        current: index,
        total,
        found: raw.length,
        progress: total > 0 ? index / total : 0,
      });
    }

    function refineStep(index: number) {
      if (signal.cancelled) {
        resolve([]);
        return;
      }

      if (index >= raw.length) {
        onProgress({
          phase: 'refining',
          current: raw.length,
          total: raw.length,
          found: raw.length,
          progress: 1,
        });
        resolve(buildTrajectoryGroups(dxValues, groupTrajs, params, drag, magnus));
        return;
      }

      assignRefinedTrajectory(raw[index], params, dxValues, groupTrajs, drag, magnus);
      reportRefine(index + 1);

      const advance = () => refineStep(index + 1);
      if ((index + 1) % TRAJ_GEN_YIELD_EVERY === 0) setTimeout(advance, 0);
      else advance();
    }

    reportRefine(0);
    setTimeout(() => refineStep(0), 0);
  });
}

// Async variant that reports search/refine progress and yields to the UI thread.
export function generateAndRefineTrajectoryGroupsAsync(
  params: TrajGenParams,
  drag: number,
  magnus: number,
  onProgress: (progress: TrajGenProgress) => void,
  signal: { cancelled: boolean }
): Promise<TrajGroup[]> {
  return generateTrajectoriesAsync(params, drag, magnus, onProgress, signal).then((groups) => {
    if (signal.cancelled) return [];
    const raw = groups.flatMap((g) => g.trajectories);
    if (raw.length === 0) return [];
    return refineTrajectoriesAsync(raw, params, drag, magnus, onProgress, signal);
  });
}

// Helper: compute landingX at goal height for a given search variable, holding the other constant
function landingXAtGoalHeight(
  searchVal: number,
  fixed: number,
  constMode: 'velocity' | 'angle',
  drag: number,
  magnus: number,
  targetDy: number
): number | null {
  const v = constMode === 'velocity' ? fixed : searchVal;
  const a = constMode === 'velocity' ? searchVal : fixed;
  const result = simulateLanding(v, a, drag, magnus, targetDy);
  return result ? result.landingX : null;
}

type RefineFailureReason = 'bracket' | 'target_height';

interface RefineResult {
  trajectory: GeneratedTrajectory;
  successfulBracket: boolean;
  accurate: boolean;
  failureReason?: RefineFailureReason;
}

export const REFINE_MAX_ITER = 200;
export const REFINE_THRESHOLD_M = 0.001; // 1 mm

const REFINE_WALK_STEP = 0.1;
const REFINE_NULL_STEP = 0.05;
const REFINE_MAX_WALK = 5000;

type BracketFindResult =
  | { status: 'exact' }
  | { status: 'bracketed'; lo: number; hi: number }
  | { status: 'failed'; reason: RefineFailureReason };

function findSearchBracket(
  initSearch: number,
  errorAt: (searchVal: number) => number | null,
  threshold: number
): BracketFindResult {
  const err0 = errorAt(initSearch);
  if (err0 === null) {
    return { status: 'failed', reason: 'target_height' };
  }
  if (Math.abs(err0) < threshold) {
    return { status: 'exact' };
  }

  if (err0 < 0) {
    let lo = initSearch;
    let v = initSearch;
    for (let i = 0; i < REFINE_MAX_WALK; i++) {
      v += REFINE_WALK_STEP;
      const err = errorAt(v);
      if (err === null) continue;
      if (err > 0) {
        return { status: 'bracketed', lo, hi: v };
      }
      lo = v;
    }
    return { status: 'failed', reason: 'bracket' };
  }

  let lastLong = initSearch;
  let v = initSearch;
  for (let i = 0; i < REFINE_MAX_WALK; i++) {
    v -= REFINE_WALK_STEP;
    const err = errorAt(v);
    if (err === null) {
      return recoverBracketAfterNull(v, lastLong, errorAt);
    }
    if (err < 0) {
      return { status: 'bracketed', lo: v, hi: lastLong };
    }
    lastLong = v;
  }
  return { status: 'failed', reason: 'bracket' };
}

function recoverBracketAfterNull(
  vNull: number,
  lastLong: number,
  errorAt: (searchVal: number) => number | null
): BracketFindResult {
  let step = REFINE_NULL_STEP;
  let hi = lastLong;
  for (let i = 0; i < 10; i++) {
    const v = vNull - step;
    const err = errorAt(v);
    if (err !== null) {
      if (err < 0) {
        return { status: 'bracketed', lo: v, hi };
      }
      hi = v;
    }
    step /= 2;
  }
  return { status: 'failed', reason: 'target_height' };
}

function binarySearchLandingX(
  lo: number,
  hi: number,
  fixed: number,
  constMode: 'velocity' | 'angle',
  drag: number,
  magnus: number,
  targetDx: number,
  targetDy: number,
  maxIter: number,
  threshold: number
): number {
  let xLo = landingXAtGoalHeight(lo, fixed, constMode, drag, magnus, targetDy);
  let xHi = landingXAtGoalHeight(hi, fixed, constMode, drag, magnus, targetDy);
  if (xLo === null || xHi === null) {
    return (lo + hi) / 2;
  }

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const xMid = landingXAtGoalHeight(mid, fixed, constMode, drag, magnus, targetDy);
    if (xMid === null) break;

    const err = xMid - targetDx;
    if (Math.abs(err) < threshold) {
      lo = mid;
      hi = mid;
      break;
    }

    if ((xLo - targetDx) * err < 0) {
      hi = mid;
      xHi = xMid;
    } else {
      lo = mid;
      xLo = xMid;
    }
  }

  return (lo + hi) / 2;
}

function refineFailed(
  traj: GeneratedTrajectory,
  reason: RefineFailureReason
): RefineResult {
  return {
    trajectory: { ...traj, successfulBracket: false, accurate: false, refineFailure: reason },
    successfulBracket: false,
    accurate: false,
    failureReason: reason,
  };
}

// Refine a single trajectory: walk in 0.1 m/s (or 0.1°) steps to bracket, then binary search.
export function refineTrajectory(
  traj: GeneratedTrajectory,
  params: TrajGenParams,
  drag: number,
  magnus: number,
  maxIter: number,
  threshold: number,
  constMode: 'velocity' | 'angle' = 'velocity'
): RefineResult {
  const targetDx = params.dx;
  const targetDy = params.dy;
  const fixed = constMode === 'velocity' ? traj.exitVelocity : traj.exitAngle;
  const initSearch = constMode === 'velocity' ? traj.exitAngle : traj.exitVelocity;

  const errorAt = (searchVal: number): number | null => {
    const x = landingXAtGoalHeight(searchVal, fixed, constMode, drag, magnus, targetDy);
    return x !== null ? x - targetDx : null;
  };

  const bracket = findSearchBracket(initSearch, errorAt, threshold);

  if (bracket.status === 'failed') {
    return refineFailed(traj, bracket.reason);
  }

  if (bracket.status === 'exact') {
    const final = simulateLanding(
      constMode === 'velocity' ? fixed : initSearch,
      constMode === 'velocity' ? initSearch : fixed,
      drag, magnus, targetDy
    );
    return {
      trajectory: {
        ...traj,
        landingX: targetDx,
        successfulBracket: true,
        accurate: true,
        refineFailure: undefined,
        timeOfFlight: final ? Math.round(final.timeOfFlight * 1000) / 1000 : traj.timeOfFlight,
      },
      successfulBracket: true,
      accurate: true,
    };
  }

  const bestSearch = binarySearchLandingX(
    bracket.lo,
    bracket.hi,
    fixed,
    constMode,
    drag,
    magnus,
    targetDx,
    targetDy,
    maxIter,
    threshold
  );

  const bestV = constMode === 'velocity' ? fixed : bestSearch;
  const bestA = constMode === 'velocity' ? bestSearch : fixed;
  const final = simulateLanding(bestV, bestA, drag, magnus, targetDy);

  const landingErr = final !== null ? Math.abs(final.landingX - targetDx) : Infinity;
  const accurate = landingErr <= threshold;

  const refined: GeneratedTrajectory = {
    ...traj,
    exitVelocity: Math.round(bestV * 1000) / 1000,
    exitAngle: Math.round(bestA * 1000) / 1000,
    landingX: targetDx,
    timeOfFlight: final ? Math.round(final.timeOfFlight * 1000) / 1000 : traj.timeOfFlight,
    successfulBracket: true,
    accurate,
    refineFailure: undefined,
  };
  return { trajectory: refined, successfulBracket: true, accurate };
}

const REFINE_VEL_TOL = 0.05;
const REFINE_ANG_TOL = 0.25;

function dedupeTrajectories(trajectories: GeneratedTrajectory[]): GeneratedTrajectory[] {
  return trajectories.filter(
    (t, i) =>
      !trajectories
        .slice(0, i)
        .some(
          (other) =>
            Math.abs(other.exitVelocity - t.exitVelocity) <= REFINE_VEL_TOL &&
            Math.abs(other.exitAngle - t.exitAngle) <= REFINE_ANG_TOL
        )
  );
}

export function refineGroupTrajectories(
  group: TrajGroup,
  params: TrajGenParams,
  maxIter: number,
  threshold: number,
  constMode: 'velocity' | 'angle'
): GeneratedTrajectory[] {
  const drag = group.drag;
  const magnus = group.magnus;
  const gParams = { ...params, dx: group.dx, dy: group.dy };
  const results = group.trajectories.map((t) =>
    refineTrajectory(t, gParams, drag, magnus, maxIter, threshold, constMode)
  );
  const withValidity = results.map((r) => {
    const t = r.trajectory;
    const impact = simulateImpactAngle(t.exitVelocity, t.exitAngle, drag, magnus, group.dx);
    const withImpact = {
      ...t,
      impactAngle: impact !== null ? Math.round(impact * 100) / 100 : t.impactAngle,
    };
    if (!r.successfulBracket) return withImpact;
    const landing = simulateLanding(t.exitVelocity, t.exitAngle, drag, magnus, group.dy);
    const inGoal =
      landing !== null && Math.abs(landing.landingX - group.dx) <= RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
    return { ...withImpact, landingX: group.dx, successfulBracket: inGoal, accurate: r.accurate && inGoal };
  });
  return dedupeTrajectories(withValidity);
}

export function groupExportPayload(group: TrajGroup, errorTolerance: number) {
  const half = errorTolerance / 2;
  let biggestMOETrajectory = -1;
  let bestCombined = -1;

  const trajectories = group.trajectories.map((t, index) => {
    const moe = computeTrajectoryMoe(t, group.dx, group.dy, half, group.drag, group.magnus);
    if (moe && moe.combinedMoe > bestCombined) {
      bestCombined = moe.combinedMoe;
      biggestMOETrajectory = index;
    }

    const entry: Record<string, number> = {
      exitAngle: t.exitAngle,
      impactAngle: t.impactAngle,
      speed: t.exitVelocity,
      timeOfFlight: t.timeOfFlight,
      peakHeight:
        Math.round(simulatePeakHeight(t.exitVelocity, t.exitAngle, group.drag, group.magnus) * 1000) /
        1000,
    };
    if (moe) {
      entry.speedMoe = Math.round(moe.speedMoe * 1000) / 1000;
      entry.angleMoe = Math.round(moe.angleMoe * 1000) / 1000;
    }
    return entry;
  });

  return {
    dx: group.dx,
    dy: group.dy,
    dragCoeff: group.drag,
    magnusCoeff: group.magnus,
    ...(biggestMOETrajectory >= 0 ? { biggestMOETrajectory } : {}),
    trajectories,
  };
}

export function groupExportFileName(group: TrajGroup): string {
  return `(${group.dx}, ${group.dy}).json`;
}

function sanitizeArchiveName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

export function exportFolderName(params: TrajGenParams): string {
  const { dxMin, dxMax, dy } = params;
  return sanitizeArchiveName(`trajectories(${dxMin}, ${dy})_to_(${dxMax}, ${dy})`);
}

/** Download a zip; extracting yields folder trajectories(xmin,y)_to_(xmax,y) with (dx,dy).json files. */
export function downloadTrajectoriesArchive(groups: TrajGroup[], params: TrajGenParams): void {
  const groupsWithTrajs = groups.filter((g) => g.trajectories.length > 0);
  if (groupsWithTrajs.length === 0) return;

  const folderName = exportFolderName(params);
  const entries = groupsWithTrajs.map((g) => ({
    name: `${folderName}/${groupExportFileName(g)}`,
    data: new TextEncoder().encode(JSON.stringify(groupExportPayload(g, params.errorTolerance), null, 4)),
  }));

  const blob = buildStoreZip(entries);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${folderName}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}
