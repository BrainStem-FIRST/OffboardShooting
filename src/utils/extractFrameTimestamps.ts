import { createFile, type Movie } from 'mp4box';
import { isMp4ContainerFileName } from './frameTiming';

type MP4ArrayBuffer = ArrayBuffer & { fileStart: number };

export interface ExtractedFrameTiming {
  pts: number[];
  dts: number[];
  durations: number[];
}

function sortSamplesByPts(
  pts: number[],
  dts: number[],
  durations: number[]
): ExtractedFrameTiming {
  const indexed = pts.map((p, i) => ({ pts: p, dts: dts[i], dur: durations[i] }));
  indexed.sort((a, b) => a.pts - b.pts || a.dts - b.dts);
  return {
    pts: indexed.map((x) => x.pts),
    dts: indexed.map((x) => x.dts),
    durations: indexed.map((x) => x.dur),
  };
}

/** Parse MP4/MOV container and return per-sample PTS/DTS in seconds (presentation order). */
export function extractFrameTimestamps(file: File): Promise<ExtractedFrameTiming | null> {
  if (!isMp4ContainerFileName(file.name)) return Promise.resolve(null);

  return new Promise((resolve) => {
    const mp4boxFile = createFile();
    let finished = false;

    const finish = (result: ExtractedFrameTiming | null) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };

    mp4boxFile.onReady = (info: Movie) => {
      const videoTrack =
        info.videoTracks[0] ??
        info.tracks.find((t) => t.video !== undefined || t.type === 'video');
      if (!videoTrack || videoTrack.nb_samples <= 0) {
        finish(null);
        return;
      }

      const samples = mp4boxFile.getTrackSamplesInfo(videoTrack.id);
      if (!samples.length) {
        finish(null);
        return;
      }

      const pts: number[] = [];
      const dts: number[] = [];
      const durations: number[] = [];
      for (const sample of samples) {
        const ts = sample.timescale;
        if (!ts) continue;
        pts.push(sample.cts / ts);
        dts.push(sample.dts / ts);
        durations.push(sample.duration / ts);
      }

      if (pts.length === 0) finish(null);
      else finish(sortSamplesByPts(pts, dts, durations));
    };

    mp4boxFile.onError = () => finish(null);

    file
      .arrayBuffer()
      .then((buffer) => {
        const ab = buffer as MP4ArrayBuffer;
        ab.fileStart = 0;
        mp4boxFile.appendBuffer(ab);
        mp4boxFile.flush();
      })
      .catch(() => finish(null));

    setTimeout(() => finish(null), 30000);
  });
}
