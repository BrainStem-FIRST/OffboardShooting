import type { GeneratedTrajectory, TrajGenParams, TrajectoryPoint, TrajGroup } from './types';
import { isPlottedPoint, plottedPoints } from './utils/trajectorySegments';

export interface SimPoint {
  x: number; // meters from launch
  y: number; // meters above launch point
}

/** Speed (m/s) between two plotted points using pixel scale and video framerate. */
export function speedBetweenPoints(
  p1: TrajectoryPoint,
  p2: TrajectoryPoint,
  pixelsPerMeter: number,
  framerate: number
): number | null {
  if (!isPlottedPoint(p1) || !isPlottedPoint(p2)) return null;
  if (pixelsPerMeter <= 0 || framerate <= 0) return null;
  const frameDelta = p2.frame - p1.frame;
  if (frameDelta <= 0) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  const distM = distPx / pixelsPerMeter;
  const dt = frameDelta / framerate;
  return distM / dt;
}

/** Launch angle (degrees from horizontal) from the first two plotted points. */
export function angleBetweenPoints(
  p1: TrajectoryPoint,
  p2: TrajectoryPoint,
  pixelsPerMeter: number
): number | null {
  if (!isPlottedPoint(p1) || !isPlottedPoint(p2)) return null;
  if (pixelsPerMeter <= 0) return null;
  if (p2.frame - p1.frame <= 0) return null;
  const physDx = (p2.x - p1.x) / pixelsPerMeter;
  const physDy = (p1.y - p2.y) / pixelsPerMeter;
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
  pixelsPerMeter: number,
  framerate: number
): TrajectoryPoint[] {
  const plotted = plottedPoints(points);
  if (plotted.length === 0 || pixelsPerMeter <= 0 || framerate <= 0) return [];
  const sorted = [...plotted].sort((a, b) => a.frame - b.frame);
  const frame0 = sorted[0].frame;
  return sorted.map((pt, i) => {
    if (i === 0) return { ...pt };
    const t = (pt.frame - frame0) / framerate;
    // x = 0.5 * a * t^2
    const offsetPx = 0.5 * GRAVITY_MS2 * t * t * pixelsPerMeter;
    return { x: pt.x, y: pt.y - offsetPx, frame: pt.frame };
  });
}

function toPhysicalMeters(points: TrajectoryPoint[], pixelsPerMeter: number): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const p0 = points[0];
  return points.map((p) => ({
    x: (p.x - p0.x) / pixelsPerMeter,
    y: (p0.y - p.y) / pixelsPerMeter,
  }));
}

