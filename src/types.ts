export interface TrajectoryPoint {
  x: number;
  y: number;
  frame: number;
  /** Frame labeled with no position (ball off-screen); keeps time continuity in the trajectory. */
  skipped?: boolean;
}

export interface Meterstick {
  x: number;
  y: number;
  length: number; // pixel length representing 1 meter
}

export type SysIdSidebarTab = 'uploadSave' | 'annotation';

export interface MeterstickPoint {
  x: number;
  y: number;
}

export type MeterstickClipboard = { points: MeterstickPoint[]; segmentMeters: number[] };

export interface LaunchParams {
  exitVelocity: number; // m/s
  exitAngle: number; // degrees from horizontal
  dragCoefficient: number;
  magnusGain: number; // upward accel = magnusGain * speed^magnusPower
  magnusPower: number; // exponent on speed for Magnus force
}

export interface VideoData {
  id: string;
  name: string;
  url: string;
  trajectory: TrajectoryPoint[];
  /** Legacy summary; kept in sync with first meterstick segment for old configs. */
  meterstick: Meterstick;
  /** Horizontal meterstick vertices; consecutive pairs define scale segments. */
  meterstickPoints: MeterstickPoint[];
  /** Physical length (m) for each segment between consecutive points; length = points.length - 1. */
  meterstickSegmentMeters: number[];
  trajectoryLaunchParams: Record<string, LaunchParams>;
  showSimulation: boolean;
  currentFrame: number;
  framerate: number; // video fps for empirical velocity calculations
  empiricalNumPoints: number; // plotted points used for exit vel/angle estimate (min 2)
}

export interface GeneratedTrajectory {
  id: string;
  exitVelocity: number; // m/s
  exitAngle: number; // degrees
  impactAngle: number; // degrees (angle below horizontal at target x, positive = descending)
  timeOfFlight: number; // seconds
  landingX: number; // meters from robot (should be dx)
  successfulBracket?: boolean; // set after refine; undefined = not yet refined
  accurate?: boolean;          // landing error < refineThreshold; undefined = not yet refined
  refineFailure?: 'bracket' | 'target_height'; // why refine failed; undefined if ok or not refined
  landingError?: number | null; // mm error after refine, null = not yet refined
  speedMoe?: number; // m/s margin of error (from export or import)
  angleMoe?: number; // deg margin of error (from export or import)
}

// A group of trajectories all targeting the same (dx, dy)
export interface TrajGroup {
  id: string;      // unique per group, e.g. `${dx}-${dy}-${timestamp}`
  dx: number;
  dy: number;
  drag: number;
  magnus: number;
  trajectories: GeneratedTrajectory[];
  /** Index into trajectories for best combined MOE (from JSON import). */
  biggestMOETrajectory?: number;
}

export interface TrajGenParams {
  dx: number; // meters, horizontal distance to goal (used as single value when range not set)
  dy: number; // meters, vertical offset (positive = goal above robot)
  dxMin: number; // range slider min
  dxMax: number; // range slider max
  dxStep: number; // step between distances
  errorTolerance: number; // meters, horizontal goal width for MOE / optimal trajectory selection
  exitAngleMin: number;
  exitAngleMax: number;
  angleStep: number;
  impactAngleMin: number;
  impactAngleMax: number;
  velocityMin: number;
  velocityMax: number;
  velocityStep: number;
  refineMaxIter: number;
  refineThreshold: number; // meters RMSE
  dragCoefficient: number;
  magnusGain: number;
  magnusPower: number;
}
