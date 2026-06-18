import type { GeneratedTrajectory, TrajGenParams, TrajectoryPoint, TrajGroup } from './types';

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

// Simulate projectile with drag (F = b * v^2) and Magnus lift (ay += magnusGain * v, upward)
// Returns array of (x, y) in meters
export function simulateShot(
  exitVelocity: number,
  exitAngleDeg: number,
  dragCoefficient: number,
  magnusGain = 0,
  maxTime = 10,
  dt = 0.005
): SimPoint[] {
  const g = 9.81;
  const angleRad = (exitAngleDeg * Math.PI) / 180;

  let vx = exitVelocity * Math.cos(angleRad);
  let vy = exitVelocity * Math.sin(angleRad);
  let x = 0;
  let y = 0;

  const points: SimPoint[] = [{ x, y }];

  for (let t = 0; t < maxTime; t += dt) {
    const v = Math.sqrt(vx * vx + vy * vy);
    const dragMag = dragCoefficient * v * v;
    const ax = -(dragMag * (vx / v));
    const ay = -g - dragMag * (vy / v) + magnusGain * v;

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
function interpAtTime(simPts: SimPoint[], t: number, dt: number): SimPoint | null {
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

// Golden-section search: returns the scalar in [lo, hi] minimizing a unimodal f.
function goldenSection(
  f: (x: number) => number,
  lo: number,
  hi: number,
  tol = 1e-5
): number {
  const invphi = (Math.sqrt(5) - 1) / 2; // 1/phi
  let a = lo;
  let b = hi;
  let c = b - invphi * (b - a);
  let d = a + invphi * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > tol) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - invphi * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + invphi * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

export interface DragMagnusFitResult {
  dragCoefficient: number;
  magnusGain: number;
  rmse: number; // meters (RMS 2D position error)
}

// Search bounds mirror the UI sliders; SIM_DT must match simulateShot's default.
const DRAG_MAX = 1;
const MAGNUS_MAX = 2;
const SIM_DT = 0.005;

// Physics-informed, time-aware fit for drag & Magnus only. Exit velocity and
// angle are treated as fixed ground truth.
//
// The model decouples nicely: horizontal acceleration depends only on drag
// (Magnus has no horizontal component), and with drag fixed the vertical lift
// is monotonic in Magnus. So we solve two well-conditioned, unimodal 1D
// searches (golden-section) and coordinate-descend a few rounds to absorb the
// weak coupling (drag's horizontal term uses total speed, which Magnus shifts
// via vy). Runs async in rounds to stay responsive and cancellable.
export function fitDragMagnusAsync(
  trajectory: { x: number; y: number; frame: number }[],
  exitX: number,
  exitY: number,
  ppm: number,
  framerate: number,
  exitVelocity: number,
  exitAngle: number,
  onProgress: (progress: number) => void,
  signal: { cancelled: boolean }
): Promise<DragMagnusFitResult | null> {
  return new Promise((resolve) => {
    if (trajectory.length < 3 || ppm <= 0 || framerate <= 0 || exitVelocity <= 0) {
      resolve(null);
      return;
    }

    // Preprocess: sort by frame, convert to launch-relative meters with time.
    const sorted = [...trajectory].sort((a, b) => a.frame - b.frame);
    const frame0 = sorted[0].frame;
    const obs = sorted.map((p) => ({
      t: (p.frame - frame0) / framerate,
      x: (p.x - exitX) / ppm,
      y: (exitY - p.y) / ppm,
    }));
    if (obs[obs.length - 1].t <= 0) {
      resolve(null);
      return;
    }

    const PENALTY = 100; // per-point cost when the sim doesn't reach that time

    // Mean squared error using a selector for which axis (or both) to score.
    const meanSqErr = (
      b: number,
      k: number,
      sel: (s: SimPoint, o: { x: number; y: number }) => number
    ) => {
      const sim = simulateShot(exitVelocity, exitAngle, b, k);
      let err = 0;
      for (const o of obs) {
        const s = interpAtTime(sim, o.t, SIM_DT);
        err += s === null ? PENALTY : sel(s, o);
      }
      return err / obs.length;
    };

    const costX = (b: number, k: number) =>
      meanSqErr(b, k, (s, o) => (s.x - o.x) ** 2);
    const costY = (b: number, k: number) =>
      meanSqErr(b, k, (s, o) => (s.y - o.y) ** 2);
    const cost2D = (b: number, k: number) =>
      meanSqErr(b, k, (s, o) => (s.x - o.x) ** 2 + (s.y - o.y) ** 2);

    let drag = 0;
    let magnus = 0;
    let prevCost = Infinity;
    const maxRounds = 6;
    let round = 0;

    function runRound() {
      if (signal.cancelled) {
        resolve(null);
        return;
      }

      // 1D drag fit from horizontal error (Magnus held fixed).
      drag = goldenSection((b) => costX(b, magnus), 0, DRAG_MAX);
      // 1D Magnus fit from vertical error (drag held fixed).
      magnus = goldenSection((k) => costY(drag, k), 0, MAGNUS_MAX);

      round++;
      onProgress(Math.min(round / maxRounds, 1));

      const c = cost2D(drag, magnus);
      const converged = Math.abs(prevCost - c) < 1e-7;
      prevCost = c;

      if (round >= maxRounds || converged) {
        resolve({
          dragCoefficient: Math.round(drag * 1000) / 1000,
          magnusGain: Math.round(magnus * 1000) / 1000,
          rmse: Math.sqrt(c),
        });
      } else {
        setTimeout(runRound, 0);
      }
    }

    setTimeout(runRound, 0);
  });
}

// Compute the peak height (meters above launch) reached during flight
export function simulatePeakHeight(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  dt = 0.005
): number {
  const g = 9.81;
  const angleRad = (exitAngleDeg * Math.PI) / 180;
  let vx = exitVelocity * Math.cos(angleRad);
  let vy = exitVelocity * Math.sin(angleRad);
  let x = 0;
  let y = 0;
  let peak = 0;

  for (let t = 0; t < 10; t += dt) {
    const v = Math.sqrt(vx * vx + vy * vy);
    const dragMag = drag * v * v;
    const ax = -(dragMag * (vx / v));
    const ay = -g - dragMag * (vy / v) + magnus * v;
    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;
    if (y > peak) peak = y;
    if (y < -1) break;
  }
  return peak;
}

// Compute the impact angle (degrees below horizontal) at targetDx.
// Returns positive number = descending into goal.
export function simulateImpactAngle(
  exitVelocity: number,
  exitAngleDeg: number,
  drag: number,
  magnus: number,
  targetDx: number,
  dt = 0.005
): number | null {
  const g = 9.81;
  const angleRad = (exitAngleDeg * Math.PI) / 180;
  let vx = exitVelocity * Math.cos(angleRad);
  let vy = exitVelocity * Math.sin(angleRad);
  let x = 0;
  let y = 0;

  for (let t = 0; t < 10; t += dt) {
    const v = Math.sqrt(vx * vx + vy * vy);
    const dragMag = drag * v * v;
    const ax = -(dragMag * (vx / v));
    const ay = -g - dragMag * (vy / v) + magnus * v;

    const prevX = x;
    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;

    if (prevX <= targetDx && x >= targetDx) {
      // interpolate vx/vy at exact targetDx crossing
      const frac = (targetDx - prevX) / (x - prevX);
      const interpVy = vy - (vy - (vy - ay * dt)) * (1 - frac); // approx: use current vy
      const interpVx = vx;
      // impact angle = angle below horizontal (positive when descending)
      return -(Math.atan2(interpVy, interpVx) * 180) / Math.PI;
    }

    if (y < -1) break;
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
  const pts = simulateShot(exitVelocity, exitAngleDeg, drag, magnus, 10, 0.005);
  // Find the point where x crosses targetDx
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.x <= targetDx && b.x >= targetDx) {
      const t2 = (targetDx - a.x) / (b.x - a.x);
      const y = a.y + t2 * (b.y - a.y);
      const time = (i + t2) * 0.005;
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
