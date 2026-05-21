export interface TrajectoryPoint {
  x: number;
  y: number;
  frame: number;
}

export interface Meterstick {
  x: number;
  y: number;
  length: number; // pixel length representing 1 meter
}

export interface SimulationParams {
  exitVelocity: number; // m/s
  exitAngle: number; // degrees from horizontal
  dragCoefficient: number;
  magnusGain: number; // upward accel = magnusGain * speed (m/s²·s/m)
  exitX: number; // pixel x from first trajectory point
  exitY: number; // pixel y from first trajectory point
}

export interface VideoData {
  id: string;
  name: string;
  url: string;
  trajectory: TrajectoryPoint[];
  meterstick: Meterstick;
  simulationParams: SimulationParams;
  showSimulation: boolean;
  currentFrame: number;
  hasExitPos: boolean;
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
}

export interface TrajGenParams {
  dx: number; // meters, horizontal distance to goal
  dy: number; // meters, vertical offset (positive = goal above robot)
  goalWidth: number; // meters
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
}
