import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Upload, FolderDown } from 'lucide-react';
import { VideoData, TrajectoryPoint, LaunchParams, GeneratedTrajectory, TrajGenParams, TrajGroup, MeterstickPoint, MeterstickClipboard, XDir } from './types';
import SysIdSidebar from './components/SysIdSidebar';
import VideoDisplay from './components/VideoDisplay';
import SimulationControls from './components/SimulationControls';
import XdirUploadDialog from './components/XdirUploadDialog';
import TrajectoryGenCenter from './components/TrajectoryGenCenter';
import TrajectoryGenLeft from './components/TrajectoryGenLeft';
import TrajectoryGenRight from './components/TrajectoryGenRight';
import { generateTrajectoriesAsync, refineTrajectoriesAsync, buildTrajectoryMoeMapAsync, syncGroupMoeInMap, trajIdsNeedingMoeRecompute, pickOptimalTrajectoryPaths, optimalPickWeightsFromParams, type TrajGenProgress, type MoeRecalcProgress, type TrajectoryMoe, type MoeSettings } from './simulation';
import { buildTrajectorySegments, resolveActiveSegment, getLaunchParams, createSkippedPoint, applyLoadedConfigurationToVideo, type LoadedConfiguration } from './utils/trajectorySegments';
import { isUnsuccessfulTrajectory } from './utils/trajGenStatus';
import type { ImportedProjectEntry } from './utils/projectIO';
import { MeterstickScale, defaultMeterstickPoints, scaleToPpmFn, horizontalizeMeterstickPoints, meterstickFromPoints, adjustSegmentMetersForPointChange, normalizeSegmentMeters, defaultSegmentMeters } from './utils/meterstickScale';
import { extractFrameTimestamps } from './utils/extractFrameTimestamps';
import { applyExtractedFrameTiming } from './utils/frameTiming';

const LEFT_MIN = 160;
const LEFT_MAX = 480;
const LEFT_DEFAULT = Math.round(256 * 1.3 * 0.9);

const RIGHT_MIN = 220;
const RIGHT_MAX = 520;
const RIGHT_DEFAULT = 310;

const MAX_TRAJECTORY_HISTORY = 10;

type Tab = 'trajgen' | 'sysid';
type OptimalArc = 'low' | 'high';

type OptimalPathIds = {
  lowArcIds: Set<string>;
  highArcIds: Set<string>;
  allIds: Set<string>;
};

function effectiveOptimalIdsFromGroups(
  groups: TrajGroup[],
  computed: OptimalPathIds,
): OptimalPathIds {
  const lowArcIds = new Set<string>();
  const highArcIds = new Set<string>();
  for (const group of groups) {
    const lowIndex = group.optimalLowArcTrajectoryIndex;
    if (lowIndex !== undefined && group.trajectories[lowIndex]) {
      lowArcIds.add(group.trajectories[lowIndex].id);
    } else {
      const computedLow = group.trajectories.find((traj) => computed.lowArcIds.has(traj.id));
      if (computedLow) lowArcIds.add(computedLow.id);
    }
    const highIndex = group.optimalHighArcTrajectoryIndex;
    if (highIndex !== undefined && group.trajectories[highIndex]) {
      highArcIds.add(group.trajectories[highIndex].id);
    } else {
      const computedHigh = group.trajectories.find((traj) => computed.highArcIds.has(traj.id));
      if (computedHigh) highArcIds.add(computedHigh.id);
    }
  }
  return { lowArcIds, highArcIds, allIds: new Set([...lowArcIds, ...highArcIds]) };
}

function groupsWithOptimalIds(
  groups: TrajGroup[],
  lowArcIds: Set<string>,
  highArcIds: Set<string>,
): TrajGroup[] {
  return groups.map((group) => {
    const lowIndex = group.trajectories.findIndex((traj) => lowArcIds.has(traj.id));
    const highIndex = group.trajectories.findIndex((traj) => highArcIds.has(traj.id));
    return {
      ...group,
      optimalLowArcTrajectoryIndex: lowIndex >= 0 ? lowIndex : undefined,
      optimalHighArcTrajectoryIndex: highIndex >= 0 ? highIndex : undefined,
    };
  });
}

function makeDefaultVideo(id: string, name: string, url: string): VideoData {
  const meterstick = { x: 80, y: 680, length: 160 };
  const meterstickPoints = defaultMeterstickPoints(meterstick);
  const meterstickSegmentMeters = defaultSegmentMeters(meterstickPoints.length);
  return {
    id,
    name,
    url,
    trajectory: [],
    meterstick,
    meterstickPoints,
    meterstickSegmentMeters,
    trajectoryLaunchParams: {},
    showSimulation: false,
    currentFrame: 0,
    framerate: 30,
    empiricalNumPoints: 2,
    xdir: 1,
  };
}

