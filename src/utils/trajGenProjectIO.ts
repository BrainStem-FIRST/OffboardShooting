import type { TrajGenParams, TrajGroup, TrajOptimizerParams } from '../types';
import {
  projectGroupExportPayload,
  pickOptimalExportPaths,
  resolveGroupOptimalExportIndexes,
  resolveMagnusPower,
  trajOptimizerParamsFromGenParams,
  type TrajectoryMoe,
} from '../simulation';
import { normalizeTrajGenParamsValue, parseTrajGenParamsValue, parseTrajGenSettings } from './trajGenSettingsIO';
import { parseTrajGroupJson, parseTrajGenProjectGroupJson, parseOptimizerParams } from './trajGenIO';

export const TRAJ_GEN_PROJECT_KIND = 'trajGenProject';

/** Website-only generation settings (excludes robot-facing physics coeffs at project root). */
export type TrajGenProjectParams = Omit<TrajGenParams, 'dy' | 'dragCoefficient' | 'magnusGain' | 'magnusPower'>;

export interface TrajGenProjectGroupExport {
  dx: number;
  optimalLowArcTrajectoryIndex?: number;
  optimalHighArcTrajectoryIndex?: number;
  trajectories: Record<string, number>[];
}

export interface TrajGenProjectFile {
  version: 1;
  kind: typeof TRAJ_GEN_PROJECT_KIND;
  projectParams: TrajGenProjectParams;
  dy: number;
  dragCoeff: number;
  magnusCoeff: number;
  magnusPower: number;
  groups: TrajGenProjectGroupExport[];
}

export type TrajGenImportResult =
  | {
      ok: true;
      type: 'project';
      params: TrajGenParams;
      groups: TrajGroup[];
      optimizerParams: TrajOptimizerParams | null;
      warnings: string[];
    }
  | { ok: true; type: 'settings'; params: TrajGenParams }
  | {
      ok: true;
      type: 'group';
      groups: TrajGroup[];
      optimizerParams: TrajOptimizerParams | null;
    }
  | { ok: false; message: string };

function mergeOptimizerIntoParams(
  params: TrajGenParams,
  optimizerParams: TrajOptimizerParams | null,
): TrajGenParams {
  return optimizerParams ? { ...params, ...optimizerParams } : params;
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
    .join('');
}

function roundExportNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round((value + Number.EPSILON) * 100000) / 100000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundJsonNumbers<T>(value: T): T {
  if (typeof value === 'number') return roundExportNumber(value) as T;
  if (Array.isArray(value)) return value.map((item) => roundJsonNumbers(item)) as T;
  if (value && typeof value === 'object') {
    const rounded: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      rounded[key] = roundJsonNumbers(item);
    }
    return rounded as T;
  }
  return value;
}

export function trajGenProjectFileName(params: TrajGenParams): string {
  const { dxMin, dxMax, dy } = params;
  return sanitizeFileName(`trajgen(${dxMin}, ${dy})_to_(${dxMax}, ${dy}).json`);
}

function buildProjectParams(params: TrajGenParams): TrajGenProjectParams {
  const projectParams: Partial<TrajGenParams> = { ...params };
  delete projectParams.dy;
  delete projectParams.dragCoefficient;
  delete projectParams.magnusGain;
  delete projectParams.magnusPower;
  return projectParams as TrajGenProjectParams;
}

function parseTrajGenProjectParams(record: Record<string, unknown>): TrajGenParams | null {
  const projectParamsRaw = record.projectParams;
  if (!projectParamsRaw || typeof projectParamsRaw !== 'object') return null;

  const dy = typeof record.dy === 'number' ? record.dy : null;
  const dragCoeff = typeof record.dragCoeff === 'number' ? record.dragCoeff : null;
  const magnusCoeff = typeof record.magnusCoeff === 'number' ? record.magnusCoeff : null;
  const magnusPower = typeof record.magnusPower === 'number' ? record.magnusPower : null;
  if (dy === null || dragCoeff === null || magnusCoeff === null || magnusPower === null) {
    return null;
  }

  return parseTrajGenParamsValue({
    ...(projectParamsRaw as Record<string, unknown>),
    dy,
    dragCoefficient: dragCoeff,
    magnusGain: magnusCoeff,
    magnusPower,
  });
}

