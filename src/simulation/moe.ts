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
  magnusPower = 2,
  dt = SIM_DT
): number | null {
  const pts = simulateShot(exitVelocity, exitAngleDeg, drag, magnus, SIM_MAX_TIME, dt, magnusPower);
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
  targetDy: number,
  magnusPower = 2
): { landingX: number; landingY: number; timeOfFlight: number } | null {
  const pts = simulateShot(exitVelocity, exitAngleDeg, drag, magnus, SIM_MAX_TIME, SIM_DT, magnusPower);
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

/** Format MOE as −below/+above, e.g. −0.30/+0.50 */
export function formatMoeBounds(minus: number, plus: number, decimals: number, unitSuffix = ''): string {
  return `−${minus.toFixed(decimals)}/+${plus.toFixed(decimals)}${unitSuffix}`;
}

/** Speed MOE display shared by list, hover tooltip, and charts. */
export function formatSpeedMoeBounds(moe: Pick<TrajectoryMoe, 'speedMoeMinus' | 'speedMoePlus'>): string {
  return formatMoeBounds(moe.speedMoeMinus, moe.speedMoePlus, 3);
}

const MOE_MAX_ITER = 50;
const MOE_SPEED_MAX_DELTA = 15; // m/s
const MOE_ANGLE_MAX_DELTA = 45; // deg
const MOE_SPEED_WALK_STEP = 0.1; // m/s
/** Unit vectors for a goal plane tilted angleDeg from horizontal (along = along-plane, normal = ⊥). */
export function goalPlaneBasis(angleDeg: number): {
  along: { x: number; y: number };
  normal: { x: number; y: number };
} {
  const rad = (angleDeg * Math.PI) / 180;
  const along = { x: Math.cos(rad), y: Math.sin(rad) };
  const normal = { x: -Math.sin(rad), y: Math.cos(rad) };
  return { along, normal };
}

/** Endpoints of the goal opening segment centered at (centerDx, centerDy) with half-width along the plane. */
export function goalPlaneSegment(
  centerDx: number,
  centerDy: number,
  halfWidth: number,
  angleDeg: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const { along } = goalPlaneBasis(angleDeg);
  return {
    x1: centerDx - halfWidth * along.x,
    y1: centerDy - halfWidth * along.y,
    x2: centerDx + halfWidth * along.x,
    y2: centerDy + halfWidth * along.y,
  };
}

/** Where the trajectory last crosses the goal plane; alongOffset is meters from center along the plane. */
export function simulateGoalPlaneCrossing(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  targetDx: number,
  targetDy: number,
  planeAngleDeg: number,
  magnusPower = 2,
): { alongOffset: number; x: number; y: number; timeOfFlight: number } | null {
  const { along, normal } = goalPlaneBasis(planeAngleDeg);
  const pts = simulateShot(exitVelocity, exitAngleDeg, drag, magnus, SIM_MAX_TIME, SIM_DT, magnusPower);
  let lastCross: { alongOffset: number; x: number; y: number; timeOfFlight: number } | null = null;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const fa = (a.x - targetDx) * normal.x + (a.y - targetDy) * normal.y;
    const fb = (b.x - targetDx) * normal.x + (b.y - targetDy) * normal.y;
    if (fa * fb > 0) continue;
    const denom = fb - fa;
    if (Math.abs(denom) < 1e-12) continue;
    const u = -fa / denom;
    if (u < 0 || u > 1) continue;
    const x = a.x + u * (b.x - a.x);
    const y = a.y + u * (b.y - a.y);
    if (x < -1e-9) continue;
    const alongOffset = (x - targetDx) * along.x + (y - targetDy) * along.y;
    lastCross = { alongOffset, x, y, timeOfFlight: (i + u) * SIM_DT };
  }

  return lastCross;
}

function shotLandsInGoal(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  targetDy: number,
  targetDx: number,
  goalHalfWidth: number,
  magnusPower: number,
  goalPlaneAngleDeg: number,
): boolean {
  if (exitVelocity <= 0) return false;
  const crossing = simulateGoalPlaneCrossing(
    exitVelocity,
    exitAngleDeg,
    drag,
    magnus,
    targetDx,
    targetDy,
    goalPlaneAngleDeg,
    magnusPower,
  );
  if (crossing === null) return false;
  return Math.abs(crossing.alongOffset) <= goalHalfWidth + 1e-12;
}

