import type { TrajGenParams } from '../types';

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
    optimalMoeWeight: typeof params.optimalMoeWeight === 'number' ? params.optimalMoeWeight : 1,
    optimalSpeedDerivWeight: typeof params.optimalSpeedDerivWeight === 'number' ? params.optimalSpeedDerivWeight : 0.3,
    optimalAngleDerivWeight: typeof params.optimalAngleDerivWeight === 'number' ? params.optimalAngleDerivWeight : 0.3,
    optimalSpeedSecondDerivWeight: typeof params.optimalSpeedSecondDerivWeight === 'number' ? params.optimalSpeedSecondDerivWeight : 0.1,
    optimalAngleSecondDerivWeight: typeof params.optimalAngleSecondDerivWeight === 'number' ? params.optimalAngleSecondDerivWeight : 0.1,
  };
}

export interface TrajGenSettingsFile {
  version: 1;
  kind: 'trajGenSettings';
  params: TrajGenParams;
}

export function trajGenSettingsPayload(params: TrajGenParams): TrajGenSettingsFile {
  return { version: 1, kind: 'trajGenSettings', params };
}

export function parseTrajGenSettings(text: string): TrajGenParams | null {
  try {
    const json = JSON.parse(text) as unknown;
    if (json && typeof json === 'object') {
      const record = json as Record<string, unknown>;
      if (record.kind === 'trajGenSettings' && isTrajGenParams(record.params)) {
        return normalizeTrajGenParams(record.params as Record<string, unknown>);
      }
      if (isTrajGenParams(json)) {
        return normalizeTrajGenParams(json as Record<string, unknown>);
      }
    }
    return null;
  } catch {
    return null;
  }
}

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
