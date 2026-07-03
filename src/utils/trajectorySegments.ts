import { TrajectoryPoint, LaunchParams, Meterstick, MeterstickPoint, VideoData, XDir } from '../types';
import { defaultMeterstickPoints, defaultSegmentMeters, horizontalizeMeterstickPoints, meterstickFromPoints, normalizeSegmentMeters } from './meterstickScale';
import { elapsedSeconds } from './frameTiming';

export const DEFAULT_LAUNCH_PARAMS: LaunchParams = {
  exitVelocity: 8,
  exitAngle: 45,
  dragCoefficient: 0.01,
  magnusGain: 0,
  magnusPower: 2,
};

export function getLaunchParams(
  stored: Record<string, LaunchParams> | undefined,
  trajectoryId: string | null
): LaunchParams {
  if (!trajectoryId || !stored) return DEFAULT_LAUNCH_PARAMS;
  const saved = stored[trajectoryId];
  return saved ? { ...DEFAULT_LAUNCH_PARAMS, ...saved } : DEFAULT_LAUNCH_PARAMS;
}

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

export function isSkippedPoint(p: TrajectoryPoint): boolean {
  return p.skipped === true;
}

export function isPlottedPoint(p: TrajectoryPoint): boolean {
  return !isSkippedPoint(p);
}

export function plottedPoints(points: TrajectoryPoint[]): TrajectoryPoint[] {
  return points.filter(isPlottedPoint);
}

export function countPlottedPoints(points: TrajectoryPoint[]): number {
  return plottedPoints(points).length;
}

export function createSkippedPoint(frame: number): TrajectoryPoint {
  return { frame, skipped: true, x: 0, y: 0 };
}

/** Max frame index gap between labeled entries; allows up to 2 skipped frames in between. */
export const MAX_LABEL_FRAME_GAP = 3;

export function frameGapBetween(aFrame: number, bFrame: number): number {
  return Math.abs(bFrame - aFrame);
}

export function withinLabelFrameGap(aFrame: number, bFrame: number): boolean {
  return frameGapBetween(aFrame, bFrame) <= MAX_LABEL_FRAME_GAP;
}

