export function groupExportPayload(
  group: TrajGroup,
  errorTolerance: number,
  magnusPower = 2,
  goalPlaneAngleDeg = 0,
  /** Low-arc index into group.trajectories (same order as exported trajectories[]). */
  preferredLowArcOptimalIndex?: number,
  /** High-arc index into group.trajectories (same order as exported trajectories[]). */
  preferredHighArcOptimalIndex?: number,
  optimizerParams?: TrajOptimizerParams,
) {
  const round5 = (n: number) => {
    const rounded = Math.round((n + Number.EPSILON) * 100000) / 100000;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  const half = errorTolerance / 2;
  const effectiveMagnusPower = resolveMagnusPower(group.magnusPower ?? magnusPower);
  let optimalLowArcTrajectoryIndex = -1;
  let optimalHighArcTrajectoryIndex = -1;
  let bestCombined = -1;
  let bestExitAngle = Infinity;

  const trajectories = group.trajectories.map((t, index) => {
    const moe = computeTrajectoryMoe(
      t,
      group.dx,
      group.dy,
      half,
      group.drag,
      group.magnus,
      effectiveMagnusPower,
      goalPlaneAngleDeg,
    );
    if (preferredLowArcOptimalIndex === undefined && preferredHighArcOptimalIndex === undefined && moe) {
      if (
        optimalLowArcTrajectoryIndex < 0 ||
        isBetterOptimalTrajectory(moe.combinedMoe, t.exitAngle, bestCombined, bestExitAngle)
      ) {
        bestCombined = moe.combinedMoe;
        bestExitAngle = t.exitAngle;
        optimalLowArcTrajectoryIndex = index;
        optimalHighArcTrajectoryIndex = index;
      }
    }

    const entry: Record<string, number> = {
      speed: round5(t.exitVelocity),
      exitAngle: round5(t.exitAngle),
      tof: round5(t.timeOfFlight),
    };
    if (moe) {
      entry.speedMOE = round5(moe.speedMoe);
      entry.angleMOE = round5(moe.angleMoe);
    }
    return entry;
  });

  if (preferredLowArcOptimalIndex !== undefined) optimalLowArcTrajectoryIndex = preferredLowArcOptimalIndex;
  if (preferredHighArcOptimalIndex !== undefined) optimalHighArcTrajectoryIndex = preferredHighArcOptimalIndex;

  const validatedLowArcOptimalIndex =
    Number.isInteger(optimalLowArcTrajectoryIndex) &&
    optimalLowArcTrajectoryIndex >= 0 &&
    optimalLowArcTrajectoryIndex < trajectories.length
      ? optimalLowArcTrajectoryIndex
      : undefined;
  const validatedHighArcOptimalIndex =
    Number.isInteger(optimalHighArcTrajectoryIndex) &&
    optimalHighArcTrajectoryIndex >= 0 &&
    optimalHighArcTrajectoryIndex < trajectories.length
      ? optimalHighArcTrajectoryIndex
      : undefined;

  return {
    dx: round5(group.dx),
    dy: round5(group.dy),
    dragCoeff: round5(group.drag),
    magnusCoeff: round5(group.magnus),
    ...(validatedLowArcOptimalIndex !== undefined ? { optimalLowArcTrajectoryIndex: validatedLowArcOptimalIndex } : {}),
    ...(validatedHighArcOptimalIndex !== undefined ? { optimalHighArcTrajectoryIndex: validatedHighArcOptimalIndex } : {}),
    ...(optimizerParams ? { optimizerParams } : {}),
    trajectories,
  };
}

/** Slim group payload for traj gen project download (physics coeffs live at project root). */
export function projectGroupExportPayload(
  group: TrajGroup,
  errorTolerance: number,
  magnusPower = 2,
  goalPlaneAngleDeg = 0,
  preferredLowArcOptimalIndex?: number,
  preferredHighArcOptimalIndex?: number,
) {
  const full = groupExportPayload(
    group,
    errorTolerance,
    magnusPower,
    goalPlaneAngleDeg,
    preferredLowArcOptimalIndex,
    preferredHighArcOptimalIndex,
  );
  return {
    dx: full.dx,
    ...(full.optimalLowArcTrajectoryIndex !== undefined
      ? { optimalLowArcTrajectoryIndex: full.optimalLowArcTrajectoryIndex }
      : {}),
    ...(full.optimalHighArcTrajectoryIndex !== undefined
      ? { optimalHighArcTrajectoryIndex: full.optimalHighArcTrajectoryIndex }
      : {}),
    trajectories: full.trajectories,
  };
}

export function groupExportFileName(group: TrajGroup): string {
  return `(${group.dx}, ${group.dy}).json`;
}

function sanitizeArchiveName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
    .join('');
}

