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

/** Horizontal launch direction for sysid: 1 = rightward, -1 = leftward. */
export type XDir = 1 | -1;

export interface LaunchParams {
  exitVelocity: number; // m/s
  exitAngle: number; // degrees from horizontal
  dragCoefficient: number;
  magnusGain: number; // Magnus accel magnitude = magnusGain * speed^magnusPower, ⊥ to velocity (+ = backspin)
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
  framerate: number; // nominal fps; used as fallback when frameTimes unavailable
  /** Presentation timestamps (seconds) per encoded video sample, presentation order. */
  frameTimes?: number[];
  /** Decode timestamps (seconds) per sample; from container parse when available. */
  frameDecodeTimes?: number[];
  /** Sample durations (seconds) per frame; from container parse when available. */
  frameDurations?: number[];
  empiricalNumPoints: number; // plotted points used for exit vel/angle estimate (min 2)
  /** SysId only: 1 = shoot right, -1 = shoot left (mirrors x for angle/sim). */
  xdir: XDir;
}

export interface GeneratedTrajectory {
  id: string;
  exitVelocity: number; // m/s
  exitAngle: number; // degrees
  impactAngle: number; // degrees (angle below horizontal at target x, positive = descending)
  timeOfFlight: number; // seconds
  landingX: number; // meters from robot (should be dx)
  /** Distance interval this trajectory was generated for (per-distance generation). */
  generatedForDx?: number;
  successfulBracket?: boolean; // set after refine; undefined = not yet refined
  accurate?: boolean;          // landing error < refineThreshold; undefined = not yet refined
  refineFailure?: 'bracket' | 'target_height'; // why refine failed; undefined if ok or not refined
  landingError?: number | null; // mm error after refine, null = not yet refined
  speedMoe?: number; // m/s margin of error (from export or import)
  angleMoe?: number; // deg margin of error (from export or import)
  speedMoeMinus?: number; // m/s MOE below nominal exit velocity
  speedMoePlus?: number; // m/s MOE above nominal exit velocity
  angleMoeMinus?: number; // deg MOE below nominal exit angle
  angleMoePlus?: number; // deg MOE above nominal exit angle
}

// A group of trajectories all targeting the same (dx, dy)
export interface TrajGroup {
  id: string;      // unique per group, e.g. `${dx}-${dy}-${timestamp}`
  dx: number;
  dy: number;
  drag: number;
  magnus: number;
  /** Magnus speed exponent used when this group was generated. */
  magnusPower?: number;
  trajectories: GeneratedTrajectory[];
  /** Index into trajectories for the optimal shot (from JSON import/export). */
  optimalTrajectoryIndex?: number;
}

export interface TrajGenParams {
  dx: number; // meters, horizontal distance to goal (used as single value when range not set)
  dy: number; // meters, vertical offset (positive = goal above robot)
  dxMin: number; // range slider min
  dxMax: number; // range slider max
  dxStep: number; // step between distances
  regeneratePerDistanceStep: boolean; // when true, sweep each distance interval separately
  perDistanceErrorTolerance: number; // meters, landing-x window when regeneratePerDistanceStep is true
  errorTolerance: number; // meters, goal opening width along the goal plane for MOE
  goalPlaneAngleDeg: number; // degrees from horizontal; 0 = horizontal goal plane
  showGoalPlanes: boolean; // draw goal plane segments in the trajectory visualizer
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
  /** Weight for MOE in global optimal path selection. */
  optimalMoeWeight: number;
  /** Penalty weight on |d(exit speed)/dx| between adjacent goal distances. */
  optimalSpeedDerivWeight: number;
  /** Penalty weight on |d(exit angle)/dx| between adjacent goal distances. */
  optimalAngleDerivWeight: number;
  /** Penalty weight on |d²(exit speed)/dx²| at interior goal distances. */
  optimalSpeedSecondDerivWeight: number;
  /** Penalty weight on |d²(exit angle)/dx²| at interior goal distances. */
  optimalAngleSecondDerivWeight: number;
}

/** Weights used by global optimal trajectory path selection (saved in trajectory JSON). */
export type TrajOptimizerParams = Pick<
  TrajGenParams,
  | 'optimalMoeWeight'
  | 'optimalSpeedDerivWeight'
  | 'optimalAngleDerivWeight'
  | 'optimalSpeedSecondDerivWeight'
  | 'optimalAngleSecondDerivWeight'
>;

export const DEFAULT_TRAJ_OPTIMIZER_PARAMS: TrajOptimizerParams = {
  optimalMoeWeight: 1,
  optimalSpeedDerivWeight: 0.15,
  optimalAngleDerivWeight: 0.03,
  optimalSpeedSecondDerivWeight: 0.01,
  optimalAngleSecondDerivWeight: 0.01,
};