function landingEdgeError(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  targetDy: number,
  targetDx: number,
  goalHalfWidth: number,
  magnusPower: number,
  goalPlaneAngleDeg: number,
): number | null {
  if (exitVelocity <= 0) return null;
  const crossing = simulateGoalPlaneCrossing(
    exitVelocity,
    exitAngleDeg,
    drag,
    magnus,
    targetDx,
    targetDy,
    goalPlaneAngleDeg,
    magnusPower,
  );
  if (crossing === null) return null;
  return Math.abs(crossing.alongOffset) - goalHalfWidth;
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

/** Walk in fixed steps until the shot misses, then binary-search the boundary. */
function walkAndRefineOneSidedMargin(
  inGoalAtDelta: (delta: number) => boolean,
  edgeErrorAtDelta: (delta: number) => number | null,
  maxDelta: number,
  step: number,
): number {
  if (!inGoalAtDelta(0)) return 0;
  if (inGoalAtDelta(maxDelta)) return maxDelta;

  let lastIn = 0;
  let d = step;
  while (d <= maxDelta && inGoalAtDelta(d)) {
    lastIn = d;
    d += step;
  }

  if (inGoalAtDelta(maxDelta)) return maxDelta;

  const firstOut = Math.min(d, maxDelta);
  if (firstOut <= lastIn) return lastIn;

  let good = lastIn;
  let bad = firstOut;
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

function computeSpeedMoe(speedMoePlus: number, speedMoeMinus: number): number {
  return Math.min(speedMoePlus, speedMoeMinus);
}

function computeCombinedMoe(speedMoe: number, angleMoe: number): number {
  return Math.min(0.5, speedMoe) * Math.min(angleMoe, 3) * 0.15;
}

/** Prefer higher combined MOE; on ties prefer lower exit angle (lowest arc). */
export function isBetterOptimalTrajectory(
  combinedMoe: number,
  exitAngle: number,
  bestCombined: number,
  bestExitAngle: number,
): boolean {
  if (combinedMoe > bestCombined + 1e-12) return true;
  if (Math.abs(combinedMoe - bestCombined) <= 1e-12 && exitAngle < bestExitAngle - 1e-12) return true;
  return false;
}

/** Build MOE from fields stored in an imported trajectory JSON entry. */
export function moeFromImportedFields(t: GeneratedTrajectory): TrajectoryMoe | null {
  if (
    t.speedMoeMinus !== undefined &&
    t.speedMoePlus !== undefined &&
    t.angleMoeMinus !== undefined &&
    t.angleMoePlus !== undefined
  ) {
    const speedMoe = computeSpeedMoe(t.speedMoePlus, t.speedMoeMinus);
    const angleMoe = Math.min(t.angleMoePlus, t.angleMoeMinus);
    return {
      speedMoe,
      angleMoe,
      combinedMoe: computeCombinedMoe(speedMoe, angleMoe),
      speedMoePlus: t.speedMoePlus,
      speedMoeMinus: t.speedMoeMinus,
      angleMoePlus: t.angleMoePlus,
      angleMoeMinus: t.angleMoeMinus,
    };
  }
  if (t.speedMoe !== undefined && t.angleMoe !== undefined) {
    return {
      speedMoe: t.speedMoe,
      angleMoe: t.angleMoe,
      combinedMoe: computeCombinedMoe(t.speedMoe, t.angleMoe),
      speedMoePlus: t.speedMoePlus ?? t.speedMoe,
      speedMoeMinus: t.speedMoeMinus ?? t.speedMoe,
      angleMoePlus: t.angleMoePlus ?? t.angleMoe,
      angleMoeMinus: t.angleMoeMinus ?? t.angleMoe,
    };
  }
  return null;
}

/** Pick the trajectory with the largest combined MOE (lowest arc wins ties). */
export function pickBestTrajectoryForGroup(
  group: TrajGroup,
  trajMoeById: Map<string, TrajectoryMoe>,
): GeneratedTrajectory | null {
  let best: GeneratedTrajectory | null = null;
  let bestCombined = -1;
  let bestExitAngle = Infinity;
  for (const t of group.trajectories) {
    const moe = trajMoeById.get(t.id);
    if (!moe) continue;
    if (
      best === null ||
      isBetterOptimalTrajectory(moe.combinedMoe, t.exitAngle, bestCombined, bestExitAngle)
    ) {
      best = t;
      bestCombined = moe.combinedMoe;
      bestExitAngle = t.exitAngle;
    }
  }
  return best;
}

/** Max possible combined MOE from {@link computeCombinedMoe} (speed capped at 0.5, angle at 3). */
export const MOE_NORM_SCALE = computeCombinedMoe(0.5, 3);

export interface OptimalPickWeights {
  moeWeight: number;
  speedDerivWeight: number;
  angleDerivWeight: number;
  speedSecondDerivWeight: number;
  angleSecondDerivWeight: number;
  velocityBufferLineX1: number;
  velocityBufferLineY1: number;
  velocityBufferLineX2: number;
  velocityBufferLineY2: number;
  moeScale?: number;
  speedScale?: number;
  angleScale?: number;
  speedSecondDerivScale?: number;
  angleSecondDerivScale?: number;
}

export function optimalPickWeightsFromParams(params: TrajGenParams): OptimalPickWeights {
  return {
    moeWeight: params.optimalMoeWeight,
    speedDerivWeight: params.optimalSpeedDerivWeight,
    angleDerivWeight: params.optimalAngleDerivWeight,
    speedSecondDerivWeight: params.optimalSpeedSecondDerivWeight,
    angleSecondDerivWeight: params.optimalAngleSecondDerivWeight,
    velocityBufferLineX1: params.optimalVelocityBufferLineX1,
    velocityBufferLineY1: params.optimalVelocityBufferLineY1,
    velocityBufferLineX2: params.optimalVelocityBufferLineX2,
    velocityBufferLineY2: params.optimalVelocityBufferLineY2,
    moeScale: MOE_NORM_SCALE,
    speedScale: 1,
    angleScale: 1,
    speedSecondDerivScale: 1,
    angleSecondDerivScale: 1,
  };
}

export function velocityBufferThresholdAtDx(weights: OptimalPickWeights, dx: number): number {
  const x1 = weights.velocityBufferLineX1;
  const y1 = weights.velocityBufferLineY1;
  const x2 = weights.velocityBufferLineX2;
  const y2 = weights.velocityBufferLineY2;
  if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
    return 0;
  }
  if (Math.abs(x2 - x1) < 1e-9) return Math.max(0, (y1 + y2) / 2);
  return Math.max(0, y1 + ((dx - x1) / (x2 - x1)) * (y2 - y1));
}

export interface OptimalSequencePoint {
  dx: number;
  exitSpeed: number;
  exitAngle: number;
  trajId: string;
  groupId: string;
  velocityBuffer: number;
}

export function velocityBufferForTrajectory(group: TrajGroup, traj: GeneratedTrajectory): number {
  if (group.trajectories.length === 0) return 0;
  const minSpeed = Math.min(...group.trajectories.map((t) => t.exitVelocity));
  return traj.exitVelocity - minSpeed;
}

export type OptimalArc = 'low' | 'high';

export function lowestSpeedTrajectoryForGroup(group: TrajGroup): GeneratedTrajectory | null {
  let best: GeneratedTrajectory | null = null;
  for (const traj of group.trajectories) {
    if (
      best === null ||
      traj.exitVelocity < best.exitVelocity - 1e-12 ||
      (Math.abs(traj.exitVelocity - best.exitVelocity) <= 1e-12 && traj.exitAngle < best.exitAngle)
    ) {
      best = traj;
    }
  }
  return best;
}

export function boundaryAngleForLowestSpeed(group: TrajGroup): number {
  return lowestSpeedTrajectoryForGroup(group)?.exitAngle ?? 0;
}

export function isTrajectoryInArc(group: TrajGroup, traj: GeneratedTrajectory, arc: OptimalArc): boolean {
  const boundaryAngle = boundaryAngleForLowestSpeed(group);
  return arc === 'low'
    ? traj.exitAngle <= boundaryAngle + 1e-12
    : traj.exitAngle >= boundaryAngle - 1e-12;
}

export function buildOptimalSequencePoints(
  groups: TrajGroup[],
  bestTrajIds: Set<string>,
): OptimalSequencePoint[] {
  const points: OptimalSequencePoint[] = [];
  for (const g of groups) {
    const best = g.trajectories.find((t) => bestTrajIds.has(t.id));
    if (!best) continue;
    points.push({
      dx: g.dx,
      exitSpeed: best.exitVelocity,
      exitAngle: best.exitAngle,
      trajId: best.id,
      groupId: g.id,
      velocityBuffer: velocityBufferForTrajectory(g, best),
    });
  }
  points.sort((a, b) => a.dx - b.dx);
  return points;
}

export interface SequenceDerivativePoint {
  dx: number;
  dSpeedDx: number;
  dAngleDx: number;
}

/** Central/end-point finite differences of exit speed/angle vs goal distance. */
export function computeSequenceDerivatives(points: OptimalSequencePoint[]): SequenceDerivativePoint[] {
  if (points.length < 2) return [];
  const derivs: SequenceDerivativePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    let dSpeedDx: number;
    let dAngleDx: number;
    if (i === 0) {
      const h = points[1].dx - points[0].dx;
      dSpeedDx = h !== 0 ? (points[1].exitSpeed - points[0].exitSpeed) / h : 0;
      dAngleDx = h !== 0 ? (points[1].exitAngle - points[0].exitAngle) / h : 0;
    } else if (i === points.length - 1) {
      const h = points[i].dx - points[i - 1].dx;
      dSpeedDx = h !== 0 ? (points[i].exitSpeed - points[i - 1].exitSpeed) / h : 0;
      dAngleDx = h !== 0 ? (points[i].exitAngle - points[i - 1].exitAngle) / h : 0;
    } else {
      const h = points[i + 1].dx - points[i - 1].dx;
      dSpeedDx = h !== 0 ? (points[i + 1].exitSpeed - points[i - 1].exitSpeed) / h : 0;
      dAngleDx = h !== 0 ? (points[i + 1].exitAngle - points[i - 1].exitAngle) / h : 0;
    }
    derivs.push({ dx: points[i].dx, dSpeedDx, dAngleDx });
  }
  return derivs;
}

