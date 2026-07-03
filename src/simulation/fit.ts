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
  xdir: 1 | -1 = 1,
  frameTimes?: number[]
): { obs: { t: number; x: number; y: number }[]; simMaxTime: number } | null {
  const sorted = plottedPoints(trajectory).sort((a, b) => a.frame - b.frame);
  if (sorted.length < 3 || !ppmValid(ppmSource) || (!frameTimes?.length && framerate <= 0)) return null;

  const launch = sorted[0];
  const frame0 = launch.frame;
  const obs = sorted.map((p) => {
    const ppm = resolvePpm(ppmSource, p.x);
    if (ppm <= 0) return null;
    return {
      t: elapsedSeconds(frameTimes, framerate, p.frame, frame0),
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
  frameTimes?: number[];
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
      traj.xdir ?? 1,
      traj.frameTimes
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
  xdir: 1 | -1 = 1,
  frameTimes?: number[]
): TrajectoryFitCost | null {
  const prepped = preprocessObservations(points, ppm, framerate, xdir, frameTimes);
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

import type { TrajectoryPoint } from '../types';
import { elapsedSeconds } from '../utils/frameTiming';
import { plottedPoints } from '../utils/trajectorySegments';
import {
  interpSimAtTime,
  ppmValid,
  resolvePpm,
  SIM_DT,
  SIM_MAX_TIME,
  simulateShot,
  type PixelsPerMeterSource,
} from './physics';
