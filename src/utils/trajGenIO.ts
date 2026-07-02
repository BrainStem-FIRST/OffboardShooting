import type { GeneratedTrajectory, TrajGenParams, TrajGroup, TrajOptimizerParams } from '../types';
import { DEFAULT_TRAJ_OPTIMIZER_PARAMS } from '../types';
import {
  groupExportFileName,
  groupExportPayload,
  resolveMagnusPower,
  pickOptimalTrajectoryPaths,
  optimalPickWeightsFromParams,
  trajOptimizerParamsFromGenParams,
  type TrajectoryMoe,
} from '../simulation';
import { pickFolderForImport } from './projectIO';

const TRAJ_GROUP_FILE_RE = /^\([\d.eE+-]+,\s*[\d.eE+-]+\)\.json$/;

/** JSON keys for optimal trajectory indices in group export files. */
export const OPTIMAL_LOW_ARC_TRAJECTORY_INDEX_KEY = 'optimalLowArcTrajectoryIndex';
export const OPTIMAL_HIGH_ARC_TRAJECTORY_INDEX_KEY = 'optimalHighArcTrajectoryIndex';
const LEGACY_OPTIMAL_TRAJECTORY_INDEX_KEY = 'optimalTrajectoryIndex';

export const OPTIMIZER_PARAMS_FILE_NAME = 'optimizer_params.json';

const OPTIMIZER_PARAM_KEYS = [
  'optimalMoeWeight',
  'optimalSpeedDerivWeight',
  'optimalAngleDerivWeight',
  'optimalSpeedSecondDerivWeight',
  'optimalAngleSecondDerivWeight',
  'optimalVelocityBufferLineX1',
  'optimalVelocityBufferLineY1',
  'optimalVelocityBufferLineX2',
  'optimalVelocityBufferLineY2',
] as const satisfies readonly (keyof TrajOptimizerParams)[];

function readIntegerIndex(record: Record<string, unknown>, key: string): number | undefined {
  const primary = record[key];
  if (typeof primary === 'number' && Number.isInteger(primary)) return primary;
  return undefined;
}

function readLegacyOptimalTrajectoryIndex(record: Record<string, unknown>): number | undefined {
  const primary = readIntegerIndex(record, LEGACY_OPTIMAL_TRAJECTORY_INDEX_KEY);
  if (primary !== undefined) return primary;
  const legacy = record.biggestMOETrajectory;
  if (typeof legacy === 'number' && Number.isInteger(legacy)) return legacy;
  return undefined;
}

/** Parse optimizer weights from a trajectory group JSON object or sidecar file payload. */
export function parseOptimizerParams(value: unknown): TrajOptimizerParams | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const nested =
    record.optimizerParams && typeof record.optimizerParams === 'object'
      ? (record.optimizerParams as Record<string, unknown>)
      : record;

  const partial: Partial<TrajOptimizerParams> = {};
  for (const key of OPTIMIZER_PARAM_KEYS) {
    const v = nested[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      partial[key] = v;
    }
  }
  if (Object.keys(partial).length === 0) return null;

  return {
    ...DEFAULT_TRAJ_OPTIMIZER_PARAMS,
    ...partial,
  };
}

export function parseOptimizerParamsFromGroupText(text: string): TrajOptimizerParams | null {
  try {
    return parseOptimizerParams(JSON.parse(text));
  } catch {
    return null;
  }
}

export function isTrajGroupFileName(name: string): boolean {
  return TRAJ_GROUP_FILE_RE.test(name);
}