function segmentSmoothnessPenalty(
  prev: GeneratedTrajectory,
  curr: GeneratedTrajectory,
  dxPrev: number,
  dxCurr: number,
  weights: OptimalPickWeights,
): number {
  const h = dxCurr - dxPrev;
  if (h === 0) return 0;
  const speedScale = weights.speedScale ?? 1;
  const angleScale = weights.angleScale ?? 1;
  const dSpeedDx = (curr.exitVelocity - prev.exitVelocity) / h;
  const dAngleDx = (curr.exitAngle - prev.exitAngle) / h;
  return (
    weights.speedDerivWeight * Math.abs(dSpeedDx) / speedScale +
    weights.angleDerivWeight * Math.abs(dAngleDx) / angleScale
  );
}

function interiorSecondDerivPenalty(
  before: GeneratedTrajectory,
  mid: GeneratedTrajectory,
  after: GeneratedTrajectory,
  dxBefore: number,
  dxMid: number,
  dxAfter: number,
  weights: OptimalPickWeights,
): number {
  const h0 = dxMid - dxBefore;
  const h1 = dxAfter - dxMid;
  const hAvg = (h0 + h1) / 2;
  if (h0 === 0 || h1 === 0 || hAvg === 0) return 0;

  const speedSecondScale = weights.speedSecondDerivScale ?? 1;
  const angleSecondScale = weights.angleSecondDerivScale ?? 1;

  const d1LeftSpeed = (mid.exitVelocity - before.exitVelocity) / h0;
  const d1RightSpeed = (after.exitVelocity - mid.exitVelocity) / h1;
  const d2Speed = (d1RightSpeed - d1LeftSpeed) / hAvg;

  const d1LeftAngle = (mid.exitAngle - before.exitAngle) / h0;
  const d1RightAngle = (after.exitAngle - mid.exitAngle) / h1;
  const d2Angle = (d1RightAngle - d1LeftAngle) / hAvg;

  return (
    weights.speedSecondDerivWeight * Math.abs(d2Speed) / speedSecondScale +
    weights.angleSecondDerivWeight * Math.abs(d2Angle) / angleSecondScale
  );
}

