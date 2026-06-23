import { TrajectoryPoint } from '../types';

export const TRAJECTORY_COLORS = [
  '#ef4444', // bright red
  '#eab308', // yellow
  '#22c55e', // bright green
  '#3b82f6', // bright blue
  '#a855f7', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export interface TrajectorySegment {
  id: string;
  name: string;
  points: TrajectoryPoint[];
  color: string;
  frameStart: number;
  frameEnd: number;
}

export function splitIntoSegments(points: TrajectoryPoint[]): TrajectoryPoint[][] {
  const sorted = [...points].sort((a, b) => a.frame - b.frame);
  if (sorted.length === 0) return [];
  const groups: TrajectoryPoint[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].frame - sorted[i - 1].frame > 1) {
      groups.push([sorted[i]]);
    } else {
      groups[groups.length - 1].push(sorted[i]);
    }
  }
  return groups;
}

export function firstTrajectoryPoint(points: TrajectoryPoint[]): TrajectoryPoint | null {
  if (points.length === 0) return null;
  return [...points].sort((a, b) => a.frame - b.frame)[0];
}

export function buildTrajectorySegments(points: TrajectoryPoint[]): TrajectorySegment[] {
  return splitIntoSegments(points).map((pts, i) => ({
    id: `traj-${pts[0].frame}-${i}`,
    name: `trajectory${i + 1}`,
    points: pts,
    color: TRAJECTORY_COLORS[i % TRAJECTORY_COLORS.length],
    frameStart: pts[0].frame,
    frameEnd: pts[pts.length - 1].frame,
  }));
}

export function segmentAtFrame(segments: TrajectorySegment[], frame: number): TrajectorySegment | null {
  return segments.find((s) => frame >= s.frameStart && frame <= s.frameEnd) ?? null;
}

/** Segment at this frame, or the one being extended on the next/previous consecutive frame. */
export function activeSegmentAtFrame(segments: TrajectorySegment[], frame: number): TrajectorySegment | null {
  const direct = segmentAtFrame(segments, frame);
  if (direct) return direct;
  return (
    segments.find((s) => s.frameEnd + 1 === frame) ??
    segments.find((s) => s.frameStart - 1 === frame) ??
    null
  );
}

export function formatFrameRange(start: number, end: number): string {
  const a = start + 1;
  const b = end + 1;
  return a === b ? `frame ${a}` : `frames ${a}–${b}`;
}

export function flattenSegments(segments: TrajectorySegment[]): TrajectoryPoint[] {
  return segments.flatMap((s) => s.points).sort((a, b) => a.frame - b.frame);
}

export interface TrajectorySaveFile {
  version: 1;
  videoName: string;
  trajectories: { name: string; points: TrajectoryPoint[] }[];
}

export function trajectoryPointsToSaveFile(
  videoName: string,
  points: TrajectoryPoint[]
): TrajectorySaveFile {
  const segments = buildTrajectorySegments(points);
  return {
    version: 1,
    videoName,
    trajectories: segments.map((s) => ({ name: s.name, points: s.points })),
  };
}

export function saveFileToTrajectoryPoints(data: TrajectorySaveFile): TrajectoryPoint[] {
  return data.trajectories
    .flatMap((t) => t.points)
    .sort((a, b) => a.frame - b.frame);
}

/** Parse legacy comma-separated .txt trajectory files. */
export function parseLegacyTrajectoryText(text: string): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(',');
    if (parts.length < 3) continue;
    const frame = parseInt(parts[0]);
    const x = parseFloat(parts[1]);
    const y = parseFloat(parts[2]);
    if (!isNaN(frame) && !isNaN(x) && !isNaN(y)) points.push({ frame, x, y });
  }
  return points.sort((a, b) => a.frame - b.frame);
}
