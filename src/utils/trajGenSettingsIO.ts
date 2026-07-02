import type { TrajGenParams } from '../types';
import { DEFAULT_TRAJ_OPTIMIZER_PARAMS } from '../types';

const PARAM_KEYS: (keyof TrajGenParams)[] = [
  'dx',
  'dy',
  'dxMin',
  'dxMax',
  'dxStep',
  'regeneratePerDistanceStep',
  'perDistanceErrorTolerance',
  'errorTolerance',
  'goalPlaneAngleDeg',
  'exitAngleMin',
  'exitAngleMax',
  'angleStep',
  'impactAngleMin',
  'impactAngleMax',
  'velocityMin',
  'velocityMax',
  'velocityStep',
  'refineMaxIter',
  'refineThreshold',
  'dragCoefficient',
  'magnusGain',
  'magnusPower',
  'optimalMoeWeight',
  'optimalSpeedDerivWeight',
  'optimalAngleDerivWeight',
  'optimalSpeedSecondDerivWeight',
  'optimalAngleSecondDerivWeight',
];

function isTrajGenParams(value: unknown): value is TrajGenParams {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  for (const key of PARAM_KEYS) {
    const v = record[key];
    if (v === undefined && (key === 'goalPlaneAngleDeg' || key.startsWith('optimal'))) continue;
    if (key === 'regeneratePerDistanceStep' || key === 'showGoalPlanes') {
      if (typeof v !== 'boolean') return false;
    } else if (typeof v !== 'number' || !Number.isFinite(v)) {
      return false;
    }
  }
  return true;
}

function normalizeTrajGenParams(record: Record<string, unknown>): TrajGenParams {
  const params = record as TrajGenParams;
  return {
    ...params,
    goalPlaneAngleDeg: typeof params.goalPlaneAngleDeg === 'number' ? params.goalPlaneAngleDeg : 0,
    showGoalPlanes: typeof params.showGoalPlanes === 'boolean' ? params.showGoalPlanes : false,
    ...DEFAULT_TRAJ_OPTIMIZER_PARAMS,
    ...(typeof params.optimalMoeWeight === 'number' ? { optimalMoeWeight: params.optimalMoeWeight } : {}),
    ...(typeof params.optimalSpeedDerivWeight === 'number' ? { optimalSpeedDerivWeight: params.optimalSpeedDerivWeight } : {}),
    ...(typeof params.optimalAngleDerivWeight === 'number' ? { optimalAngleDerivWeight: params.optimalAngleDerivWeight } : {}),
    ...(typeof params.optimalSpeedSecondDerivWeight === 'number' ? { optimalSpeedSecondDerivWeight: params.optimalSpeedSecondDerivWeight } : {}),
    ...(typeof params.optimalAngleSecondDerivWeight === 'number' ? { optimalAngleSecondDerivWeight: params.optimalAngleSecondDerivWeight } : {}),
  };
}

export function normalizeTrajGenParamsValue(value: unknown): TrajGenParams | null {
  if (!value || typeof value !== 'object') return null;
  if (isTrajGenParams(value)) {
    return normalizeTrajGenParams(value as Record<string, unknown>);
  }
  return null;
}

export interface TrajGenSettingsFile {
  version: 1;
  kind: 'trajGenSettings';
  params: TrajGenParams;
}

export function trajGenSettingsPayload(params: TrajGenParams): TrajGenSettingsFile {
  return { version: 1, kind: 'trajGenSettings', params };
}

export function parseTrajGenParamsValue(value: unknown): TrajGenParams | null {
  return normalizeTrajGenParamsValue(value);
}

export function parseTrajGenSettings(text: string): TrajGenParams | null {
  try {
    const json = JSON.parse(text) as unknown;
    if (json && typeof json === 'object') {
      const record = json as Record<string, unknown>;
      if (record.kind === 'trajGenSettings') {
        return parseTrajGenParamsValue(record.params);
      }
      return parseTrajGenParamsValue(json);
    }
    return null;
  } catch {
    return null;
  }
}

/** @deprecated Use trajGenProjectIO.downloadTrajGenProject instead. */
export function downloadTrajGenSettings(params: TrajGenParams): void {
  const text = JSON.stringify(trajGenSettingsPayload(params), null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trajgen_settings.json';
  a.click();
  URL.revokeObjectURL(url);
}