function isBetterPathScore(
  score: number,
  exitAngle: number,
  bestScore: number,
  bestExitAngle: number,
): boolean {
  if (score > bestScore + 1e-12) return true;
  if (Math.abs(score - bestScore) <= 1e-12 && exitAngle < bestExitAngle - 1e-12) return true;
  return false;
}

function pickBestTrajectoryForArcFallback(
  groups: TrajGroup[],
  trajMoeById: Map<string, TrajectoryMoe>,
  arc: OptimalArc,
): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) {
    const arcGroup = {
      ...g,
      trajectories: g.trajectories.filter((t) => isTrajectoryInArc(g, t, arc)),
    };
    const best = pickBestTrajectoryForGroup(arcGroup, trajMoeById);
    if (best) ids.add(best.id);
  }
  return ids;
}

/**
 * Pick one trajectory per goal distance to maximize MOE while penalizing large
 * |d(speed)/dx|, |d(angle)/dx|, and second derivatives. Candidates are limited
 * by arc class and the velocity-buffer threshold line, with closest-buffer
 * fallback when no trajectory in a class reaches the threshold.
 */
export function pickOptimalTrajectoryPathForArc(
  groups: TrajGroup[],
  trajMoeById: Map<string, TrajectoryMoe>,
  weights: OptimalPickWeights,
  arc: OptimalArc,
): Set<string> {
  const sorted = [...groups].sort((a, b) => a.dx - b.dx || a.dy - b.dy);
  if (sorted.length === 0) return new Set();

  const moeScale = weights.moeScale ?? MOE_NORM_SCALE;
  type Cand = { traj: GeneratedTrajectory; moeTerm: number };
  const cands: Cand[][] = sorted.map((g) => {
    const classTrajs = g.trajectories.filter((t) => isTrajectoryInArc(g, t, arc));
    const threshold = velocityBufferThresholdAtDx(weights, g.dx);
    let eligible = classTrajs.filter((t) => velocityBufferForTrajectory(g, t) >= threshold - 1e-12);
    if (eligible.length === 0 && classTrajs.length > 0) {
      const closestBuffer = Math.max(...classTrajs.map((t) => velocityBufferForTrajectory(g, t)));
      eligible = classTrajs.filter((t) =>
        Math.abs(velocityBufferForTrajectory(g, t) - closestBuffer) <= 1e-12
      );
    }

    const list: Cand[] = [];
    for (const t of eligible) {
      const moe = trajMoeById.get(t.id);
      if (!moe) continue;
      list.push({
        traj: t,
        moeTerm: (weights.moeWeight * moe.combinedMoe) / moeScale,
      });
    }
    return list;
  });

  if (cands.some((list) => list.length === 0)) {
    return pickBestTrajectoryForArcFallback(sorted, trajMoeById, arc);
  }

  const n = sorted.length;
  const dp: number[][] = Array.from({ length: n }, () => []);
  const parent: number[][] = Array.from({ length: n }, () => []);

  for (let j = 0; j < cands[0].length; j++) {
    dp[0][j] = cands[0][j].moeTerm;
    parent[0][j] = -1;
  }

  for (let i = 1; i < n; i++) {
    for (let j = 0; j < cands[i].length; j++) {
      const curr = cands[i][j];
      let bestScore = -Infinity;
      let bestExitAngle = Infinity;
      let bestK = -1;
      for (let k = 0; k < cands[i - 1].length; k++) {
        const prev = cands[i - 1][k];
        const prevScore = dp[i - 1][k];
        if (!Number.isFinite(prevScore)) continue;
        let penalty = segmentSmoothnessPenalty(
          prev.traj,
          curr.traj,
          sorted[i - 1].dx,
          sorted[i].dx,
          weights,
        );
        if (i >= 2) {
          const kPrev = parent[i - 1][k];
          if (kPrev >= 0) {
            penalty += interiorSecondDerivPenalty(
              cands[i - 2][kPrev].traj,
              prev.traj,
              curr.traj,
              sorted[i - 2].dx,
              sorted[i - 1].dx,
              sorted[i].dx,
              weights,
            );
          }
        }
        const score = prevScore + curr.moeTerm - penalty;
        if (
          bestK < 0 ||
          isBetterPathScore(score, curr.traj.exitAngle, bestScore, bestExitAngle)
        ) {
          bestScore = score;
          bestExitAngle = curr.traj.exitAngle;
          bestK = k;
        }
      }
      if (bestK < 0) return pickBestTrajectoryForArcFallback(sorted, trajMoeById, arc);
      dp[i][j] = bestScore;
      parent[i][j] = bestK;
    }
  }

  let bestJ = 0;
  let bestFinal = dp[n - 1][0];
  for (let j = 1; j < cands[n - 1].length; j++) {
    const s = dp[n - 1][j];
    if (isBetterPathScore(s, cands[n - 1][j].traj.exitAngle, bestFinal, cands[n - 1][bestJ].traj.exitAngle)) {
      bestFinal = s;
      bestJ = j;
    }
  }

  const picks = new Array<number>(n);
  picks[n - 1] = bestJ;
  for (let i = n - 1; i > 0; i--) {
    const pick = picks[i];
    if (!Number.isInteger(pick) || pick < 0 || pick >= cands[i].length) {
      return pickBestTrajectoryForArcFallback(sorted, trajMoeById, arc);
    }
    const prevPick = parent[i][pick];
    if (!Number.isInteger(prevPick) || prevPick < 0 || prevPick >= cands[i - 1].length) {
      return pickBestTrajectoryForArcFallback(sorted, trajMoeById, arc);
    }
    picks[i - 1] = prevPick;
  }

  const ids = new Set<string>();
  for (let i = 0; i < n; i++) {
    if (!Number.isInteger(picks[i]) || picks[i] < 0 || picks[i] >= cands[i].length) {
      return pickBestTrajectoryForArcFallback(sorted, trajMoeById, arc);
    }
    ids.add(cands[i][picks[i]].traj.id);
  }
  return ids;
}