/** Plotted runs broken when more than 2 frames are skipped between plotted points. */
export function plottedPathSegments(points: TrajectoryPoint[]): TrajectoryPoint[][] {
  const sorted = [...points].sort((a, b) => a.frame - b.frame);
  const segments: TrajectoryPoint[][] = [];
  let current: TrajectoryPoint[] = [];
  let lastPlottedFrame = -1;

  for (const pt of sorted) {
    if (!isPlottedPoint(pt)) continue;
    if (current.length === 0) {
      current = [pt];
      lastPlottedFrame = pt.frame;
      continue;
    }
    if (withinLabelFrameGap(lastPlottedFrame, pt.frame)) {
      current.push(pt);
    } else {
      segments.push(current);
      current = [pt];
    }
    lastPlottedFrame = pt.frame;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function splitIntoSegments(points: TrajectoryPoint[]): TrajectoryPoint[][] {
  const sorted = [...points].sort((a, b) => a.frame - b.frame);
  if (sorted.length === 0) return [];
  const groups: TrajectoryPoint[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (!withinLabelFrameGap(sorted[i - 1].frame, sorted[i].frame)) {
      groups.push([sorted[i]]);
    } else {
      groups[groups.length - 1].push(sorted[i]);
    }
  }
  return groups;
}

export function firstTrajectoryPoint(points: TrajectoryPoint[]): TrajectoryPoint | null {
  const plotted = plottedPoints(points);
  if (plotted.length === 0) return null;
  return [...plotted].sort((a, b) => a.frame - b.frame)[0];
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

/** Segment at this frame, or one within the label gap on either side. */
export function activeSegmentAtFrame(segments: TrajectorySegment[], frame: number): TrajectorySegment | null {
  const direct = segmentAtFrame(segments, frame);
  if (direct) return direct;
  const after = segments
    .filter((s) => frame > s.frameEnd && withinLabelFrameGap(s.frameEnd, frame))
    .sort((a, b) => a.frameEnd - b.frameEnd);
  if (after.length > 0) return after[after.length - 1];
  const before = segments
    .filter((s) => frame < s.frameStart && withinLabelFrameGap(frame, s.frameStart))
    .sort((a, b) => a.frameStart - b.frameStart);
  return before[0] ?? null;
}

/** All segments connected to anchor through gaps of at most 2 skipped frames. */
export function segmentsWithinLabelGap(
  segments: TrajectorySegment[],
  anchor: TrajectorySegment
): TrajectorySegment[] {
  const sorted = [...segments].sort((a, b) => a.frameStart - b.frameStart);
  const idx = sorted.findIndex((s) => s.id === anchor.id);
  if (idx < 0) return [anchor];
  let lo = idx;
  let hi = idx;
  while (lo > 0 && withinLabelFrameGap(sorted[lo - 1].frameEnd, sorted[lo].frameStart)) lo--;
  while (hi < sorted.length - 1 && withinLabelFrameGap(sorted[hi].frameEnd, sorted[hi + 1].frameStart)) hi++;
  return sorted.slice(lo, hi + 1);
}

export function resolveActiveSegment(
  segments: TrajectorySegment[],
  frame: number,
  focusedTrajectoryId: string | null
): TrajectorySegment | null {
  return (
    activeSegmentAtFrame(segments, frame) ??
    segments.find((s) => s.id === focusedTrajectoryId) ??
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

interface TimedPoint {
  t: number;
  x: number;
  y: number;
}

function positionAtTime(sorted: TimedPoint[], t: number): { x: number; y: number } | null {
  if (sorted.length === 0) return null;
  if (t < sorted[0].t - 1e-9 || t > sorted[sorted.length - 1].t + 1e-9) return null;
  if (Math.abs(t - sorted[0].t) < 1e-9) return { x: sorted[0].x, y: sorted[0].y };

  for (let i = 1; i < sorted.length; i++) {
    if (t <= sorted[i].t + 1e-9) {
      const p0 = sorted[i - 1];
      const p1 = sorted[i];
      if (Math.abs(p1.t - p0.t) < 1e-9) return { x: p1.x, y: p1.y };
      const u = (t - p0.t) / (p1.t - p0.t);
      return { x: p0.x + u * (p1.x - p0.x), y: p0.y + u * (p1.y - p0.y) };
    }
  }
  const last = sorted[sorted.length - 1];
  return { x: last.x, y: last.y };
}

/** Time-from-launch average of all segments; requires ≥2 segments with ≥2 points each. */
export function averageTrajectoryFromSegments(
  segments: TrajectorySegment[],
  framerate: number,
  frameTimes?: number[]
): TrajectoryPoint[] {
  if (!frameTimes?.length && framerate <= 0) return [];

  const timedSegments: TimedPoint[][] = segments
    .filter((s) => countPlottedPoints(s.points) >= 2)
    .map((s) => {
      const sorted = plottedPoints(s.points).sort((a, b) => a.frame - b.frame);
      const frameStart = sorted[0].frame;
      return sorted.map((p) => ({
        t: elapsedSeconds(frameTimes, framerate, p.frame, frameStart),
        x: p.x,
        y: p.y,
      }));
    });

  if (timedSegments.length < 2) return [];

  const sampleTimes = [
    ...new Set(timedSegments.flatMap((seg) => seg.map((p) => p.t))),
  ].sort((a, b) => a - b);

  const result: TrajectoryPoint[] = [];
  for (const t of sampleTimes) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const seg of timedSegments) {
      const pos = positionAtTime(seg, t);
      if (pos) {
        sumX += pos.x;
        sumY += pos.y;
        count++;
      }
    }
    if (count >= 2) {
      result.push({ x: sumX / count, y: sumY / count, frame: result.length });
    }
  }
  return result;
}

export interface TrajectorySaveFile {
  version: 1;
  videoName: string;
  trajectories: { name: string; points: TrajectoryPoint[] }[];
}

export interface ConfigurationSaveFile {
  version: 2;
  videoName: string;
  xdir?: XDir;
  meterstick: Meterstick;
  meterstickPoints?: MeterstickPoint[];
  meterstickSegmentMeters?: number[];
  trajectories: {
    name: string;
    points: TrajectoryPoint[];
    exitVelocity: number;
    exitAngle: number;
    dragCoefficient: number;
    magnusGain: number;
    magnusPower?: number;
  }[];
}

export interface LoadedConfiguration {
  points: TrajectoryPoint[];
  xdir?: XDir;
  meterstick?: Meterstick;
  meterstickPoints?: MeterstickPoint[];
  meterstickSegmentMeters?: number[];
  trajectoryLaunchParams?: Record<string, LaunchParams>;
}

export function videoToConfigurationSaveFile(
  video: Pick<VideoData, 'name' | 'trajectory' | 'meterstick' | 'meterstickPoints' | 'meterstickSegmentMeters' | 'trajectoryLaunchParams' | 'xdir'>
): ConfigurationSaveFile {
  const segments = buildTrajectorySegments(video.trajectory);
  const points = horizontalizeMeterstickPoints(video.meterstickPoints);
  const segmentMeters = normalizeSegmentMeters(points.length, video.meterstickSegmentMeters);
  return {
    version: 2,
    videoName: video.name,
    xdir: video.xdir ?? 1,
    meterstick: meterstickFromPoints(points, segmentMeters),
    meterstickPoints: points,
    meterstickSegmentMeters: segmentMeters,
    trajectories: segments.map((s) => {
      const p = getLaunchParams(video.trajectoryLaunchParams, s.id);
      return {
        name: s.name,
        points: s.points,
        exitVelocity: p.exitVelocity,
        exitAngle: p.exitAngle,
        dragCoefficient: p.dragCoefficient,
        magnusGain: p.magnusGain,
        magnusPower: p.magnusPower,
      };
    }),
  };
}

function configurationSaveFileToLoaded(data: ConfigurationSaveFile): LoadedConfiguration {
  const points = data.trajectories
    .flatMap((t) => t.points)
    .sort((a, b) => a.frame - b.frame);
  const segments = buildTrajectorySegments(points);
  const trajectoryLaunchParams: Record<string, LaunchParams> = {};
  for (const saved of data.trajectories) {
    const segment = segments.find((s) => s.name === saved.name);
    if (!segment) continue;
    trajectoryLaunchParams[segment.id] = {
      ...DEFAULT_LAUNCH_PARAMS,
      exitVelocity: saved.exitVelocity ?? DEFAULT_LAUNCH_PARAMS.exitVelocity,
      exitAngle: saved.exitAngle ?? DEFAULT_LAUNCH_PARAMS.exitAngle,
      dragCoefficient: saved.dragCoefficient ?? DEFAULT_LAUNCH_PARAMS.dragCoefficient,
      magnusGain: saved.magnusGain ?? DEFAULT_LAUNCH_PARAMS.magnusGain,
      magnusPower: saved.magnusPower ?? DEFAULT_LAUNCH_PARAMS.magnusPower,
    };
  }
  const meterstickPts = data.meterstickPoints && data.meterstickPoints.length >= 2
    ? horizontalizeMeterstickPoints(data.meterstickPoints)
    : data.meterstick
      ? defaultMeterstickPoints(data.meterstick)
      : undefined;
  const segmentMeters = meterstickPts
    ? normalizeSegmentMeters(meterstickPts.length, data.meterstickSegmentMeters)
    : undefined;
  return {
    points,
    xdir: data.xdir === -1 ? -1 : 1,
    meterstick: meterstickPts ? meterstickFromPoints(meterstickPts, segmentMeters) : data.meterstick,
    meterstickPoints: meterstickPts,
    meterstickSegmentMeters: segmentMeters,
    trajectoryLaunchParams,
  };
}

export function applyLoadedConfigurationToVideo(
  video: VideoData,
  config: LoadedConfiguration
): VideoData {
  const updated: VideoData = { ...video, trajectory: config.points };
  if (config.meterstickPoints && config.meterstickPoints.length >= 2) {
    updated.meterstickPoints = horizontalizeMeterstickPoints(config.meterstickPoints);
    updated.meterstickSegmentMeters = normalizeSegmentMeters(
      updated.meterstickPoints.length,
      config.meterstickSegmentMeters
    );
    updated.meterstick = meterstickFromPoints(updated.meterstickPoints, updated.meterstickSegmentMeters);
  } else if (config.meterstick) {
    updated.meterstick = config.meterstick;
    updated.meterstickPoints = defaultMeterstickPoints(config.meterstick);
    updated.meterstickSegmentMeters = defaultSegmentMeters(updated.meterstickPoints.length);
  }
  if (config.trajectoryLaunchParams) {
    updated.trajectoryLaunchParams = config.trajectoryLaunchParams;
  }
  updated.xdir = config.xdir === -1 ? -1 : 1;
  const firstPt = firstTrajectoryPoint(updated.trajectory);
  if (firstPt) updated.currentFrame = firstPt.frame;
  return updated;
}

export function parseConfigurationFile(text: string): LoadedConfiguration | null {
  try {
    const parsed = JSON.parse(text) as ConfigurationSaveFile | TrajectorySaveFile;
    if (parsed.version === 2 && Array.isArray(parsed.trajectories) && parsed.meterstick) {
      return configurationSaveFileToLoaded(parsed as ConfigurationSaveFile);
    }
    if (parsed.version === 1 && Array.isArray(parsed.trajectories)) {
      const points = saveFileToTrajectoryPoints(parsed);
      return points.length > 0 ? { points } : null;
    }
  } catch {
    // fall through to legacy text
  }
  const points = parseLegacyTrajectoryText(text);
  return points.length > 0 ? { points } : null;
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