export function buildTrajGenProjectPayload(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): TrajGenProjectFile {
  const normalizedParams = normalizeTrajGenParamsValue(params) ?? params;
  const groupsWithTrajs = groups.filter((g) => g.trajectories.length > 0);
  const optimalPaths = pickOptimalExportPaths(groupsWithTrajs, normalizedParams, trajMoeById);

  const magnusPower = resolveMagnusPower(normalizedParams.magnusPower);
  const exportedGroups = groupsWithTrajs.map((g) => {
    const { optimalLowArcIndex, optimalHighArcIndex } = resolveGroupOptimalExportIndexes(g, optimalPaths);
    return projectGroupExportPayload(
      g,
      normalizedParams.errorTolerance,
      magnusPower,
      normalizedParams.goalPlaneAngleDeg,
      optimalLowArcIndex,
      optimalHighArcIndex,
    );
  });

  return roundJsonNumbers({
    version: 1,
    kind: TRAJ_GEN_PROJECT_KIND,
    projectParams: buildProjectParams(normalizedParams),
    dy: normalizedParams.dy,
    dragCoeff: normalizedParams.dragCoefficient,
    magnusCoeff: normalizedParams.magnusGain,
    magnusPower,
    groups: exportedGroups,
  });
}

export function serializeTrajGenProject(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): string {
  return JSON.stringify(buildTrajGenProjectPayload(params, groups, trajMoeById), null, 2);
}

function assignImportIds(groups: TrajGroup[], batchId: number): TrajGroup[] {
  return groups.map((group) => ({
    ...group,
    id: `import-${batchId}-${group.dx.toFixed(6)}-${group.dy.toFixed(6)}-${Math.random().toString(36).slice(2)}`,
    trajectories: group.trajectories.map((t, i) => ({
      ...t,
      id: `import-${batchId}-${i}-${Math.random().toString(36).slice(2)}`,
    })),
  }));
}

