import type { TrajGenParams, TrajGroup, TrajOptimizerParams } from '../types';
import {
  groupExportPayload,
  pickOptimalTrajectoryPaths,
  optimalPickWeightsFromParams,
  resolveMagnusPower,
  trajOptimizerParamsFromGenParams,
  type TrajectoryMoe,
} from '../simulation';
import { normalizeTrajGenParamsValue, parseTrajGenParamsValue, parseTrajGenSettings } from './trajGenSettingsIO';
import { parseTrajGroupJson, parseOptimizerParams } from './trajGenIO';

export const TRAJ_GEN_PROJECT_KIND = 'trajGenProject';

export interface TrajGenProjectFile {
  version: 1;
  kind: typeof TRAJ_GEN_PROJECT_KIND;
  params: TrajGenParams;
  optimizerParams: TrajOptimizerParams;
  groups: Record<string, unknown>[];
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
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

export function trajGenProjectFileName(params: TrajGenParams): string {
  const { dxMin, dxMax, dy } = params;
  return sanitizeFileName(`trajgen(${dxMin}, ${dy})_to_(${dxMax}, ${dy}).json`);
}

export function buildTrajGenProjectPayload(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): TrajGenProjectFile {
  const normalizedParams = normalizeTrajGenParamsValue(params) ?? params;
  const optimizerParams = trajOptimizerParamsFromGenParams(normalizedParams);
  const groupsWithTrajs = groups.filter((g) => g.trajectories.length > 0);
  const optimalPaths =
    trajMoeById && trajMoeById.size > 0
      ? pickOptimalTrajectoryPaths(groupsWithTrajs, trajMoeById, optimalPickWeightsFromParams(normalizedParams))
      : { lowArcIds: new Set<string>(), highArcIds: new Set<string>(), allIds: new Set<string>() };

  const magnusPower = resolveMagnusPower(normalizedParams.magnusPower);
  const exportedGroups = groupsWithTrajs.map((g) => {
    const computedLowArcIndex = g.trajectories.findIndex((t) => optimalPaths.lowArcIds.has(t.id));
    const computedHighArcIndex = g.trajectories.findIndex((t) => optimalPaths.highArcIds.has(t.id));
    const optimalLowArcIndex =
      g.optimalLowArcTrajectoryIndex !== undefined ? g.optimalLowArcTrajectoryIndex : computedLowArcIndex;
    const optimalHighArcIndex =
      g.optimalHighArcTrajectoryIndex !== undefined ? g.optimalHighArcTrajectoryIndex : computedHighArcIndex;
    return groupExportPayload(
      g,
      normalizedParams.errorTolerance,
      magnusPower,
      normalizedParams.goalPlaneAngleDeg,
      optimalLowArcIndex >= 0 ? optimalLowArcIndex : undefined,
      optimalHighArcIndex >= 0 ? optimalHighArcIndex : undefined,
    );
  });

  return {
    version: 1,
    kind: TRAJ_GEN_PROJECT_KIND,
    params: normalizedParams,
    optimizerParams,
    groups: exportedGroups,
  };
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
