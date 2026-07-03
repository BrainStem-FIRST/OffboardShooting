import type { TrajGenParams, TrajGroup } from '../types';
import type { TrajectoryMoe } from '../simulation';
import { buildTrajGenProjectPayload, type TrajGenProjectFile } from './trajGenProjectIO';
export const TRAJECTORY_JAVA_CLASS_NAME = 'TrajectoryJsonString';
export const TRAJECTORY_JAVA_FILE_NAME = `${TRAJECTORY_JAVA_CLASS_NAME}.java`;

/** Same JSON payload as the regular trajectory project download, embedded in Java. */
export function buildTrajectoryJavaJsonPayload(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): TrajGenProjectFile {
  return buildTrajGenProjectPayload(params, groups, trajMoeById);
}

export function serializeTrajectoryJavaJson(
  params: TrajGenParams,
  groups: TrajGroup[],
  trajMoeById?: Map<string, TrajectoryMoe>,
): string {
  const json = JSON.stringify(buildTrajectoryJavaJsonPayload(params, groups, trajMoeById));
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