export function parseTrajGenImport(text: string): TrajGenImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Invalid JSON.' };
  }

  if (!json || typeof json !== 'object') {
    return { ok: false, message: 'Invalid project file.' };
  }

  const record = json as Record<string, unknown>;

  if (record.kind === TRAJ_GEN_PROJECT_KIND) {
    const newFormatParams = parseTrajGenProjectParams(record);
    if (newFormatParams) {
      if (!Array.isArray(record.groups)) {
        return { ok: false, message: 'Project file is missing trajectory groups.' };
      }

      const batchId = Date.now();
      const physics = {
        dy: newFormatParams.dy,
        dragCoeff: newFormatParams.dragCoefficient,
        magnusCoeff: newFormatParams.magnusGain,
      };
      const groups: TrajGroup[] = [];
      const warnings: string[] = [];
      for (let i = 0; i < record.groups.length; i++) {
        const group = parseTrajGenProjectGroupJson(record.groups[i], physics, batchId);
        if (!group) {
          warnings.push(`Skipped group ${i + 1}: invalid trajectory data.`);
          continue;
        }
        groups.push(group);
      }

      groups.sort((a, b) => a.dx - b.dx || a.dy - b.dy);
      const optimizerParams = trajOptimizerParamsFromGenParams(newFormatParams);

      return {
        ok: true,
        type: 'project',
        params: newFormatParams,
        groups: assignImportIds(groups, batchId),
        optimizerParams,
        warnings,
      };
    }

    const params = parseTrajGenParamsValue(record.params);
    if (!params) {
      return { ok: false, message: 'Project file is missing valid generation parameters.' };
    }
    if (!Array.isArray(record.groups)) {
      return { ok: false, message: 'Project file is missing trajectory groups.' };
    }

    const batchId = Date.now();
    const groups: TrajGroup[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < record.groups.length; i++) {
      const group = parseTrajGroupJson(record.groups[i], batchId);
      if (!group) {
        warnings.push(`Skipped group ${i + 1}: invalid trajectory data.`);
        continue;
      }
      groups.push(group);
    }

    groups.sort((a, b) => a.dx - b.dx || a.dy - b.dy);
    const optimizerParams = parseOptimizerParams(record) ?? parseOptimizerParams(params);
    const mergedParams = mergeOptimizerIntoParams(params, optimizerParams);

    return {
      ok: true,
      type: 'project',
      params: mergedParams,
      groups: assignImportIds(groups, batchId),
      optimizerParams,
      warnings,
    };
  }

  const settingsParams = parseTrajGenSettings(text);
  if (settingsParams && record.kind === 'trajGenSettings') {
    return { ok: true, type: 'settings', params: settingsParams };
  }

  const batchId = Date.now();
  const group = parseTrajGroupJson(json, batchId);
  if (group) {
    return {
      ok: true,
      type: 'group',
      groups: assignImportIds([group], batchId),
      optimizerParams: parseOptimizerParams(record),
    };
  }

  if (settingsParams) {
    return { ok: true, type: 'settings', params: settingsParams };
  }

  return {
    ok: false,
    message: 'Unrecognized file. Expected a traj gen project, settings, or trajectory group JSON file.',
  };
}

export function downloadTrajGenProject(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): void {
  const text = serializeTrajGenProject(params, groups, trajMoeById);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = trajGenProjectFileName(params);
  a.click();
  URL.revokeObjectURL(url);
}

async function ensureFileWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function writeTextToFileHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
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

export async function saveTrajGenProjectToHandle(
  handle: FileSystemFileHandle,
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await ensureFileWritePermission(handle))) {
    return { ok: false, message: 'Write permission was denied for the project file.' };
  }

  try {
    await writeTextToFileHandle(handle, serializeTrajGenProject(params, groups, trajMoeById));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `Failed to save project: ${(err as Error).message}` };
  }
}

function pickerErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return '';
  return err instanceof Error ? err.message : String(err);
}

export async function pickTrajGenProjectForOpen(): Promise<
  | { ok: true; handle: FileSystemFileHandle; text: string }
  | { ok: false; cancelled: boolean; message: string }
> {
  if (typeof window.showOpenFilePicker !== 'function') {
    return {
      ok: false,
      cancelled: false,
      message: 'File picker requires Chrome or Edge. Use Import with the file chooser fallback.',
    };
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      mode: 'read',
      types: [
        {
          description: 'Trajectory generation project',
          accept: { 'application/json': ['.json'] },
        },
      ],
    });
    const text = await (await handle.getFile()).text();
    return { ok: true, handle, text };
  } catch (err) {
    const message = pickerErrorMessage(err);
    if (!message) return { ok: false, cancelled: true, message: '' };
    return { ok: false, cancelled: false, message };
  }
}

export async function pickTrajGenProjectForSave(
  suggestedName: string,
): Promise<
  | { ok: true; handle: FileSystemFileHandle }
  | { ok: false; cancelled: boolean; message: string }
> {
  if (typeof window.showSaveFilePicker !== 'function') {
    return {
      ok: false,
      cancelled: false,
      message: 'Save requires Chrome or Edge. Use Download instead.',
    };
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: 'Trajectory generation project',
          accept: { 'application/json': ['.json'] },
        },
      ],
    });
    return { ok: true, handle };
  } catch (err) {
    const message = pickerErrorMessage(err);
    if (!message) return { ok: false, cancelled: true, message: '' };
    return { ok: false, cancelled: false, message };
  }
}
