import type { TrajGenParams, TrajGroup } from '../types';
import type { TrajectoryMoe } from '../simulation';
import { resolveMagnusPower } from '../simulation';
import { buildTrajGenProjectPayload } from './trajGenProjectIO';
import { normalizeTrajGenParamsValue } from './trajGenSettingsIO';
export const TRAJECTORY_JAVA_CLASS_NAME = 'TrajectoryJsonString';
export const TRAJECTORY_JAVA_FILE_NAME = `${TRAJECTORY_JAVA_CLASS_NAME}.java`;

export interface JavaTrajectoryEntry {
  exitAngle: number;
  speed: number;
  tof: number;
  speedMOE: number;
  angleMOE: number;
}

export interface JavaTrajectoryGroup {
  dx: number;
  trajectories: JavaTrajectoryEntry[];
}

export interface JavaTrajectoryPayload {
  dy: number;
  dragCoeff: number;
  magnusCoeff: number;
  magnusPower: number;
  groups: JavaTrajectoryGroup[];
}

/** Slim trajectory JSON for embedding in Java. */
export function buildTrajectoryJavaJsonPayload(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): JavaTrajectoryPayload {
  const normalizedParams = normalizeTrajGenParamsValue(params) ?? params;
  const groupsWithTrajs = groups.filter((g) => g.trajectories.length > 0);
  const exported = buildTrajGenProjectPayload(normalizedParams, groups, trajMoeById);
  const firstGroup = groupsWithTrajs[0];

  return {
    dy: normalizedParams.dy,
    dragCoeff: firstGroup?.drag ?? normalizedParams.dragCoefficient,
    magnusCoeff: firstGroup?.magnus ?? normalizedParams.magnusGain,
    magnusPower: resolveMagnusPower(firstGroup?.magnusPower ?? normalizedParams.magnusPower),
    groups: exported.groups.map((group, index) => {
      const record = group as Record<string, unknown>;
      const sourceGroup = groupsWithTrajs[index];
      const trajectories = Array.isArray(record.trajectories)
        ? (record.trajectories as Record<string, number>[])
        : [];
      return {
        dx: typeof record.dx === 'number' ? record.dx : sourceGroup.dx,
        trajectories: trajectories.map((t) => ({
          exitAngle: t.exitAngle,
          speed: t.speed,
          tof: t.timeOfFlight,
          speedMOE: t.speedMoe ?? 0,
          angleMOE: t.angleMoe ?? 0,
        })),
      };
    }),
  };
}
export function serializeTrajectoryJavaJson(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): string {
  const payload = buildTrajectoryJavaJsonPayload(params, groups, trajMoeById);
  const json = JSON.stringify(payload);
  JSON.parse(json);
  return json;
}

const JAVA_JSON_CHUNK_SIZE = 500;

function escapeJavaStringLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function splitIntoChunks(value: string, chunkSize: number): string[] {
  if (value.length === 0) return [''];
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks;
}

export function buildTrajectoryJavaClass(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): string {
  const json = serializeTrajectoryJavaJson(params, groups, trajMoeById);
  const chunks = splitIntoChunks(json, JAVA_JSON_CHUNK_SIZE);
  const declarations = chunks
    .map((chunk, index) => {
      const escaped = escapeJavaStringLiteral(chunk);
      return `        String string${index + 1} = "${escaped}";`;
    })
    .join('\n');
  const returnExpr = chunks.map((_, index) => `string${index + 1}`).join(' + ');

  return `public final class ${TRAJECTORY_JAVA_CLASS_NAME} {

    private ${TRAJECTORY_JAVA_CLASS_NAME}() {
    }

    public static String getJson() {
${declarations}
        return ${returnExpr};
    }
}
`;
}

export function downloadTrajectoryJavaFile(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): void {
  const text = buildTrajectoryJavaClass(params, groups, trajMoeById);
  const blob = new Blob([text], { type: 'text/x-java-source;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = TRAJECTORY_JAVA_FILE_NAME;
  a.click();
  URL.revokeObjectURL(url);
}