/** R² of a linear fit (y ~ x) to points in physical coordinates. 1 = perfectly straight. */
export function lineFitR2(points: TrajectoryPoint[], pixelsPerMeter: number): number | null {
  if (points.length < 2 || pixelsPerMeter <= 0) return null;
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
  pixelsPerMeter: number
): number | null {
  if (points.length < 3 || pixelsPerMeter <= 0) return null;
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
  pixelsPerMeter: number,
  framerate: number,
  numPoints: number
): GravityCorrectionQuality {
  const sorted = plottedPoints(points).sort((a, b) => a.frame - b.frame);
  const n = Math.max(2, Math.floor(numPoints));
  if (sorted.length < n || pixelsPerMeter <= 0 || framerate <= 0) {
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
  pixelsPerMeter: number,
  framerate: number,
  numPoints: number
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
    const angle = angleBetweenPoints(corrected[i], corrected[i + 1], pixelsPerMeter);
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
  magnusMin: -0.5,
  magnusMax: 0.5,
  magnusPowerMin: 1,
  magnusPowerMax: 3,
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

const TOP_FIT_COUNT = 10;

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
  ppm: number,
  framerate: number
): { obs: { t: number; x: number; y: number }[]; simMaxTime: number } | null {
  const sorted = plottedPoints(trajectory).sort((a, b) => a.frame - b.frame);
  if (sorted.length < 3 || ppm <= 0 || framerate <= 0) return null;

  const launch = sorted[0];
  const frame0 = launch.frame;
  const obs = sorted.map((p) => ({
    t: (p.frame - frame0) / framerate,
    x: (p.x - launch.x) / ppm,
    y: (launch.y - p.y) / ppm,
  }));
  if (obs[obs.length - 1].t <= 0) return null;

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
  pixelsPerMeter: number;
  framerate: number;
}

interface FitObservationSet {
  obs: { t: number; x: number; y: number }[];
  simMaxTime: number;
  fixed: FitSimParams;
}

function buildObservationSets(trajectories: FitTrajectoryInput[]): FitObservationSet[] {
  const sets: FitObservationSet[] = [];
  for (const traj of trajectories) {
    const prepped = preprocessObservations(traj.points, traj.pixelsPerMeter, traj.framerate);
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
  ppm: number,
  framerate: number
): TrajectoryFitCost | null {
  const prepped = preprocessObservations(points, ppm, framerate);
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

// Simulate a single shot and return landing info (where y crosses dy)
// drag and magnus from global sim params passed in
export function simulateLanding(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  targetDx: number,
  targetDy: number
): { landingX: number; landingY: number; timeOfFlight: number } | null {
  const pts = simulateShot(exitVelocity, exitAngleDeg, drag, magnus, SIM_MAX_TIME, SIM_DT);
  // Find the point where x crosses targetDx
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.x <= targetDx && b.x >= targetDx) {
      const t2 = (targetDx - a.x) / (b.x - a.x);
      const y = a.y + t2 * (b.y - a.y);
      const time = (i + t2) * SIM_DT;
      return { landingX: targetDx, landingY: y, timeOfFlight: time };
    }
  }
  return null;
}

// Generate all valid trajectories that land within the goal and satisfy angle constraints
export function generateTrajectories(
  params: TrajGenParams,
  drag: number,
  magnus: number
): GeneratedTrajectory[] {
  const results: GeneratedTrajectory[] = [];

  let vel = params.velocityMin;
  while (vel <= params.velocityMax + 1e-9) {
    let angle = params.exitAngleMin;
    while (angle <= params.exitAngleMax + 1e-9) {
      const landing = simulateLanding(vel, angle, drag, magnus, params.dx, params.dy);
      if (landing !== null) {
        if (Math.abs(landing.landingY - params.dy) <= 0.05) {
          const impact = simulateImpactAngle(vel, angle, drag, magnus, params.dx);
          if (impact !== null && impact >= params.impactAngleMin && impact <= params.impactAngleMax) {
            results.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              exitVelocity: Math.round(vel * 100) / 100,
              exitAngle: Math.round(angle * 100) / 100,
              impactAngle: Math.round(impact * 100) / 100,
              timeOfFlight: Math.round(landing.timeOfFlight * 1000) / 1000,
              landingX: params.dx,
            });
          }
        }
      }
      angle = Math.round((angle + params.angleStep) * 1e6) / 1e6;
    }
    vel = Math.round((vel + params.velocityStep) * 1e6) / 1e6;
  }

  return results;
}

// Helper: compute landingY for a given search variable, holding the other constant
function landingY(
  searchVal: number,
  fixed: number,
  constMode: 'velocity' | 'angle',
  drag: number,
  magnus: number,
  dx: number,
  dy: number
): number | null {
  const v = constMode === 'velocity' ? fixed : searchVal;
  const a = constMode === 'velocity' ? searchVal : fixed;
  const result = simulateLanding(v, a, drag, magnus, dx, dy);
  return result ? result.landingY : null;
}