export function parseTrajGroupJson(json: unknown, batchId = Date.now()): TrajGroup | null {
  if (!json || typeof json !== 'object') return null;
  const record = json as Record<string, unknown>;
  const importedDrag = typeof record.dragCoeff === 'number' ? record.dragCoeff : null;
  const importedMagnus = typeof record.magnusCoeff === 'number' ? record.magnusCoeff : null;
  const importedDx = typeof record.dx === 'number' ? record.dx : null;
  const importedDy = typeof record.dy === 'number' ? record.dy : null;
  if (importedDrag === null || importedMagnus === null || importedDx === null || importedDy === null) {
    return null;
  }
  if (!Array.isArray(record.trajectories)) return null;

  const legacyOptimalTrajectoryIndex = readLegacyOptimalTrajectoryIndex(record);
  const optimalLowArcTrajectoryIndex =
    readIntegerIndex(record, OPTIMAL_LOW_ARC_TRAJECTORY_INDEX_KEY) ?? legacyOptimalTrajectoryIndex;
  const optimalHighArcTrajectoryIndex =
    readIntegerIndex(record, OPTIMAL_HIGH_ARC_TRAJECTORY_INDEX_KEY) ?? legacyOptimalTrajectoryIndex;

  const trajs: GeneratedTrajectory[] = (record.trajectories as Record<string, number>[]).map((t, i) => ({
    id: `import-${batchId}-${i}-${Math.random().toString(36).slice(2)}`,
    exitVelocity: t.speed ?? 0,
    exitAngle: t.exitAngle ?? 0,
    impactAngle: t.impactAngle ?? 0,
    timeOfFlight: t.timeOfFlight ?? 0,
    landingX: importedDx,
    ...(typeof t.speedMoe === 'number' ? { speedMoe: t.speedMoe } : {}),
    ...(typeof t.angleMoe === 'number' ? { angleMoe: t.angleMoe } : {}),
    ...(typeof t.speedMoeMinus === 'number' ? { speedMoeMinus: t.speedMoeMinus } : {}),
    ...(typeof t.speedMoePlus === 'number' ? { speedMoePlus: t.speedMoePlus } : {}),
    ...(typeof t.angleMoeMinus === 'number' ? { angleMoeMinus: t.angleMoeMinus } : {}),
    ...(typeof t.angleMoePlus === 'number' ? { angleMoePlus: t.angleMoePlus } : {}),
  }));

  return {
    id: `import-${batchId}-${importedDx.toFixed(6)}-${importedDy.toFixed(6)}-${Math.random().toString(36).slice(2)}`,
    dx: importedDx,
    dy: importedDy,
    drag: importedDrag,
    magnus: importedMagnus,
    trajectories: trajs,
    ...(optimalLowArcTrajectoryIndex !== undefined &&
    optimalLowArcTrajectoryIndex >= 0 &&
    optimalLowArcTrajectoryIndex < trajs.length
      ? { optimalLowArcTrajectoryIndex }
      : {}),
    ...(optimalHighArcTrajectoryIndex !== undefined &&
    optimalHighArcTrajectoryIndex >= 0 &&
    optimalHighArcTrajectoryIndex < trajs.length
      ? { optimalHighArcTrajectoryIndex }
      : {}),
  };
}

export function parseTrajGroupFromText(text: string): TrajGroup | null {
  try {
    return parseTrajGroupJson(JSON.parse(text));
  } catch {
    return null;
  }
}

async function ensureDirReadPermission(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await dirHandle.queryPermission({ mode: 'read' })) === 'granted') return true;
  return (await dirHandle.requestPermission({ mode: 'read' })) === 'granted';
}