export function pickOptimalTrajectoryPaths(
  groups: TrajGroup[],
  trajMoeById: Map<string, TrajectoryMoe>,
  weights: OptimalPickWeights,
): { lowArcIds: Set<string>; highArcIds: Set<string>; allIds: Set<string> } {
  const lowArcIds = pickOptimalTrajectoryPathForArc(groups, trajMoeById, weights, 'low');
  const highArcIds = pickOptimalTrajectoryPathForArc(groups, trajMoeById, weights, 'high');
  return { lowArcIds, highArcIds, allIds: new Set([...lowArcIds, ...highArcIds]) };
}

export function pickOptimalTrajectoryPath(
  groups: TrajGroup[],
  trajMoeById: Map<string, TrajectoryMoe>,
  weights: OptimalPickWeights,
): Set<string> {
  return pickOptimalTrajectoryPaths(groups, trajMoeById, weights).allIds;
}

export function computeTrajectoryMoe(
  traj: GeneratedTrajectory,
  targetDx: number,
  targetDy: number,
  goalHalfWidth: number,
  drag: number,
  magnus: number,
  magnusPower = 2,
  goalPlaneAngleDeg = 0,
): TrajectoryMoe | null {
  if (traj.successfulBracket === false || traj.accurate === false) return null;

  const inGoal = (vel: number, angle: number) =>
    shotLandsInGoal(
      vel,
      angle,
      drag,
      magnus,
      targetDy,
      targetDx,
      goalHalfWidth,
      magnusPower,
      goalPlaneAngleDeg,
    );

  const nominalVel = traj.exitVelocity;
  const nominalAngle = traj.exitAngle;

  if (!inGoal(nominalVel, nominalAngle)) return null;

  const edgeErr = (vel: number, angle: number) =>
    landingEdgeError(
      vel,
      angle,
      drag,
      magnus,
      targetDy,
      targetDx,
      goalHalfWidth,
      magnusPower,
      goalPlaneAngleDeg,
    );

  // Symmetric search span around nominal speed so +/− margins are comparable (avoid
  // capping drop margin at nominalVel while allowing +margin searches up to 15 m/s).
  const speedMaxDelta = Math.min(MOE_SPEED_MAX_DELTA, nominalVel);

  const speedMoePlus = walkAndRefineOneSidedMargin(
    (d) => inGoal(nominalVel + d, nominalAngle),
    (d) => edgeErr(nominalVel + d, nominalAngle),
    speedMaxDelta,
    MOE_SPEED_WALK_STEP,
  );
  const speedMoeMinus = walkAndRefineOneSidedMargin(
    (d) => nominalVel - d > 0 && inGoal(nominalVel - d, nominalAngle),
    (d) => (nominalVel - d > 0 ? edgeErr(nominalVel - d, nominalAngle) : null),
    speedMaxDelta,
    MOE_SPEED_WALK_STEP,
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

  const speedMoe = computeSpeedMoe(speedMoePlus, speedMoeMinus);
  const angleMoe = Math.min(angleMoePlus, angleMoeMinus);
  const combinedMoe = computeCombinedMoe(speedMoe, angleMoe);

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
  magnusPower: number,
  goalPlaneAngleDeg: number,
): void {
  if (!forceRecalculate) {
    const imported = moeFromImportedFields(t);
    if (imported) {
      map.set(t.id, imported);
      return;
    }
  }
  const moe = computeTrajectoryMoe(
    t,
    g.dx,
    g.dy,
    half,
    g.drag,
    g.magnus,
    magnusPower,
    goalPlaneAngleDeg,
  );
  if (moe) map.set(t.id, moe);
}

export interface MoeSettings {
  errorTolerance: number;
  magnusPower: number;
  goalPlaneAngleDeg: number;
}

/** Recompute MOE entries for specific trajectories in one group (mutates map). */
export function syncGroupMoeInMap(
  map: Map<string, TrajectoryMoe>,
  group: TrajGroup,
  settings: MoeSettings,
  trajIds: string[],
): void {
  if (trajIds.length === 0) return;
  const idSet = new Set(trajIds);
  const half = settings.errorTolerance / 2;
  for (const t of group.trajectories) {
    if (!idSet.has(t.id)) continue;
    const moe = computeTrajectoryMoe(
      t,
      group.dx,
      group.dy,
      half,
      group.drag,
      group.magnus,
      settings.magnusPower,
      settings.goalPlaneAngleDeg,
    );
    if (moe) map.set(t.id, moe);
    else map.delete(t.id);
  }
}

/** Trajectory ids that need MOE recomputed after a group edit. */
export function trajIdsNeedingMoeRecompute(
  oldTrajs: GeneratedTrajectory[],
  newTrajs: GeneratedTrajectory[],
): { removed: string[]; recompute: string[] } {
  const oldById = new Map(oldTrajs.map((t) => [t.id, t]));
  const newIds = new Set(newTrajs.map((t) => t.id));
  const removed = oldTrajs.filter((t) => !newIds.has(t.id)).map((t) => t.id);
  const recompute: string[] = [];
  for (const t of newTrajs) {
    const old = oldById.get(t.id);
    if (
      !old ||
      old.exitVelocity !== t.exitVelocity ||
      old.exitAngle !== t.exitAngle ||
      old.successfulBracket !== t.successfulBracket ||
      old.accurate !== t.accurate
    ) {
      recompute.push(t.id);
    }
  }
  return { removed, recompute };
}

export function buildTrajectoryMoeMap(
  groups: TrajGroup[],
  errorTolerance: number,
  forceRecalculate = false,
  magnusPower = 2,
  goalPlaneAngleDeg = 0,
): Map<string, TrajectoryMoe> {
  const map = new Map<string, TrajectoryMoe>();
  const half = errorTolerance / 2;
  for (const g of groups) {
    for (const t of g.trajectories) {
      appendTrajectoryMoe(map, g, t, half, forceRecalculate, magnusPower, goalPlaneAngleDeg);
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
  magnusPower = 2,
  goalPlaneAngleDeg = 0,
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
        appendTrajectoryMoe(map, group, traj, half, forceRecalculate, magnusPower, goalPlaneAngleDeg);
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
import type { GeneratedTrajectory, TrajGenParams, TrajGroup } from '../types';
import { SIM_DT, SIM_MAX_TIME, simulateShot } from './physics';

const REFINE_THRESHOLD_M = 0.001;
const TRAJ_GEN_YIELD_EVERY = 50;
