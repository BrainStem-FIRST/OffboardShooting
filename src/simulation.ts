import type { GeneratedTrajectory, TrajGenParams } from './types';

export interface SimPoint {
  x: number; // meters from launch
  y: number; // meters above launch point
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

// Interpolate y from a simulated trajectory at a given x position
function interpY(simPts: SimPoint[], targetX: number): number | null {
  for (let i = 0; i < simPts.length - 1; i++) {
    const a = simPts[i];
    const b = simPts[i + 1];
    if (targetX >= a.x && targetX <= b.x) {
      const t = (targetX - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return null;
}

// Cost: mean squared error in meters between sim curve and observed points
function cost(
  velocity: number,
  angleDeg: number,
  drag: number,
  magnus: number,
  observed: SimPoint[]
): number {
  if (velocity <= 0) return 1e9;
  const sim = simulateShot(velocity, angleDeg, Math.max(0, drag), Math.max(0, magnus));
  let err = 0;
  for (const obs of observed) {
    const sy = interpY(sim, obs.x);
    if (sy === null) {
      err += 100;
    } else {
      const dy = sy - obs.y;
      err += dy * dy;
    }
  }
  return err / observed.length;
}

// Nelder-Mead simplex minimization over [velocity, angleDeg, drag, magnus]
// Returns best [velocity, angleDeg, drag, magnus]
function nelderMead(
  observed: SimPoint[],
  init: [number, number, number, number]
): [number, number, number, number] {
  const n = 4;
  const alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;
  const maxIter = 1000;

  type Vec = [number, number, number, number];
  const f = ([v, a, d, m]: Vec) => cost(v, a, d, m, observed);

  const simplex: Vec[] = [init];
  const scales: Vec = [2, 15, 0.05, 0.05];
  for (let i = 0; i < n; i++) {
    const p = [...init] as Vec;
    p[i] += scales[i];
    simplex.push(p);
  }

  let scores = simplex.map(f);

  for (let iter = 0; iter < maxIter; iter++) {
    const order = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
    const sorted = order.map(({ i }) => simplex[i]);
    scores = order.map(({ s }) => s);
    simplex.length = 0;
    sorted.forEach((p) => simplex.push(p));

    if (scores[0] < 1e-6) break;

    const centroid: Vec = [0, 0, 0, 0];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;

    const worst = simplex[n];
    const reflected: Vec = centroid.map((c, j) => c + alpha * (c - worst[j])) as Vec;
    const fr = f(reflected);

    if (fr < scores[0]) {
      const expanded: Vec = centroid.map((c, j) => c + gamma * (reflected[j] - c)) as Vec;
      const fe = f(expanded);
      simplex[n] = fe < fr ? expanded : reflected;
      scores[n] = Math.min(fe, fr);
    } else if (fr < scores[n - 1]) {
      simplex[n] = reflected;
      scores[n] = fr;
    } else {
      const contracted: Vec = centroid.map((c, j) => c + rho * (worst[j] - c)) as Vec;
      const fc = f(contracted);
      if (fc < scores[n]) {
        simplex[n] = contracted;
        scores[n] = fc;
      } else {
        const best = simplex[0];
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((x, j) => best[j] + sigma * (x - best[j])) as Vec;
          scores[i] = f(simplex[i]);
        }
      }
    }
  }

  const [v, a, d, m] = simplex[0];
  return [Math.max(0.1, v), a, Math.max(0, d), Math.max(0, m)];
}

export interface FitResult {
  exitVelocity: number;
  exitAngle: number;
  dragCoefficient: number;
  magnusGain: number;
  rmse: number; // meters
}

// Async, cancellable trajectory fit. Yields progress (0–1) each chunk.
// Returns null if cancelled or insufficient data.
export function fitTrajectoryAsync(
  trajectory: { x: number; y: number }[],
  exitX: number,
  exitY: number,
  ppm: number,
  onProgress: (progress: number) => void,
  signal: { cancelled: boolean }
): Promise<FitResult | null> {
  return new Promise((resolve) => {
    if (trajectory.length < 3 || ppm <= 0) { resolve(null); return; }

    const observed: SimPoint[] = trajectory.map((p) => ({
      x: (p.x - exitX) / ppm,
      y: (exitY - p.y) / ppm,
    }));
    const forward = observed.filter((p) => p.x >= 0);
    if (forward.length < 2) { resolve(null); return; }

    const dx = forward[forward.length - 1].x - forward[0].x;
    const dy = forward[forward.length - 1].y - forward[0].y;
    const initAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const initVel = Math.sqrt(dx * dx + dy * dy) * 3;

    type Vec = [number, number, number, number];
    const n = 4;
    const alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;
    const maxIter = 1000;
    const chunkSize = 40;

    const f = ([v, a, d, m]: Vec) => cost(v, a, d, m, forward);
    const init: Vec = [Math.max(1, initVel), initAngle, 0.01, 0];
    const scales: Vec = [2, 15, 0.05, 0.05];

    const simplex: Vec[] = [init];
    for (let i = 0; i < n; i++) {
      const p = [...init] as Vec;
      p[i] += scales[i];
      simplex.push(p);
    }
    let scores = simplex.map(f);
    let iter = 0;

    function runChunk() {
      if (signal.cancelled) { resolve(null); return; }

      const end = Math.min(iter + chunkSize, maxIter);
      while (iter < end) {
        const order = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
        const sorted = order.map(({ i }) => simplex[i]);
        scores = order.map(({ s }) => s);
        simplex.length = 0;
        sorted.forEach((p) => simplex.push(p));

        if (scores[0] < 1e-6) { iter = maxIter; break; }

        const centroid: Vec = [0, 0, 0, 0];
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;

        const worst = simplex[n];
        const reflected: Vec = centroid.map((c, j) => c + alpha * (c - worst[j])) as Vec;
        const fr = f(reflected);

        if (fr < scores[0]) {
          const expanded: Vec = centroid.map((c, j) => c + gamma * (reflected[j] - c)) as Vec;
          const fe = f(expanded);
          simplex[n] = fe < fr ? expanded : reflected;
          scores[n] = Math.min(fe, fr);
        } else if (fr < scores[n - 1]) {
          simplex[n] = reflected;
          scores[n] = fr;
        } else {
          const contracted: Vec = centroid.map((c, j) => c + rho * (worst[j] - c)) as Vec;
          const fc = f(contracted);
          if (fc < scores[n]) {
            simplex[n] = contracted;
            scores[n] = fc;
          } else {
            const best = simplex[0];
            for (let i = 1; i <= n; i++) {
              simplex[i] = simplex[i].map((x, j) => best[j] + sigma * (x - best[j])) as Vec;
              scores[i] = f(simplex[i]);
            }
          }
        }
        iter++;
      }

      onProgress(Math.min(iter / maxIter, 1));

      if (iter >= maxIter) {
        const [v, a, d, m] = simplex[0];
        const fv = Math.max(0.1, v);
        const fd = Math.max(0, d);
        const fm = Math.max(0, m);
        resolve({
          exitVelocity: Math.round(fv * 10) / 10,
          exitAngle: Math.round(a * 10) / 10,
          dragCoefficient: Math.round(fd * 1000) / 1000,
          magnusGain: Math.round(fm * 1000) / 1000,
          rmse: Math.sqrt(cost(fv, a, fd, fm, forward)),
        });
      } else {
        setTimeout(runChunk, 0);
      }
    }

    setTimeout(runChunk, 0);
  });
}

// Synchronous fit kept for reference (unused by UI)
export function fitTrajectory(
  trajectory: { x: number; y: number }[],
  exitX: number,
  exitY: number,
  ppm: number
): FitResult | null {
  if (trajectory.length < 3 || ppm <= 0) return null;

  const observed: SimPoint[] = trajectory.map((p) => ({
    x: (p.x - exitX) / ppm,
    y: (exitY - p.y) / ppm,
  }));

  const forward = observed.filter((p) => p.x >= 0);
  if (forward.length < 2) return null;

  const dx = forward[forward.length - 1].x - forward[0].x;
  const dy = forward[forward.length - 1].y - forward[0].y;
  const initAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const initVel = Math.sqrt(dx * dx + dy * dy) * 3;

  const [v, a, d, m] = nelderMead(forward, [Math.max(1, initVel), initAngle, 0.01, 0]);
  const rmse = Math.sqrt(cost(v, a, d, m, forward));

  return {
    exitVelocity: Math.round(v * 10) / 10,
    exitAngle: Math.round(a * 10) / 10,
    dragCoefficient: Math.round(d * 1000) / 1000,
    magnusGain: Math.round(m * 1000) / 1000,
    rmse,
  };
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