async function ensureDirWritePermission(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function writeTextToFile(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  text: string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

async function listJsonFileHandles(
  dir: FileSystemDirectoryHandle
): Promise<{ name: string; handle: FileSystemFileHandle }[]> {
  const files: { name: string; handle: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.toLowerCase().endsWith('.json')) {
      files.push({ name, handle: handle as FileSystemFileHandle });
    }
  }
  return files;
}

async function resolveTrajWriteDirectory(
  dir: FileSystemDirectoryHandle,
): Promise<{ writeDir: FileSystemDirectoryHandle; files: { name: string; handle: FileSystemFileHandle }[] } | null> {
  const rootFiles = await listJsonFileHandles(dir);
  const named = rootFiles.filter((f) => isTrajGroupFileName(f.name));
  if (named.length > 0) return { writeDir: dir, files: named };
  if (rootFiles.length > 0) return { writeDir: dir, files: rootFiles };

  for await (const [, handle] of dir.entries()) {
    if (handle.kind !== 'directory') continue;
    const subDir = handle as FileSystemDirectoryHandle;
    const subFiles = await listJsonFileHandles(subDir);
    const subNamed = subFiles.filter((f) => isTrajGroupFileName(f.name));
    if (subNamed.length > 0) return { writeDir: subDir, files: subNamed };
  }

  for await (const [, handle] of dir.entries()) {
    if (handle.kind !== 'directory') continue;
    const subDir = handle as FileSystemDirectoryHandle;
    const subFiles = await listJsonFileHandles(subDir);
    if (subFiles.length > 0) return { writeDir: subDir, files: subFiles };
  }

  return null;
}

async function readOptimizerParamsFromDir(
  dir: FileSystemDirectoryHandle,
): Promise<TrajOptimizerParams | null> {
  try {
    const handle = await dir.getFileHandle(OPTIMIZER_PARAMS_FILE_NAME);
    const text = await (await handle.getFile()).text();
    return parseOptimizerParamsFromGroupText(text);
  } catch {
    return null;
  }
}

export type LoadTrajFolderResult =
  | { ok: true; groups: TrajGroup[]; warnings: string[]; writeDir: FileSystemDirectoryHandle; optimizerParams: TrajOptimizerParams | null }
  | { ok: false; cancelled: boolean; message: string };

export type SaveTrajFolderResult =
  | { ok: true; count: number }
  | { ok: false; cancelled?: boolean; message: string };

export async function loadTrajGroupsFromDirectory(
  dir: FileSystemDirectoryHandle
): Promise<LoadTrajFolderResult> {
  if (!(await ensureDirReadPermission(dir))) {
    return { ok: false, cancelled: false, message: 'Read permission was denied for the selected folder.' };
  }

  const resolved = await resolveTrajWriteDirectory(dir);
  if (!resolved || resolved.files.length === 0) {
    return {
      ok: false,
      cancelled: false,
      message: 'No trajectory JSON files found. Expected files like (3, 1.8).json in the selected folder.',
    };
  }

  const batchId = Date.now();
  const groups: TrajGroup[] = [];
  const warnings: string[] = [];

  const { writeDir, files } = resolved;

  let optimizerParams = await readOptimizerParamsFromDir(writeDir);

  for (const { name, handle } of files) {
    if (name === OPTIMIZER_PARAMS_FILE_NAME) continue;
    try {
      const text = await (await handle.getFile()).text();
      if (!optimizerParams) {
        optimizerParams = parseOptimizerParamsFromGroupText(text);
      }
      const group = parseTrajGroupFromText(text);
      if (!group) {
        warnings.push(`Skipped "${name}": missing dragCoeff, magnusCoeff, dx, dy, or trajectories.`);
        continue;
      }
      group.id = `import-${batchId}-${group.dx.toFixed(6)}-${group.dy.toFixed(6)}-${Math.random().toString(36).slice(2)}`;
      group.trajectories = group.trajectories.map((t, i) => ({
        ...t,
        id: `import-${batchId}-${i}-${Math.random().toString(36).slice(2)}`,
      }));
      groups.push(group);
    } catch {
      warnings.push(`Skipped "${name}": invalid JSON.`);
    }
  }

  if (groups.length === 0) {
    return {
      ok: false,
      cancelled: false,
      message: warnings.length > 0
        ? warnings.join(' ')
        : 'No valid trajectory JSON files found in the selected folder.',
    };
  }

  groups.sort((a, b) => a.dx - b.dx || a.dy - b.dy);
  return { ok: true, groups, warnings, writeDir, optimizerParams };
}

export async function saveTrajGroupsToDirectory(
  writeDir: FileSystemDirectoryHandle,
  groups: TrajGroup[],
  params: Pick<TrajGenParams, 'errorTolerance' | 'magnusPower' | 'goalPlaneAngleDeg' | 'optimalMoeWeight' | 'optimalSpeedDerivWeight' | 'optimalAngleDerivWeight' | 'optimalSpeedSecondDerivWeight' | 'optimalAngleSecondDerivWeight' | 'optimalVelocityBufferLineX1' | 'optimalVelocityBufferLineY1' | 'optimalVelocityBufferLineX2' | 'optimalVelocityBufferLineY2'>,
  onProgress?: (current: number, total: number) => void,
  trajMoeById?: Map<string, TrajectoryMoe>,
): Promise<SaveTrajFolderResult> {
  const groupsWithTrajs = groups.filter((g) => g.trajectories.length > 0);
  if (groupsWithTrajs.length === 0) {
    return { ok: false, message: 'No trajectories to save.' };
  }

  if (!(await ensureDirWritePermission(writeDir))) {
    return { ok: false, message: 'Write permission was denied for the imported trajectory folder.' };
  }

  const optimalPaths =
    trajMoeById && trajMoeById.size > 0
      ? pickOptimalTrajectoryPaths(groupsWithTrajs, trajMoeById, optimalPickWeightsFromParams(params as TrajGenParams))
      : { lowArcIds: new Set<string>(), highArcIds: new Set<string>(), allIds: new Set<string>() };

  const optimizerParams = trajOptimizerParamsFromGenParams(params as TrajGenParams);

  try {
    await writeTextToFile(
      writeDir,
      OPTIMIZER_PARAMS_FILE_NAME,
      JSON.stringify({ version: 1, optimizerParams }, null, 4),
    );
  } catch (err) {
    return {
      ok: false,
      message: `Failed to save "${OPTIMIZER_PARAMS_FILE_NAME}": ${(err as Error).message}`,
    };
  }

  for (let i = 0; i < groupsWithTrajs.length; i++) {
    const group = groupsWithTrajs[i];
    onProgress?.(i + 1, groupsWithTrajs.length);
    const fileName = groupExportFileName(group);
    const computedLowArcIndex = group.trajectories.findIndex((t) => optimalPaths.lowArcIds.has(t.id));
    const computedHighArcIndex = group.trajectories.findIndex((t) => optimalPaths.highArcIds.has(t.id));
    const optimalLowArcIndex =
      group.optimalLowArcTrajectoryIndex !== undefined ? group.optimalLowArcTrajectoryIndex : computedLowArcIndex;
    const optimalHighArcIndex =
      group.optimalHighArcTrajectoryIndex !== undefined ? group.optimalHighArcTrajectoryIndex : computedHighArcIndex;
    const text = JSON.stringify(
      groupExportPayload(
        group,
        params.errorTolerance,
        resolveMagnusPower(params.magnusPower),
        params.goalPlaneAngleDeg,
        optimalLowArcIndex >= 0 ? optimalLowArcIndex : undefined,
        optimalHighArcIndex >= 0 ? optimalHighArcIndex : undefined,
        optimizerParams,
      ),
      null,
      4,
    );
    try {
      await writeTextToFile(writeDir, fileName, text);
    } catch (err) {
      return {
        ok: false,
        message: `Failed to save "${fileName}": ${(err as Error).message}`,
      };
    }
  }

  return { ok: true, count: groupsWithTrajs.length };
}

export async function pickTrajFolderForImport(): Promise<
  | { ok: true; dir: FileSystemDirectoryHandle }
  | { ok: false; cancelled: boolean; message: string }
> {
  return pickFolderForImport({
    unsupportedMessage:
      'Import Folder requires Chrome or Edge. Your browser does not support folder selection.',
  });
}