const DEFAULT_TRAJGEN_PARAMS: TrajGenParams = {
  dx: 3,
  dy: 1.8,
  dxMin: 1,
  dxMax: 5,
  dxStep: 0.2,
  regeneratePerDistanceStep: false,
  perDistanceErrorTolerance: 0.5,
  errorTolerance: 0.4,
  goalPlaneAngleDeg: 0,
  showGoalPlanes: false,
  exitAngleMin: 30,
  exitAngleMax: 85,
  angleStep: 0.5,
  impactAngleMin: 35,
  impactAngleMax: 90,
  velocityMin: 4,
  velocityMax: 14,
  velocityStep: 0.025,
  refineMaxIter: 250,
  refineThreshold: 0.0001,
  dragCoefficient: 0.01,
  magnusGain: 0,
  magnusPower: 1,
  optimalMoeWeight: 1,
  optimalSpeedDerivWeight: 0.15,
  optimalAngleDerivWeight: 0.03,
  optimalSpeedSecondDerivWeight: 0.01,
  optimalAngleSecondDerivWeight: 0.01,
  optimalVelocityBufferLineX1: 1,
  optimalVelocityBufferLineY1: 0,
  optimalVelocityBufferLineX2: 5,
  optimalVelocityBufferLineY2: 0,
};

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative flex-shrink-0 w-1 cursor-col-resize h-full select-none"
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="absolute inset-0 transition-colors duration-150"
        style={{ background: hovered ? 'rgba(59,130,246,0.6)' : 'rgba(55,65,81,1)' }}
      />
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('trajgen');
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);

  // System ID state
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Trajectory annotation UI state (sysid)
  const [plottingMode, setPlottingMode] = useState(false);
  const [pointRadius, setPointRadius] = useState(5);
  const [showAllTrajectories, setShowAllTrajectories] = useState(false);
  const [showAverageTrajectory, setShowAverageTrajectory] = useState(false);
  const [showTrajectoryPoints, setShowTrajectoryPoints] = useState(true);
  const [focusedTrajectoryId, setFocusedTrajectoryId] = useState<string | null>(null);
  const [totalFrames, setTotalFrames] = useState(1);
  const [videoDuration, setVideoDuration] = useState(0);
  const undoStack = useRef<TrajectoryPoint[][]>([]);
  const redoStack = useRef<TrajectoryPoint[][]>([]);
  const meterstickClipboardRef = useRef<MeterstickClipboard | null>(null);
  const frameHoldRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentFrameRef = useRef(0);
  const totalFramesRef = useRef(1);
  const [, setHistoryTick] = useState(0);
  const bumpHistory = () => setHistoryTick((n) => n + 1);

  // Trajectory generation state
  const [trajGenParams, setTrajGenParams] = useState<TrajGenParams>(DEFAULT_TRAJGEN_PARAMS);
  const [trajGroups, setTrajGroups] = useState<TrajGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [genProgress, setGenProgress] = useState<TrajGenProgress | null>(null);
  const [hoveredTrajId, setHoveredTrajId] = useState<string | null>(null);
  const [showAllTrajGenTrajectories, setShowAllTrajGenTrajectories] = useState(false);
  const [showOptimalTrajectoriesTrajGen, setShowOptimalTrajectoriesTrajGen] = useState(false);
  const [trajMoeById, setTrajMoeById] = useState<Map<string, TrajectoryMoe>>(() => new Map());
  const [moeRecalculating, setMoeRecalculating] = useState(false);
  const [moeRecalcProgress, setMoeRecalcProgress] = useState<MoeRecalcProgress | null>(null);
  const trajGroupsRef = useRef(trajGroups);
  const trajGenParamsRef = useRef(trajGenParams);
  trajGroupsRef.current = trajGroups;
  trajGenParamsRef.current = trajGenParams;

  const getMoeSettings = useCallback((): MoeSettings => {
    const p = trajGenParamsRef.current;
    return {
      errorTolerance: p.errorTolerance,
      magnusPower: p.magnusPower ?? 2,
      goalPlaneAngleDeg: p.goalPlaneAngleDeg,
    };
  }, []);

  const scheduleFullMoeBuild = useCallback((groups: TrajGroup[]) => {
    if (groups.length === 0) {
      setTrajMoeById(new Map());
      return;
    }
    const settings = getMoeSettings();
    void buildTrajectoryMoeMapAsync(
      groups,
      settings.errorTolerance,
      false,
      () => {},
      undefined,
      settings.magnusPower,
      settings.goalPlaneAngleDeg,
    ).then(setTrajMoeById);
  }, [getMoeSettings]);

  const patchTrajMoeForGroup = useCallback((
    groupId: string,
    newTrajs: GeneratedTrajectory[],
  ) => {
    const groups = trajGroupsRef.current;
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const { removed, recompute } = trajIdsNeedingMoeRecompute(group.trajectories, newTrajs);
    if (removed.length === 0 && recompute.length === 0) return;
    const settings = getMoeSettings();
    const updatedGroup = { ...group, trajectories: newTrajs };

    if (removed.length > 0) {
      setTrajMoeById((prev) => {
        const next = new Map(prev);
        for (const id of removed) next.delete(id);
        return next;
      });
    }

    if (recompute.length > 0) {
      setTimeout(() => {
        setTrajMoeById((prev) => {
          const next = new Map(prev);
          syncGroupMoeInMap(next, updatedGroup, settings, recompute);
          return next;
        });
      }, 0);
    }
  }, [getMoeSettings]);

  const removeTrajMoeIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setTrajMoeById((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const handleShowAllTrajGenChange = useCallback((checked: boolean) => {
    setShowAllTrajGenTrajectories(checked);
    if (checked) setShowOptimalTrajectoriesTrajGen(false);
  }, []);

  const handleShowOptimalTrajectoriesTrajGenChange = useCallback((checked: boolean) => {
    setShowOptimalTrajectoriesTrajGen(checked);
    if (checked) setShowAllTrajGenTrajectories(false);
  }, []);

  const handleRecalculateMoe = useCallback((errorTolerance: number, goalPlaneAngleDeg: number) => {
    setTrajGenParams((p) => ({ ...p, errorTolerance, goalPlaneAngleDeg }));
    const cleaned = trajGroupsRef.current.map((g) => ({
      ...g,
      optimalLowArcTrajectoryIndex: undefined,
      optimalHighArcTrajectoryIndex: undefined,
      trajectories: g.trajectories.map(
        ({ speedMoe, angleMoe, speedMoeMinus, speedMoePlus, angleMoeMinus, angleMoePlus, ...t }) => t,
      ),
    }));
    setTrajGroups(cleaned);
    setMoeRecalculating(true);
    setMoeRecalcProgress(null);

    void buildTrajectoryMoeMapAsync(
      cleaned,
      errorTolerance,
      true,
      setMoeRecalcProgress,
      undefined,
      trajGenParams.magnusPower ?? 2,
      trajGenParams.goalPlaneAngleDeg,
    ).then((map) => {
      setTrajMoeById(map);
      setMoeRecalculating(false);
      setMoeRecalcProgress(null);
    });
  }, []);

  // Panel sizing
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
  const [rightOpen, setRightOpen] = useState(true);

  const leftDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const rightDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const centerUploadRef = useRef<HTMLInputElement>(null);
  const importProjectActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (leftDragRef.current) {
        const dx = e.clientX - leftDragRef.current.startX;
        setLeftWidth(Math.min(LEFT_MAX, Math.max(LEFT_MIN, leftDragRef.current.startW + dx)));
      }
      if (rightDragRef.current) {
        const dx = e.clientX - rightDragRef.current.startX;
        setRightWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, rightDragRef.current.startW - dx)));
      }
    }
    function onUp() {
      leftDragRef.current = null;
      rightDragRef.current = null;
      setIsDragging(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const selectedVideo = videos.find((v) => v.id === selectedId) ?? null;
  const selectedGroup = trajGroups.find(g => g.id === selectedGroupId) ?? trajGroups[0] ?? null;

  const optimalTrajPaths = useMemo(() => {
    if (trajGroups.length === 0 || trajMoeById.size === 0) {
      return { lowArcIds: new Set<string>(), highArcIds: new Set<string>(), allIds: new Set<string>() };
    }
    return pickOptimalTrajectoryPaths(
      trajGroups,
      trajMoeById,
      optimalPickWeightsFromParams(trajGenParams),
    );
  }, [trajGroups, trajMoeById, trajGenParams.optimalMoeWeight, trajGenParams.optimalSpeedDerivWeight, trajGenParams.optimalAngleDerivWeight, trajGenParams.optimalSpeedSecondDerivWeight, trajGenParams.optimalAngleSecondDerivWeight, trajGenParams.optimalVelocityBufferLineX1, trajGenParams.optimalVelocityBufferLineY1, trajGenParams.optimalVelocityBufferLineX2, trajGenParams.optimalVelocityBufferLineY2]);
  const visibleOptimalTrajPaths = useMemo(
    () => effectiveOptimalIdsFromGroups(trajGroups, optimalTrajPaths),
    [trajGroups, optimalTrajPaths],
  );
  const bestMoeTrajIds = visibleOptimalTrajPaths.allIds;

  const handleSaveOptimalTrajectories = useCallback(() => {
    setTrajGroups((prev) => groupsWithOptimalIds(prev, optimalTrajPaths.lowArcIds, optimalTrajPaths.highArcIds));
  }, [optimalTrajPaths.lowArcIds, optimalTrajPaths.highArcIds]);

  const handleSetManualOptimalTrajectory = useCallback((groupId: string, trajId: string, arc: OptimalArc) => {
    setTrajGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        const index = group.trajectories.findIndex((traj) => traj.id === trajId);
        if (index < 0) return group;
        return arc === 'low'
          ? { ...group, optimalLowArcTrajectoryIndex: index }
          : { ...group, optimalHighArcTrajectoryIndex: index };
      })
    );
  }, []);

  currentFrameRef.current = selectedVideo?.currentFrame ?? 0;
  totalFramesRef.current = totalFrames;

  const trajectorySegments = useMemo(
    () => (selectedVideo ? buildTrajectorySegments(selectedVideo.trajectory) : []),
    [selectedVideo]
  );

  const activeSegment = useMemo(() => {
    if (!selectedVideo) return null;
    return resolveActiveSegment(trajectorySegments, selectedVideo.currentFrame, focusedTrajectoryId);
  }, [selectedVideo, trajectorySegments, focusedTrajectoryId]);

  const activeTrajectoryPoints = useMemo(() => activeSegment?.points ?? [], [activeSegment]);

  const allVideosTrajectories = useMemo(
    () =>
      videos.flatMap((video) => {
        const scale = MeterstickScale.fromVideo(video);
        const ppm = scaleToPpmFn(scale);
        const fps = video.framerate;
        return buildTrajectorySegments(video.trajectory).map((seg) => ({
          id: seg.id,
          videoId: video.id,
          points: seg.points,
          launchParams: getLaunchParams(video.trajectoryLaunchParams, seg.id),
          pixelsPerMeter: ppm,
          framerate: fps,
          frameTimes: video.frameTimes,
          xdir: video.xdir ?? 1,
        }));
      }),
    [videos]
  );

  const selectedMeterstickScale = useMemo(
    () => (selectedVideo ? MeterstickScale.fromVideo(selectedVideo) : null),
    [selectedVideo]
  );

  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    setFocusedTrajectoryId(null);
    setPlottingMode(false);
  }, [selectedId]);

  useEffect(() => () => {
    if (frameHoldRef.current) clearInterval(frameHoldRef.current);
  }, []);

  function updateVideo(id: string, patch: Partial<VideoData>) {
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  async function buildVideoFromFile(
    file: File,
    patch: Partial<VideoData> = {}
  ): Promise<VideoData> {
    const url = URL.createObjectURL(file);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let video = { ...makeDefaultVideo(id, file.name, url), ...patch };
    const extracted = await extractFrameTimestamps(file);
    if (extracted) video = applyExtractedFrameTiming(video, extracted);
    return video;
  }

  function requestUpload(files: FileList) {
    setPendingUploadFiles(Array.from(files));
  }

  function cancelPendingUpload() {
    setPendingUploadFiles(null);
  }

  async function confirmUpload(xdir: XDir) {
    if (!pendingUploadFiles?.length) return;
    const newVideos = await Promise.all(
      pendingUploadFiles.map((file) => buildVideoFromFile(file, { xdir }))
    );
    setVideos((prev) => [...prev, ...newVideos]);
    if (!selectedId && newVideos.length > 0) setSelectedId(newVideos[0].id);
    setPendingUploadFiles(null);
  }

  function handleDelete(id: string) {
    setVideos((prev) => {
      const vid = prev.find((v) => v.id === id);
      if (vid) URL.revokeObjectURL(vid.url);
      const next = prev.filter((v) => v.id !== id);
      if (selectedId === id) setSelectedId(next.length > 0 ? next[0].id : null);
      return next;
    });
  }

  const handleTrajectoryUpdate = useCallback(
    (points: TrajectoryPoint[]) => {
      if (!selectedId) return;
      updateVideo(selectedId, { trajectory: points });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId]
  );

  const pushUndo = useCallback((current: TrajectoryPoint[]) => {
    undoStack.current = [...undoStack.current.slice(-MAX_TRAJECTORY_HISTORY + 1), [...current]];
    redoStack.current = [];
    bumpHistory();
  }, []);

  const handleUndo = useCallback(() => {
    if (!selectedVideo || undoStack.current.length === 0) return;
    redoStack.current = [[...selectedVideo.trajectory], ...redoStack.current.slice(0, MAX_TRAJECTORY_HISTORY - 1)];
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    handleTrajectoryUpdate(prev);
    bumpHistory();
  }, [selectedVideo, handleTrajectoryUpdate]);

  const handleRedo = useCallback(() => {
    if (!selectedVideo || redoStack.current.length === 0) return;
    undoStack.current = [...undoStack.current.slice(-MAX_TRAJECTORY_HISTORY + 1), [...selectedVideo.trajectory]];
    const next = redoStack.current[0];
    redoStack.current = redoStack.current.slice(1);
    handleTrajectoryUpdate(next);
    bumpHistory();
  }, [selectedVideo, handleTrajectoryUpdate]);

  const handleSkipFrame = useCallback(() => {
    if (!selectedVideo || !selectedId) return;
    const current = selectedVideo.currentFrame;
    if (current >= totalFramesRef.current - 1) return;
    pushUndo(selectedVideo.trajectory);
    const skipPt = createSkippedPoint(current);
    const updated = [
      ...selectedVideo.trajectory.filter((p) => p.frame !== current),
      skipPt,
    ].sort((a, b) => a.frame - b.frame);
    updateVideo(selectedId, { trajectory: updated, currentFrame: current + 1 });
  }, [selectedVideo, selectedId, pushUndo]);

  const handleDeleteCurrentPoint = useCallback(() => {
    if (!selectedVideo) return;
    const hasPoint = selectedVideo.trajectory.some((p) => p.frame === selectedVideo.currentFrame);
    if (!hasPoint) return;
    pushUndo(selectedVideo.trajectory);
    handleTrajectoryUpdate(selectedVideo.trajectory.filter((p) => p.frame !== selectedVideo.currentFrame));
  }, [selectedVideo, pushUndo, handleTrajectoryUpdate]);

  const handleClearAllPoints = useCallback(() => {
    if (!selectedVideo) return;
    pushUndo(selectedVideo.trajectory);
    handleTrajectoryUpdate([]);
    setFocusedTrajectoryId(null);
  }, [selectedVideo, pushUndo, handleTrajectoryUpdate]);

  const handleAttachConfig = useCallback((videoId: string, config: LoadedConfiguration) => {
    setVideos((prev) =>
      prev.map((v) => (v.id === videoId ? applyLoadedConfigurationToVideo(v, config) : v))
    );
    setSelectedId(videoId);
    undoStack.current = [];
    redoStack.current = [];
    bumpHistory();
    const segs = buildTrajectorySegments(config.points);
    setFocusedTrajectoryId(segs[0]?.id ?? null);
    setPlottingMode(false);
  }, []);

  const handleUpdateVideoXdir = useCallback((videoId: string, xdir: XDir) => {
    updateVideo(videoId, { xdir });
  }, []);

  const handleImportProject = useCallback(async (entries: ImportedProjectEntry[]) => {
    const newVideos = await Promise.all(
      entries.map(async (entry) => {
        const video = await buildVideoFromFile(entry.file);
        return entry.config ? applyLoadedConfigurationToVideo(video, entry.config) : video;
      })
    );
    setVideos((prev) => {
      prev.forEach((v) => URL.revokeObjectURL(v.url));
      return newVideos;
    });
    undoStack.current = [];
    redoStack.current = [];
    bumpHistory();
    const firstVideo = newVideos[0];
    const firstSegments = firstVideo ? buildTrajectorySegments(firstVideo.trajectory) : [];
    setFocusedTrajectoryId(firstSegments[0]?.id ?? null);
    setPlottingMode(false);
    setSelectedId(firstVideo?.id ?? null);
  }, []);

  const handleStepFrame = useCallback(
    (delta: number) => {
      if (!selectedId) return;
      const next = Math.min(totalFramesRef.current - 1, Math.max(0, currentFrameRef.current + delta));
      updateVideo(selectedId, { currentFrame: next });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId]
  );

  const handleStartFrameHold = useCallback(
    (dir: number) => {
      if (frameHoldRef.current) clearInterval(frameHoldRef.current);
      frameHoldRef.current = setInterval(() => handleStepFrame(dir), 60);
    },
    [handleStepFrame]
  );

  const handleStopFrameHold = useCallback(() => {
    if (frameHoldRef.current) {
      clearInterval(frameHoldRef.current);
      frameHoldRef.current = null;
    }
  }, []);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  const canDeleteCurrentPoint = selectedVideo
    ? selectedVideo.trajectory.some((p) => p.frame === selectedVideo.currentFrame)
    : false;
  const canSkipFrame = selectedVideo
    ? selectedVideo.currentFrame < totalFrames - 1
    : false;

  const handleMeterstickPointsUpdate = useCallback(
    (points: MeterstickPoint[]) => {
      if (!selectedId || !selectedVideo) return;
      const flat = horizontalizeMeterstickPoints(points);
      const segmentMeters = adjustSegmentMetersForPointChange(
        selectedVideo.meterstickPoints,
        flat,
        selectedVideo.meterstickSegmentMeters
      );
      updateVideo(selectedId, {
        meterstickPoints: flat,
        meterstickSegmentMeters: segmentMeters,
        meterstick: meterstickFromPoints(flat, segmentMeters),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, selectedVideo]
  );

  const handleMeterstickSegmentMetersUpdate = useCallback(
    (segmentMeters: number[]) => {
      if (!selectedId || !selectedVideo) return;
      const flat = horizontalizeMeterstickPoints(selectedVideo.meterstickPoints);
      const normalized = normalizeSegmentMeters(flat.length, segmentMeters);
      updateVideo(selectedId, {
        meterstickSegmentMeters: normalized,
        meterstick: meterstickFromPoints(flat, normalized),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, selectedVideo]
  );

  const handleMeterstickPaste = useCallback(
    (clip: MeterstickClipboard) => {
      if (!selectedId) return;
      const flat = horizontalizeMeterstickPoints(clip.points);
      const segmentMeters = normalizeSegmentMeters(flat.length, clip.segmentMeters);
      updateVideo(selectedId, {
        meterstickPoints: flat,
        meterstickSegmentMeters: segmentMeters,
        meterstick: meterstickFromPoints(flat, segmentMeters),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId]
  );

  const handleFrameChange = useCallback(
    (frame: number) => {
      if (!selectedId) return;
      updateVideo(selectedId, { currentFrame: frame });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId]
  );

  const handleLaunchParamsChange = useCallback(
    (trajectoryId: string, p: LaunchParams) => {
      if (!selectedId) return;
      setVideos((prev) =>
        prev.map((v) =>
          v.id === selectedId
            ? { ...v, trajectoryLaunchParams: { ...(v.trajectoryLaunchParams ?? {}), [trajectoryId]: p } }
            : v
        )
      );
    },
    [selectedId]
  );

  const handleLaunchParamsChangeForVideo = useCallback(
    (videoId: string, trajectoryId: string, p: LaunchParams) => {
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoId
            ? { ...v, trajectoryLaunchParams: { ...(v.trajectoryLaunchParams ?? {}), [trajectoryId]: p } }
            : v
        )
      );
    },
    []
  );

  const handleFramerateChange = useCallback(
    (framerate: number) => {
      if (!selectedId) return;
      updateVideo(selectedId, { framerate });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId]
  );

  const handleEmpiricalNumPointsChange = useCallback(
    (empiricalNumPoints: number) => {
      if (!selectedId) return;
      updateVideo(selectedId, { empiricalNumPoints });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId]
  );

  const handleToggleSimulation = useCallback(() => {
    if (!selectedId) return;
    setVideos((prev) =>
      prev.map((v) => (v.id === selectedId ? { ...v, showSimulation: !v.showSimulation } : v))
    );
  }, [selectedId]);

  function handleClearAll() {
    setTrajGroups([]);
    setTrajMoeById(new Map());
    setSelectedGroupId(null);
    setHoveredTrajId(null);
  }

  async function handleGenerate() {
    const drag = trajGenParams.dragCoefficient;
    const magnus = trajGenParams.magnusGain;
    const signal = { cancelled: false };
    setGenerating(true);
    setGenProgress(null);
    handleClearAll();
    const newGroups = await generateTrajectoriesAsync(
      trajGenParams,
      drag,
      magnus,
      (p) => setGenProgress(p),
      signal
    );
    if (!signal.cancelled) {
      setTrajGroups(newGroups);
      scheduleFullMoeBuild(newGroups);
      if (newGroups.length > 0) {
        setSelectedGroupId(newGroups[0].id);
      }
    }
    setGenerating(false);
    setGenProgress(null);
  }

  async function handleRefine() {
    const work = trajGroups.flatMap((g) =>
      g.trajectories.map((traj) => ({
        traj,
        targetDx: traj.generatedForDx ?? g.dx,
        targetDy: g.dy,
      }))
    );
    if (work.length === 0) return;
    const drag = trajGenParams.dragCoefficient;
    const magnus = trajGenParams.magnusGain;
    const signal = { cancelled: false };
    setRefining(true);
    setGenProgress(null);
    const newGroups = await refineTrajectoriesAsync(
      work,
      trajGenParams,
      drag,
      magnus,
      (p) => setGenProgress(p),
      signal
    );
    if (!signal.cancelled) {
      setTrajGroups(newGroups);
      scheduleFullMoeBuild(newGroups);
      if (newGroups.length > 0) {
        const keepGroup = selectedGroupId && newGroups.some((g) => g.id === selectedGroupId);
        if (!keepGroup) setSelectedGroupId(newGroups[0].id);
      } else {
        setSelectedGroupId(null);
      }
    }
    setRefining(false);
    setGenProgress(null);
  }

  function handleDeleteUnsuccessful() {
    setTrajGroups((prev) => {
      const removedIds: string[] = [];
      const next = prev
        .map((g) => {
          const kept = g.trajectories.filter((t) => !isUnsuccessfulTrajectory(t));
          for (const t of g.trajectories) {
            if (isUnsuccessfulTrajectory(t)) removedIds.push(t.id);
          }
          return { ...g, optimalLowArcTrajectoryIndex: undefined, optimalHighArcTrajectoryIndex: undefined, trajectories: kept };
        })
        .filter((g) => g.trajectories.length > 0);

      removeTrajMoeIds(removedIds);

      if (hoveredTrajId && !next.some((g) => g.trajectories.some((t) => t.id === hoveredTrajId))) {
        setHoveredTrajId(null);
      }
      if (selectedGroupId && !next.some((g) => g.id === selectedGroupId)) {
        setSelectedGroupId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  }

  function handleDeleteTraj(groupId: string, trajId: string) {
    setTrajGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const next = g.trajectories.filter(t => t.id !== trajId);
      if (hoveredTrajId === trajId) setHoveredTrajId(null);
      return { ...g, optimalLowArcTrajectoryIndex: undefined, optimalHighArcTrajectoryIndex: undefined, trajectories: next };
    }));
    removeTrajMoeIds([trajId]);
  }

  function handleDeleteGroup(groupId: string) {
    const removedIds = trajGroupsRef.current
      .find((g) => g.id === groupId)
      ?.trajectories.map((t) => t.id) ?? [];
    setTrajGroups(prev => {
      const next = prev.filter(g => g.id !== groupId);
      if (selectedGroupId === groupId) {
        setSelectedGroupId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
    removeTrajMoeIds(removedIds);
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-6 pt-3.5 pb-0">
        <div className="flex items-end justify-between">
          <h1 className="text-xl font-bold tracking-tight pb-3">
            <span style={{ color: '#4a7fd4' }}>Brain</span><span style={{ color: '#3cb54a' }}>S</span><span style={{ color: '#4a7fd4' }}>T</span><span style={{ color: '#e04020' }}>E</span><span style={{ color: '#e8b020' }}>M</span><span style={{ color: '#4a7fd4' }}> Shooting Simulator</span>
       
          </h1>
          {/* Tabs */}
          <div className="flex items-end gap-1">
            {(['trajgen', 'sysid'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-t border-l border-r ${
                  tab === t
                    ? 'bg-gray-950 border-gray-700 text-white'
                    : 'bg-gray-800/50 border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                {t === 'sysid' ? 'System Identification' : 'Trajectory Generation'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Body row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {tab === 'sysid' ? (
          <>
            {/* ── LEFT PANEL ── */}
            <div
              className={`flex-shrink-0 h-full overflow-hidden ${isDragging ? '' : 'transition-[width] duration-200'}`}
              style={{ width: leftOpen ? leftWidth : 0 }}
            >
              <SysIdSidebar
                videos={videos}
                selectedVideo={selectedVideo}
                selectedId={selectedId}
                onSelect={(id) => { setSelectedId(id); }}
                onUpload={requestUpload}
                onDelete={handleDelete}
                width={leftWidth}
                plottingMode={plottingMode}
                onPlottingModeChange={setPlottingMode}
                pointRadius={pointRadius}
                onPointRadiusChange={setPointRadius}
                showAllTrajectories={showAllTrajectories}
                onShowAllTrajectoriesChange={setShowAllTrajectories}
                showAverageTrajectory={showAverageTrajectory}
                onShowAverageTrajectoryChange={setShowAverageTrajectory}
                showTrajectoryPoints={showTrajectoryPoints}
                onShowTrajectoryPointsChange={setShowTrajectoryPoints}
                focusedTrajectoryId={focusedTrajectoryId}
                onFocusedTrajectoryChange={setFocusedTrajectoryId}
                onTrajectoryUpdate={(points) => { pushUndo(selectedVideo?.trajectory ?? []); handleTrajectoryUpdate(points); }}
                onFrameChange={handleFrameChange}
                framerate={selectedVideo?.framerate ?? 30}
                onFramerateChange={handleFramerateChange}
                totalFrames={totalFrames}
                videoDuration={videoDuration}
                empiricalNumPoints={selectedVideo?.empiricalNumPoints ?? 2}
                onEmpiricalNumPointsChange={handleEmpiricalNumPointsChange}
                meterstick={selectedVideo?.meterstick ?? { x: 80, y: 680, length: 160 }}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onDeleteCurrentPoint={handleDeleteCurrentPoint}
                onClearAllPoints={handleClearAllPoints}
                canDeleteCurrentPoint={canDeleteCurrentPoint}
                canSkipFrame={canSkipFrame}
                onSkipFrame={handleSkipFrame}
                onImportProject={handleImportProject}
                importProjectActionRef={importProjectActionRef}
                onLaunchParamsChangeForTrajectory={handleLaunchParamsChange}
                onAttachConfig={handleAttachConfig}
                onUpdateVideoXdir={handleUpdateVideoXdir}
              />
            </div>

            {/* Left edge */}
            <div className="flex-shrink-0 flex flex-col relative">
              {leftOpen && (
                <ResizeHandle
                  onMouseDown={(e) => {
                    e.preventDefault();
                    leftDragRef.current = { startX: e.clientX, startW: leftWidth }; setIsDragging(true);
                  }}
                />
              )}
              <button
                onClick={() => setLeftOpen((v) => !v)}
                title={leftOpen ? 'Hide sidebar' : 'Show sidebar'}
                className="absolute top-1/2 -translate-y-1/2 left-0 z-20 flex items-center justify-center w-5 h-10 bg-gray-800 hover:bg-gray-600 border border-gray-600 rounded-r-md text-gray-400 hover:text-white transition-colors"
              >
                {leftOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
              </button>
            </div>

            {/* ── CENTER ── */}
            <main className="flex flex-1 min-w-0 min-h-0">
              {selectedVideo ? (
                <VideoDisplay
                  key={selectedVideo.id}
                  video={selectedVideo}
                  onTrajectoryUpdate={handleTrajectoryUpdate}
                  onMeterstickPointsUpdate={handleMeterstickPointsUpdate}
                  onMeterstickSegmentMetersUpdate={handleMeterstickSegmentMetersUpdate}
                  onMeterstickPaste={handleMeterstickPaste}
                  meterstickScale={selectedMeterstickScale ?? MeterstickScale.fromVideo({
                    meterstick: { x: 80, y: 680, length: 160 },
                    meterstickPoints: defaultMeterstickPoints({ x: 80, y: 680, length: 160 }),
                    meterstickSegmentMeters: [1],
                  })}
                  meterstickClipboardRef={meterstickClipboardRef}
                  onFrameChange={handleFrameChange}
                  onTotalFramesChange={setTotalFrames}
                  onVideoDurationChange={setVideoDuration}
                  plottingMode={plottingMode}
                  pointRadius={pointRadius}
                  showAllTrajectories={showAllTrajectories}
                  showAverageTrajectory={showAverageTrajectory}
                  showTrajectoryPoints={showTrajectoryPoints}
                  focusedTrajectoryId={focusedTrajectoryId}
                  onPushUndo={pushUndo}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onDeleteCurrentPoint={handleDeleteCurrentPoint}
                  onSkipFrame={handleSkipFrame}
                  canSkipFrame={canSkipFrame}
                  onStepFrame={handleStepFrame}
                  onStartFrameHold={handleStartFrameHold}
                  onStopFrameHold={handleStopFrameHold}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-10">
                  <input
                    ref={centerUploadRef}
                    type="file"
                    accept="video/*,.mov,.mp4,.m4v,.avi,.3gp"
                    multiple
                    className="hidden"
                    onChange={(e) => { if (e.target.files?.length) { requestUpload(e.target.files); e.target.value = ''; } }}
                  />
                  <div className="flex flex-col items-center gap-3">
                    <button
                      type="button"
                      onClick={() => centerUploadRef.current?.click()}
                      className="w-16 h-16 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-300 transition-colors flex items-center justify-center"
                      title="Upload video"
                    >
                      <Upload size={32} strokeWidth={1.5} />
                    </button>
                    <p className="text-sm font-medium text-gray-500">Upload a video to get started</p>
                  </div>
                  <div className="flex flex-col items-center gap-3">
                    <button
                      type="button"
                      onClick={() => importProjectActionRef.current?.()}
                      className="w-16 h-16 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-300 transition-colors flex items-center justify-center"
                      title="Import project"
                    >
                      <FolderDown size={32} strokeWidth={1.5} />
                    </button>
                    <p className="text-sm font-medium text-gray-500">Or import a project</p>
                  </div>
                </div>
              )}
            </main>

            {/* Right edge */}
            <div className="flex-shrink-0 flex flex-col relative">
              <button
                onClick={() => setRightOpen((v) => !v)}
                title={rightOpen ? 'Hide panel' : 'Show panel'}
                className="absolute top-1/2 -translate-y-1/2 right-0 z-20 flex items-center justify-center w-5 h-10 bg-gray-800 hover:bg-gray-600 border border-gray-600 rounded-l-md text-gray-400 hover:text-white transition-colors"
              >
                {rightOpen ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
              </button>
              {rightOpen && (
                <ResizeHandle
                  onMouseDown={(e) => {
                    e.preventDefault();
                    rightDragRef.current = { startX: e.clientX, startW: rightWidth }; setIsDragging(true);
                  }}
                />
              )}
            </div>

            {/* ── RIGHT PANEL ── */}
            <div
              className={`flex-shrink-0 overflow-hidden ${isDragging ? '' : 'transition-[width] duration-200'}`}
              style={{ width: rightOpen ? rightWidth : 0 }}
            >
              {selectedVideo && (
                <SimulationControls
                  launchParams={getLaunchParams(selectedVideo.trajectoryLaunchParams, activeSegment?.id ?? null)}
                  activeTrajectoryId={activeSegment?.id ?? null}
                  activeTrajectoryName={activeSegment?.name ?? null}
                  showSimulation={selectedVideo.showSimulation}
                  trajectory={activeTrajectoryPoints}
                  allTrajectories={trajectorySegments.map((seg) => ({
                    id: seg.id,
                    videoId: selectedVideo.id,
                    points: seg.points,
                    launchParams: getLaunchParams(selectedVideo.trajectoryLaunchParams, seg.id),
                    pixelsPerMeter: scaleToPpmFn(MeterstickScale.fromVideo(selectedVideo)),
                    framerate: selectedVideo.framerate,
                    frameTimes: selectedVideo.frameTimes,
                    xdir: selectedVideo.xdir ?? 1,
                  }))}
                  xdir={selectedVideo.xdir ?? 1}
                  allVideosTrajectories={allVideosTrajectories}
                  meterstickScale={selectedMeterstickScale ?? MeterstickScale.fromVideo(selectedVideo)}
                  framerate={selectedVideo.framerate}
                  frameTimes={selectedVideo.frameTimes}
                  onLaunchParamsChange={(p) => {
                    if (activeSegment) handleLaunchParamsChange(activeSegment.id, p);
                  }}
                  onLaunchParamsChangeForTrajectory={handleLaunchParamsChange}
                  onLaunchParamsChangeForVideo={handleLaunchParamsChangeForVideo}
                  onToggleShow={handleToggleSimulation}
                  width={rightWidth}
                />
              )}
            </div>
          </>
        ) : (
          /* ── TRAJECTORY GENERATION TAB ── */
          <>
            {/* Left panel: controls */}
            <div
              className={`flex-shrink-0 overflow-hidden ${isDragging ? '' : 'transition-[width] duration-200'}`}
              style={{ width: leftOpen ? leftWidth : 0 }}
            >
              <TrajectoryGenLeft
                params={trajGenParams}
                onChange={setTrajGenParams}
                onGenerate={handleGenerate}
                onRefine={handleRefine}
                generating={generating}
                refining={refining}
                canRefine={trajGroups.some((g) => g.trajectories.length > 0)}
                genProgress={genProgress}
                width={leftWidth}
              />
            </div>

            {/* Left edge */}
            <div className="flex-shrink-0 flex flex-col relative">
              {leftOpen && (
                <ResizeHandle
                  onMouseDown={(e) => {
                    e.preventDefault();
                    leftDragRef.current = { startX: e.clientX, startW: leftWidth }; setIsDragging(true);
                  }}
                />
              )}
              <button
                onClick={() => setLeftOpen((v) => !v)}
                title={leftOpen ? 'Hide panel' : 'Show panel'}
                className="absolute top-1/2 -translate-y-1/2 left-0 z-20 flex items-center justify-center w-5 h-10 bg-gray-800 hover:bg-gray-600 border border-gray-600 rounded-r-md text-gray-400 hover:text-white transition-colors"
              >
                {leftOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
              </button>
            </div>

            {/* Center: visualizer / MOE analysis */}
            <TrajectoryGenCenter
              params={trajGenParams}
              groups={trajGroups}
              selectedGroupId={selectedGroup?.id ?? null}
              hoveredId={hoveredTrajId}
              showAll={showAllTrajGenTrajectories}
              onShowAllChange={handleShowAllTrajGenChange}
              showOptimalTrajectories={showOptimalTrajectoriesTrajGen}
              onShowOptimalTrajectoriesChange={handleShowOptimalTrajectoriesTrajGenChange}
              trajMoeById={trajMoeById}
              bestMoeTrajIds={bestMoeTrajIds}
              optimalLowArcTrajIds={visibleOptimalTrajPaths.lowArcIds}
              optimalHighArcTrajIds={visibleOptimalTrajPaths.highArcIds}
              onHoverTraj={setHoveredTrajId}
              onParamsChange={setTrajGenParams}
              onSaveOptimalTrajectories={handleSaveOptimalTrajectories}
              onSetManualOptimalTrajectory={handleSetManualOptimalTrajectory}
            />

            {/* Right edge */}
            <div className="flex-shrink-0 flex flex-col relative">
              <button
                onClick={() => setRightOpen((v) => !v)}
                title={rightOpen ? 'Hide panel' : 'Show panel'}
                className="absolute top-1/2 -translate-y-1/2 right-0 z-20 flex items-center justify-center w-5 h-10 bg-gray-800 hover:bg-gray-600 border border-gray-600 rounded-l-md text-gray-400 hover:text-white transition-colors"
              >
                {rightOpen ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
              </button>
              {rightOpen && (
                <ResizeHandle
                  onMouseDown={(e) => {
                    e.preventDefault();
                    rightDragRef.current = { startX: e.clientX, startW: rightWidth }; setIsDragging(true);
                  }}
                />
              )}
            </div>

            {/* Right panel: trajectory list */}
            <div
              className={`flex-shrink-0 overflow-hidden ${isDragging ? '' : 'transition-[width] duration-200'}`}
              style={{ width: rightOpen ? rightWidth : 0 }}
            >
              <TrajectoryGenRight
                groups={trajGroups}
                selectedGroupId={selectedGroup?.id ?? null}
                hoveredTrajId={hoveredTrajId}
                trajMoeById={trajMoeById}
                bestMoeTrajIds={bestMoeTrajIds}
                onSelectGroup={setSelectedGroupId}
                onHoverTraj={setHoveredTrajId}
                onDeleteTraj={handleDeleteTraj}
                onDeleteGroup={handleDeleteGroup}
                onUpdateGroup={(groupId, trajs) => {
                  patchTrajMoeForGroup(groupId, trajs);
                  setTrajGroups(prev => prev.map(g => g.id === groupId ? { ...g, trajectories: trajs } : g));
                }}
                onImportGroups={(newGroups, mode) => {
                  if (mode === 'replace') {
                    setTrajGroups(newGroups);
                    scheduleFullMoeBuild(newGroups);
                    setSelectedGroupId(newGroups[0]?.id ?? null);
                    setHoveredTrajId(null);
                  } else {
                    const merged = [...trajGroupsRef.current, ...newGroups];
                    setTrajGroups(merged);
                    scheduleFullMoeBuild(merged);
                    setSelectedGroupId((id) => id ?? newGroups[0]?.id ?? null);
                  }
                }}
                onClearAll={handleClearAll}
                onDeleteUnsuccessful={handleDeleteUnsuccessful}
                params={trajGenParams}
                onParamsChange={setTrajGenParams}
                onRecalculateMoe={handleRecalculateMoe}
                moeRecalculating={moeRecalculating}
                moeRecalcProgress={moeRecalcProgress}
                width={rightWidth}
              />
            </div>
          </>
        )}
      </div>

      {pendingUploadFiles && tab === 'sysid' && (
        <XdirUploadDialog
          mode="upload"
          fileCount={pendingUploadFiles.length}
          onSubmit={confirmUpload}
          onCancel={cancelPendingUpload}
        />
      )}
    </div>
  );
}
