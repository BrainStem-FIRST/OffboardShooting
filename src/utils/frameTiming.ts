import type { VideoData } from '../types';

const MP4_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.3gp']);

export function isMp4ContainerFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return MP4_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

export function buildUniformFrameTimes(duration: number, framerate: number): number[] {
  const fps = framerate > 0 ? framerate : 30;
  const total = Math.max(1, Math.round(duration * fps));
  return Array.from({ length: total }, (_, i) => i / fps);
}

/** Presentation timestamps (seconds) per frame index. */
export function getFrameTimes(video: Pick<VideoData, 'frameTimes' | 'framerate'>, duration: number): number[] {
  if (video.frameTimes?.length) return video.frameTimes;
  return buildUniformFrameTimes(duration, video.framerate);
}

export function getTotalFrames(video: Pick<VideoData, 'frameTimes' | 'framerate'>, duration: number): number {
  return getFrameTimes(video, duration).length;
}

/** Average fps from scrub-bar frame count and container duration (frames / seconds). */
export function estimateFpsFromFrameCount(totalFrames: number, durationSec: number): number | null {
  if (!(durationSec > 0) || totalFrames <= 0) return null;
  return totalFrames / durationSec;
}

export function timeAtFrame(
  video: Pick<VideoData, 'frameTimes' | 'framerate'>,
  frame: number,
  duration: number
): number {
  const times = getFrameTimes(video, duration);
  const idx = Math.max(0, Math.min(frame, times.length - 1));
  return times[idx];
}

/** Seek target inside a frame's display window (avoids landing on shared PTS boundaries). */
export function seekTimeAtFrame(
  video: Pick<VideoData, 'frameTimes' | 'frameDurations' | 'framerate'>,
  frame: number,
  duration: number
): number {
  const times = getFrameTimes(video, duration);
  const idx = Math.max(0, Math.min(frame, times.length - 1));
  const start = times[idx];
  const nominalDt = video.framerate > 0 ? 1 / video.framerate : 1 / 30;
  const end =
    idx + 1 < times.length
      ? times[idx + 1]
      : start + (video.frameDurations?.[idx] ?? nominalDt);
  const span = end - start;
  if (span <= 0) return start;
  return start + span * 0.25;
}

export function deltaTimeAtFrame(
  video: Pick<VideoData, 'frameTimes' | 'framerate'>,
  frame: number,
  duration: number
): number | null {
  if (frame <= 0) return null;
  const times = getFrameTimes(video, duration);
  if (frame >= times.length) return null;
  const dt = times[frame] - times[frame - 1];
  return dt > 0 ? dt : null;
}

export function elapsedSeconds(
  frameTimes: number[] | undefined,
  framerate: number,
  frame: number,
  frame0: number
): number {
  if (frameTimes?.length) {
    const i = Math.max(0, Math.min(frame, frameTimes.length - 1));
    const j = Math.max(0, Math.min(frame0, frameTimes.length - 1));
    return frameTimes[i] - frameTimes[j];
  }
  if (framerate <= 0) return 0;
  return (frame - frame0) / framerate;
}

export function deltaSeconds(
  frameTimes: number[] | undefined,
  framerate: number,
  frame1: number,
  frame2: number
): number | null {
  if (frame2 <= frame1) return null;
  if (frameTimes?.length) {
    if (frame1 < 0 || frame2 >= frameTimes.length) return null;
    const dt = frameTimes[frame2] - frameTimes[frame1];
    return dt > 0 ? dt : null;
  }
  if (framerate <= 0) return null;
  return (frame2 - frame1) / framerate;
}

export function estimateFramerateFromPts(pts: number[]): number {
  if (pts.length < 2) return 30;
  const deltas: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i] - pts[i - 1];
    if (dt > 1e-9) deltas.push(dt);
  }
  if (deltas.length === 0) return 30;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return median > 0 ? 1 / median : 30;
}

export function applyExtractedFrameTiming(
  video: VideoData,
  extracted: { pts: number[]; dts: number[]; durations: number[] }
): VideoData {
  return {
    ...video,
    frameTimes: extracted.pts,
    frameDecodeTimes: extracted.dts,
    frameDurations: extracted.durations,
    framerate: estimateFramerateFromPts(extracted.pts),
  };
}

export function formatFrameTimingDebugTxt(video: VideoData, duration: number): string {
  const pts = getFrameTimes(video, duration);
  const dts = video.frameDecodeTimes;
  const durations = video.frameDurations;
  const lines = ['frame\tpts_sec\tdts_sec\tpts_delta_ms\tdts_delta_ms\tduration_ms'];
  for (let i = 0; i < pts.length; i++) {
    const ptsDelta = i > 0 ? ((pts[i] - pts[i - 1]) * 1000).toFixed(3) : '-';
    const dtsVal = dts?.[i];
    const dtsDelta =
      dts && i > 0 && dtsVal !== undefined ? ((dtsVal - dts[i - 1]) * 1000).toFixed(3) : '-';
    const dur = durations?.[i] !== undefined ? (durations[i] * 1000).toFixed(3) : '-';
    lines.push(
      `${i}\t${pts[i].toFixed(6)}\t${dtsVal !== undefined ? dtsVal.toFixed(6) : '-'}\t${ptsDelta}\t${dtsDelta}\t${dur}`
    );
  }
  return lines.join('\n');
}

export function downloadFrameTimingDebug(video: VideoData, duration: number): void {
  const text = formatFrameTimingDebugTxt(video, duration);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stem = video.name.replace(/\.[^.]+$/, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${stem}_frame_timing.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Frame indices where instantaneous fps deviates >10% from expected. */
export function irregularFrameIndices(
  frameTimes: number[] | undefined,
  expectedFps: number
): number[] {
  if (!frameTimes?.length || frameTimes.length < 2 || expectedFps <= 0) return [];
  const lo = expectedFps * 0.97;
  const hi = expectedFps * 1.03;
  const out: number[] = [];
  for (let i = 1; i < frameTimes.length; i++) {
    const dt = frameTimes[i] - frameTimes[i - 1];
    if (dt <= 1e-9) continue;
    const instantFps = 1 / dt;
    if (instantFps < lo || instantFps > hi) out.push(i);
  }
  return out;
}
