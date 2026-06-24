import type { GeneratedTrajectory } from '../types';

export function isUnsuccessfulTrajectory(traj: GeneratedTrajectory): boolean {
  if (traj.successfulBracket === undefined) return false;
  return traj.successfulBracket === false || traj.accurate === false;
}
