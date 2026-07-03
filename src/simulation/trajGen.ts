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
// falls within [dxMin - RAW/2, dxMax + RAW/2], or per-distance when regeneratePerDistanceStep.
export function generateTrajectories(
  params: TrajGenParams,
  drag: number,
  magnus: number
): GeneratedTrajectory[] {
  const magnusPower = resolveMagnusPower(params.magnusPower);
  if (params.regeneratePerDistanceStep) {
    const dxValues = enumerateDxValues(params.dxMin, params.dxMax, params.dxStep);
    const half = params.perDistanceErrorTolerance / 2;
    const results: GeneratedTrajectory[] = [];

    for (const targetDx of dxValues) {
      let vel = params.velocityMin;
      while (vel <= params.velocityMax + 1e-9) {
        let angle = params.exitAngleMin;
        while (angle <= params.exitAngleMax + 1e-9) {
          const landing = simulateLanding(vel, angle, drag, magnus, params.dy, magnusPower);
          if (
            landing !== null &&
            Math.abs(landing.landingX - targetDx) <= half
          ) {
            const impact = simulateImpactAngle(vel, angle, drag, magnus, landing.landingX, magnusPower);
            if (impact !== null && impact >= params.impactAngleMin && impact <= params.impactAngleMax) {
              results.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                exitVelocity: Math.round(vel * 100) / 100,
                exitAngle: Math.round(angle * 100) / 100,
                impactAngle: Math.round(impact * 100) / 100,
                timeOfFlight: Math.round(landing.timeOfFlight * 1000) / 1000,
                landingX: Math.round(landing.landingX * 1000) / 1000,
                generatedForDx: targetDx,
              });
            }
          }
          angle = Math.round((angle + params.angleStep) * 1e6) / 1e6;
        }
        vel = Math.round((vel + params.velocityStep) * 1e6) / 1e6;
      }
    }

    return results;
  }

  const results: GeneratedTrajectory[] = [];
  const xMin = params.dxMin - RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
  const xMax = params.dxMax + RAW_TRAJECTORY_ERROR_TOLERANCE / 2;

  let vel = params.velocityMin;
  while (vel <= params.velocityMax + 1e-9) {
    let angle = params.exitAngleMin;
    while (angle <= params.exitAngleMax + 1e-9) {
      const landing = simulateLanding(vel, angle, drag, magnus, params.dy, magnusPower);
      if (
        landing !== null &&
        landing.landingX >= xMin &&
        landing.landingX <= xMax
      ) {
        const impact = simulateImpactAngle(vel, angle, drag, magnus, landing.landingX, magnusPower);
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

export function countTrajGenSearchSteps(params: TrajGenParams): number {
  const combos = countTrajGenCombinations(params);
  if (!params.regeneratePerDistanceStep) return combos;
  return combos * enumerateDxValues(params.dxMin, params.dxMax, params.dxStep).length;
}

function assignRefinedTrajectory(
  traj: GeneratedTrajectory,
  params: TrajGenParams,
  dxValues: number[],
  groupTrajs: Map<number, GeneratedTrajectory[]>,
  drag: number,
  magnus: number,
  targetDxOverride?: number,
  targetDyOverride?: number
): void {
  const targetDx =
    targetDxOverride ??
    traj.generatedForDx ??
    closestIntervalPosition(traj.landingX, dxValues);
  const targetDy = targetDyOverride ?? params.dy;
  const magnusPower = resolveMagnusPower(params.magnusPower);
  const gParams = { ...params, dx: targetDx, dy: targetDy };
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
    targetDx,
    magnusPower
  );
  const withImpact = {
    ...refined,
    impactAngle: impact !== null ? Math.round(impact * 100) / 100 : refined.impactAngle,
    landingX: targetDx,
  };
  const landing = simulateLanding(refined.exitVelocity, refined.exitAngle, drag, magnus, targetDy, magnusPower);
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
      magnusPower: resolveMagnusPower(params.magnusPower),
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

function generateTrajectoriesPerDistanceAsync(
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

    const combosPerDx = countTrajGenCombinations(params);
    const totalCombos = combosPerDx * dxValues.length;
    const half = params.perDistanceErrorTolerance / 2;
    const magnusPower = resolveMagnusPower(params.magnusPower);
    const groupTrajs = new Map<number, GeneratedTrajectory[]>();
    for (const dx of dxValues) groupTrajs.set(dx, []);

    let dxIndex = 0;
    let comboIndex = 0;
    let vel = params.velocityMin;
    let angle = params.exitAngleMin;
    let found = 0;

    function reportSearch() {
      const globalCombo = dxIndex * combosPerDx + comboIndex;
      onProgress({
        phase: 'searching',
        current: globalCombo,
        total: totalCombos,
        found,
        progress: totalCombos > 0 ? globalCombo / totalCombos : 0,
      });
    }

    function searchStep() {
      if (signal.cancelled) {
        resolve([]);
        return;
      }

      let batch = TRAJ_GEN_YIELD_EVERY;
      while (batch > 0 && dxIndex < dxValues.length) {
        const targetDx = dxValues[dxIndex];

        while (angle <= params.exitAngleMax + 1e-9) {
          const landing = simulateLanding(vel, angle, drag, magnus, params.dy, magnusPower);
          if (
            landing !== null &&
            Math.abs(landing.landingX - targetDx) <= half
          ) {
            const impact = simulateImpactAngle(vel, angle, drag, magnus, landing.landingX, magnusPower);
            if (impact !== null && impact >= params.impactAngleMin && impact <= params.impactAngleMax) {
              groupTrajs.get(targetDx)!.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                exitVelocity: Math.round(vel * 100) / 100,
                exitAngle: Math.round(angle * 100) / 100,
                impactAngle: Math.round(impact * 100) / 100,
                timeOfFlight: Math.round(landing.timeOfFlight * 1000) / 1000,
                landingX: Math.round(landing.landingX * 1000) / 1000,
                generatedForDx: targetDx,
              });
              found++;
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

        if (vel > params.velocityMax + 1e-9) {
          dxIndex++;
          comboIndex = 0;
          vel = params.velocityMin;
          angle = params.exitAngleMin;
        }
      }

      if (dxIndex < dxValues.length) {
        reportSearch();
        setTimeout(searchStep, 0);
        return;
      }

      onProgress({
        phase: 'searching',
        current: totalCombos,
        total: totalCombos,
        found,
        progress: 1,
      });
      resolve(buildTrajectoryGroups(dxValues, groupTrajs, params, drag, magnus));
    }

    reportSearch();
    setTimeout(searchStep, 0);
  });
}

// Async search-only: sweep angle × velocity and group candidates without refining.
export function generateTrajectoriesAsync(
  params: TrajGenParams,
  drag: number,
  magnus: number,
  onProgress: (progress: TrajGenProgress) => void,
  signal: { cancelled: boolean }
): Promise<TrajGroup[]> {
  if (params.regeneratePerDistanceStep) {
    return generateTrajectoriesPerDistanceAsync(params, drag, magnus, onProgress, signal);
  }

  return new Promise((resolve) => {
    const dxValues = enumerateDxValues(params.dxMin, params.dxMax, params.dxStep);
    if (dxValues.length === 0) {
      resolve([]);
      return;
    }

    const totalCombos = countTrajGenCombinations(params);
    const xMin = params.dxMin - RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
    const xMax = params.dxMax + RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
    const magnusPower = resolveMagnusPower(params.magnusPower);
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
          const landing = simulateLanding(vel, angle, drag, magnus, params.dy, magnusPower);
          if (
            landing !== null &&
            landing.landingX >= xMin &&
            landing.landingX <= xMax
          ) {
            const impact = simulateImpactAngle(vel, angle, drag, magnus, landing.landingX, magnusPower);
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
export type RefineTrajectoryWork = {
  traj: GeneratedTrajectory;
  targetDx?: number;
  targetDy?: number;
};

function normalizeRefineWork(
  items: RefineTrajectoryWork[] | GeneratedTrajectory[]
): RefineTrajectoryWork[] {
  if (items.length === 0) return [];
  return 'traj' in items[0]
    ? (items as RefineTrajectoryWork[])
    : (items as GeneratedTrajectory[]).map((traj) => ({ traj }));
}

export function refineTrajectoriesAsync(
  items: RefineTrajectoryWork[] | GeneratedTrajectory[],
  params: TrajGenParams,
  drag: number,
  magnus: number,
  onProgress: (progress: TrajGenProgress) => void,
  signal: { cancelled: boolean }
): Promise<TrajGroup[]> {
  return new Promise((resolve) => {
    const work = normalizeRefineWork(items);
    const dxValues = enumerateDxValues(params.dxMin, params.dxMax, params.dxStep);
    if (dxValues.length === 0 || work.length === 0) {
      resolve([]);
      return;
    }

    const groupTrajs = new Map<number, GeneratedTrajectory[]>();
    for (const dx of dxValues) groupTrajs.set(dx, []);

    function reportRefine(index: number) {
      const total = work.length;
      onProgress({
        phase: 'refining',
        current: index,
        total,
        found: work.length,
        progress: total > 0 ? index / total : 0,
      });
    }

    function refineStep(index: number) {
      if (signal.cancelled) {
        resolve([]);
        return;
      }

      if (index >= work.length) {
        onProgress({
          phase: 'refining',
          current: work.length,
          total: work.length,
          found: work.length,
          progress: 1,
        });
        resolve(buildTrajectoryGroups(dxValues, groupTrajs, params, drag, magnus));
        return;
      }

      const { traj, targetDx, targetDy } = work[index];
      assignRefinedTrajectory(traj, params, dxValues, groupTrajs, drag, magnus, targetDx, targetDy);
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
    const work = groups.flatMap((g) =>
      g.trajectories.map((traj) => ({
        traj,
        targetDx: traj.generatedForDx ?? g.dx,
        targetDy: g.dy,
      }))
    );
    if (work.length === 0) return [];
    return refineTrajectoriesAsync(work, params, drag, magnus, onProgress, signal);
  });
}

// Helper: compute landingX at goal height for a given search variable, holding the other constant
function landingXAtGoalHeight(
  searchVal: number,
  fixed: number,
  constMode: 'velocity' | 'angle',
  drag: number,
  magnus: number,
  targetDy: number,
  magnusPower: number
): number | null {
  const v = constMode === 'velocity' ? fixed : searchVal;
  const a = constMode === 'velocity' ? searchVal : fixed;
  const result = simulateLanding(v, a, drag, magnus, targetDy, magnusPower);
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
  magnusPower: number,
  maxIter: number,
  threshold: number
): number {
  let xLo = landingXAtGoalHeight(lo, fixed, constMode, drag, magnus, targetDy, magnusPower);
  let xHi = landingXAtGoalHeight(hi, fixed, constMode, drag, magnus, targetDy, magnusPower);
  if (xLo === null || xHi === null) {
    return (lo + hi) / 2;
  }

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const xMid = landingXAtGoalHeight(mid, fixed, constMode, drag, magnus, targetDy, magnusPower);
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
  const magnusPower = resolveMagnusPower(params.magnusPower);
  const fixed = constMode === 'velocity' ? traj.exitVelocity : traj.exitAngle;
  const initSearch = constMode === 'velocity' ? traj.exitAngle : traj.exitVelocity;

  const errorAt = (searchVal: number): number | null => {
    const x = landingXAtGoalHeight(searchVal, fixed, constMode, drag, magnus, targetDy, magnusPower);
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
      drag, magnus, targetDy, magnusPower
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
    magnusPower,
    maxIter,
    threshold
  );

  const bestV = constMode === 'velocity' ? fixed : bestSearch;
  const bestA = constMode === 'velocity' ? bestSearch : fixed;
  const final = simulateLanding(bestV, bestA, drag, magnus, targetDy, magnusPower);

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
  const magnusPower = resolveMagnusPower(params.magnusPower);
  const results = group.trajectories.map((t) =>
    refineTrajectory(t, gParams, drag, magnus, maxIter, threshold, constMode)
  );
  const withValidity = results.map((r) => {
    const t = r.trajectory;
    const impact = simulateImpactAngle(t.exitVelocity, t.exitAngle, drag, magnus, group.dx, magnusPower);
    const withImpact = {
      ...t,
      impactAngle: impact !== null ? Math.round(impact * 100) / 100 : t.impactAngle,
    };
    if (!r.successfulBracket) return withImpact;
    const landing = simulateLanding(t.exitVelocity, t.exitAngle, drag, magnus, group.dy, magnusPower);
    const inGoal =
      landing !== null && Math.abs(landing.landingX - group.dx) <= RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
    return { ...withImpact, landingX: group.dx, successfulBracket: inGoal, accurate: r.accurate && inGoal };
  });
  return dedupeTrajectories(withValidity);
}
import type { GeneratedTrajectory, TrajGenParams, TrajGroup } from '../types';
import { resolveMagnusPower } from './physics';
import {
  simulateImpactAngle,
  simulateLanding,
} from './moe';
import type { TrajGenProgress } from './fit';

const TRAJ_GEN_YIELD_EVERY = 50;