// Refine a single trajectory using binary search.
// constMode='velocity': hold velocity, vary angle in 0.5° steps to bracket
// constMode='angle': hold angle, vary velocity in 0.05 m/s steps to bracket
export function refineTrajectory(
  traj: GeneratedTrajectory,
  params: TrajGenParams,
  drag: number,
  magnus: number,
  maxIter: number,
  threshold: number,
  constMode: 'velocity' | 'angle' = 'velocity'
): { trajectory: GeneratedTrajectory; successfulBracket: boolean; accurate: boolean } {
  const target = params.dy;
  const fixed = constMode === 'velocity' ? traj.exitVelocity : traj.exitAngle;
  const initSearch = constMode === 'velocity' ? traj.exitAngle : traj.exitVelocity;
  const step = constMode === 'velocity' ? 0.5 : 0.05; // degrees or m/s

  const err0 = (() => {
    const y = landingY(initSearch, fixed, constMode, drag, magnus, params.dx, target);
    return y !== null ? y - target : null;
  })();
  if (err0 === null) {
    return { trajectory: { ...traj, successfulBracket: false, accurate: false }, successfulBracket: false, accurate: false };
  }
  if (Math.abs(err0) < threshold) {
    // Already accurate — no bracket search needed
    const final = simulateLanding(
      constMode === 'velocity' ? fixed : initSearch,
      constMode === 'velocity' ? initSearch : fixed,
      drag, magnus, params.dx, params.dy
    );
    return {
      trajectory: { ...traj, successfulBracket: true, accurate: true, timeOfFlight: final ? Math.round(final.timeOfFlight * 1000) / 1000 : traj.timeOfFlight },
      successfulBracket: true, accurate: true,
    };
  }

  // Probe one step in each direction, pick the direction that reduces error
  const errPos = (() => {
    const y = landingY(initSearch + step, fixed, constMode, drag, magnus, params.dx, target);
    return y !== null ? y - target : null;
  })();
  const errNeg = (() => {
    const y = landingY(initSearch - step, fixed, constMode, drag, magnus, params.dx, target);
    return y !== null ? y - target : null;
  })();

  // Choose direction: prefer the side whose error is smaller in magnitude
  // (that's the direction moving toward the root)
  let dir = 1; // +step direction by default
  if (errPos === null && errNeg === null) {
    return { trajectory: { ...traj, successfulBracket: false, accurate: false }, successfulBracket: false, accurate: false };
  }
  if (errPos === null) dir = -1;
  else if (errNeg === null) dir = 1;
  else dir = Math.abs(errPos) < Math.abs(errNeg) ? 1 : -1;

  // Walk in the chosen direction until error changes sign (bracket found)
  let a = initSearch;
  let errA = err0;
  let b = initSearch + dir * step;
  let errB = dir === 1 ? (errPos ?? err0) : (errNeg ?? err0);
  let found = errA * errB < 0;

  for (let i = 0; i < 400 && !found; i++) {
    a = b;
    errA = errB;
    b = a + dir * step;
    const y = landingY(b, fixed, constMode, drag, magnus, params.dx, target);
    if (y === null) break;
    errB = y - target;
    if (errA * errB < 0) { found = true; }
  }

  // If no bracket found, return original trajectory unchanged
  if (!found) {
    return { trajectory: { ...traj, successfulBracket: false, accurate: false }, successfulBracket: false, accurate: false };
  }

  // Ensure lo < hi
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  let yLo = landingY(lo, fixed, constMode, drag, magnus, params.dx, target);
  let yHi = landingY(hi, fixed, constMode, drag, magnus, params.dx, target);
  if (yLo === null || yHi === null) {
    return { trajectory: { ...traj, successfulBracket: false, accurate: false }, successfulBracket: false, accurate: false };
  }

  // Binary search within [lo, hi]
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const yMid = landingY(mid, fixed, constMode, drag, magnus, params.dx, target);
    if (yMid === null) break;

    const err = yMid - target;
    if (Math.abs(err) < threshold) {
      lo = mid;
      hi = mid;
      break;
    }

    // Narrow the interval: keep the side whose endpoint is on the opposite side of target from mid
    if ((yLo! - target) * (err) < 0) {
      hi = mid;
      yHi = yMid;
    } else {
      lo = mid;
      yLo = yMid;
    }
  }

  const bestSearch = (lo + hi) / 2;
  const bestV = constMode === 'velocity' ? fixed : bestSearch;
  const bestA = constMode === 'velocity' ? bestSearch : fixed;
  const final = simulateLanding(bestV, bestA, drag, magnus, params.dx, params.dy);

  const landingErr = final !== null ? Math.abs(final.landingY - params.dy) : Infinity;
  const accurate = landingErr <= threshold;

  const refined: GeneratedTrajectory = {
    ...traj,
    exitVelocity: Math.round(bestV * 1000) / 1000,
    exitAngle: Math.round(bestA * 1000) / 1000,
    timeOfFlight: final ? Math.round(final.timeOfFlight * 1000) / 1000 : traj.timeOfFlight,
    successfulBracket: true,
    accurate,
  };
  return { trajectory: refined, successfulBracket: true, accurate };
}