export function trajOptimizerParamsFromGenParams(params: TrajGenParams): TrajOptimizerParams {
  return {
    optimalMoeWeight: params.optimalMoeWeight,
    optimalSpeedDerivWeight: params.optimalSpeedDerivWeight,
    optimalAngleDerivWeight: params.optimalAngleDerivWeight,
    optimalSpeedSecondDerivWeight: params.optimalSpeedSecondDerivWeight,
    optimalAngleSecondDerivWeight: params.optimalAngleSecondDerivWeight,
    optimalVelocityBufferLineX1: params.optimalVelocityBufferLineX1,
    optimalVelocityBufferLineY1: params.optimalVelocityBufferLineY1,
    optimalVelocityBufferLineX2: params.optimalVelocityBufferLineX2,
    optimalVelocityBufferLineY2: params.optimalVelocityBufferLineY2,
  };
}

export interface OptimalExportPathSets {
  lowArcIds: Set<string>;
  highArcIds: Set<string>;
  allIds: Set<string>;
}

export function pickOptimalExportPaths(
  groups: TrajGroup[],
  params: TrajGenParams | TrajOptimizerParams,
  trajMoeById?: Map<string, TrajectoryMoe>,
): OptimalExportPathSets {
  return trajMoeById && trajMoeById.size > 0
    ? pickOptimalTrajectoryPaths(groups, trajMoeById, optimalPickWeightsFromParams(params as TrajGenParams))
    : { lowArcIds: new Set<string>(), highArcIds: new Set<string>(), allIds: new Set<string>() };
}

export function resolveGroupOptimalExportIndexes(
  group: TrajGroup,
  optimalPaths: OptimalExportPathSets,
): {
  optimalLowArcIndex?: number;
  optimalHighArcIndex?: number;
} {
  const computedLowArcIndex = group.trajectories.findIndex((t) => optimalPaths.lowArcIds.has(t.id));
  const computedHighArcIndex = group.trajectories.findIndex((t) => optimalPaths.highArcIds.has(t.id));
  const optimalLowArcIndex =
    group.optimalLowArcTrajectoryIndex !== undefined ? group.optimalLowArcTrajectoryIndex : computedLowArcIndex;
  const optimalHighArcIndex =
    group.optimalHighArcTrajectoryIndex !== undefined ? group.optimalHighArcTrajectoryIndex : computedHighArcIndex;
  return {
    ...(optimalLowArcIndex >= 0 ? { optimalLowArcIndex } : {}),
    ...(optimalHighArcIndex >= 0 ? { optimalHighArcIndex } : {}),
  };
}

export function exportFolderName(params: TrajGenParams): string {
  const { dxMin, dxMax, dy } = params;
  return sanitizeArchiveName(`trajectories(${dxMin}, ${dy})_to_(${dxMax}, ${dy})`);
}

/** Download a zip; extracting yields folder trajectories(xmin,y)_to_(xmax,y) with (dx,dy).json files. */
export function downloadTrajectoriesArchive(
  groups: TrajGroup[],
  params: TrajGenParams,
  trajMoeById?: Map<string, TrajectoryMoe>,
): void {
  const groupsWithTrajs = groups.filter((g) => g.trajectories.length > 0);
  if (groupsWithTrajs.length === 0) return;

  const optimalPaths = pickOptimalExportPaths(groupsWithTrajs, params, trajMoeById);

  const folderName = exportFolderName(params);
  const optimizerParams = trajOptimizerParamsFromGenParams(params);
  const entries = groupsWithTrajs.map((g) => {
    const { optimalLowArcIndex, optimalHighArcIndex } = resolveGroupOptimalExportIndexes(g, optimalPaths);
    return {
      name: `${folderName}/${groupExportFileName(g)}`,
      data: new TextEncoder().encode(JSON.stringify(
        groupExportPayload(
          g,
          params.errorTolerance,
          resolveMagnusPower(params.magnusPower),
          params.goalPlaneAngleDeg,
          optimalLowArcIndex,
          optimalHighArcIndex,
          optimizerParams,
        ),
        null,
        4,
      )),
    };
  });

  entries.push({
    name: `${folderName}/optimizer_params.json`,
    data: new TextEncoder().encode(JSON.stringify(
      { version: 1, optimizerParams },
      null,
      4,
    )),
  });

  const blob = buildStoreZip(entries);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${folderName}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}
import type { TrajGenParams, TrajGroup, TrajOptimizerParams } from '../types';
import { buildStoreZip } from '../utils/zipStore';
import { resolveMagnusPower } from './physics';
import {
  computeTrajectoryMoe,
  isBetterOptimalTrajectory,
  optimalPickWeightsFromParams,
  pickOptimalTrajectoryPaths,
  type TrajectoryMoe,
} from './moe';