const REFINE_VEL_TOL = 0.05;
const REFINE_ANG_TOL = 0.25;

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
    const landing = simulateLanding(t.exitVelocity, t.exitAngle, drag, magnus, group.dx, group.dy);
    const inGoal =
      landing !== null && Math.abs(landing.landingY - group.dy) <= params.goalWidth / 2;
    return { ...withImpact, successfulBracket: inGoal, accurate: r.accurate };
  });
  return withValidity.filter(
    (t, i) =>
      !withValidity
        .slice(0, i)
        .some(
          (other) =>
            Math.abs(other.exitVelocity - t.exitVelocity) <= REFINE_VEL_TOL &&
            Math.abs(other.exitAngle - t.exitAngle) <= REFINE_ANG_TOL
        )
  );
}

export function groupExportPayload(group: TrajGroup) {
  return {
    dx: group.dx,
    dy: group.dy,
    dragCoeff: group.drag,
    magnusCoeff: group.magnus,
    trajectories: group.trajectories.map((t) => ({
      exitAngle: t.exitAngle,
      impactAngle: t.impactAngle,
      speed: t.exitVelocity,
      timeOfFlight: t.timeOfFlight,
      peakHeight:
        Math.round(simulatePeakHeight(t.exitVelocity, t.exitAngle, group.drag, group.magnus) * 1000) /
        1000,
    })),
  };
}

export function groupExportFileName(baseName: string, group: TrajGroup): string {
  const name = (baseName.trim() || 'trajectories').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return `${name} (${group.dx.toFixed(3)}, ${group.dy.toFixed(3)}).json`;
}

export type ExportTrajectoriesResult =
  | { ok: true; count: number }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

async function ensureDirWritePermission(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Pick a folder once and write one JSON file per group. */
export async function exportTrajectoriesToFolder(
  groups: TrajGroup[],
  baseName: string
): Promise<ExportTrajectoriesResult> {
  const groupsWithTrajs = groups.filter((g) => g.trajectories.length > 0);
  if (groupsWithTrajs.length === 0) {
    return { ok: false, cancelled: false, message: 'No trajectories to export.' };
  }

  if (typeof window.showDirectoryPicker !== 'function') {
    return {
      ok: false,
      cancelled: false,
      message: 'Folder export requires Chrome or Edge. Your browser does not support folder selection.',
    };
  }

  let dirHandle: FileSystemDirectoryHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') {
      return { ok: false, cancelled: true };
    }
    return { ok: false, cancelled: false, message: `Could not open folder: ${(err as Error).message}` };
  }

  if (!(await ensureDirWritePermission(dirHandle))) {
    return { ok: false, cancelled: false, message: 'Write permission was denied for the selected folder.' };
  }

  for (const g of groupsWithTrajs) {
    const fileName = groupExportFileName(baseName, g);
    const content = JSON.stringify(groupExportPayload(g), null, 4);
    const blob = new Blob([content], { type: 'application/json' });

    try {
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(blob);
        await writable.close();
      } catch (writeErr) {
        try {
          await writable.abort();
        } catch {
          /* ignore */
        }
        throw writeErr;
      }
    } catch (err) {
      return {
        ok: false,
        cancelled: false,
        message: `Failed to write "${fileName}": ${(err as Error).message}`,
      };
    }
  }

  return { ok: true, count: groupsWithTrajs.length };
}
