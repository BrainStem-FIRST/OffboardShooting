import { useRef, useState, useEffect, useMemo } from 'react';
import {
  Upload, Film, Trash2, Crosshair, RotateCcw, Save, Trash, SkipForward, FolderDown, Download,
} from 'lucide-react';
import { ImportFolderButton } from './ImportFolderButton';
import { CheckboxLabel } from './Checkbox';
import { VideoData, TrajectoryPoint, Meterstick, LaunchParams } from '../types';
import VideoOptionsDialog from './VideoOptionsDialog';
import XdirUploadDialog from './XdirUploadDialog';
import type { LoadedConfiguration } from '../utils/trajectorySegments';
import { empiricalFromPoints, gravityCorrectionQuality, type PixelsPerMeterSource } from '../simulation';
import { MeterstickScale, scaleToPpmFn } from '../utils/meterstickScale';
import {
  buildTrajectorySegments,
  activeSegmentAtFrame,
  getLaunchParams,
  countPlottedPoints,
} from '../utils/trajectorySegments';
import { downloadFrameTimingDebug, estimateFpsFromFrameCount } from '../utils/frameTiming';
import { downloadExitEstimatesTxt } from '../utils/exitEstimateExport';
import {
  configFileNameForVideo,
  exitVelocityFromVideoName,
  downloadConfigFiles,
  saveConfigsToDirectoryFlat,
  buildImportPreview,
  formatImportFailureMessage,
  scanImportFileNames,
  listProjectFileNames,
  loadProjectFromDir,
} from '../utils/projectIO';
import type { ImportedProjectEntry } from '../utils/projectIO';
import {
  panelAside, panelTab, panelSectionTitle, panelSubsectionTitle, panelItemTitle, panelBody,
  panelHint, panelMeta, panelInput, panelInputNumeric, panelBtn, panelBtnPrimary, panelListItem,
  panelEmpty, panelMono,
} from './panelStyles';

type SidebarTab = 'uploadSave' | 'annotation';

function FramerateInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);

  function commit(str: string) {
    const stripped = str.replace(/[^0-9.\-]/g, '');
    let n = parseFloat(stripped);
    if (isNaN(n) || n <= 0) n = value > 0 ? value : 30;
    setRaw(String(n));
    onChange(n);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { setFocused(false); commit(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={panelInput}
    />
  );
}

const POINT_RADIUS_MIN = 2;
const POINT_RADIUS_MAX = 15;

function PointRadiusSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5" title="Radius of plotted trajectory points on the video (current frame is 1.3× larger).">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm text-gray-400 whitespace-nowrap flex-shrink-0">Point radius</label>
        <span className={`${panelMeta} ${panelMono} tabular-nums`}>{value} px</span>
      </div>
      <input
        type="range"
        min={POINT_RADIUS_MIN}
        max={POINT_RADIUS_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full h-1.5 accent-blue-500 cursor-pointer"
      />
    </div>
  );
}

function NumPointsInput({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const min = 2;
  const sliderMax = Math.max(min, max);

  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);

  function commit(str: string) {
    const stripped = str.replace(/[^0-9]/g, '');
    let n = parseInt(stripped, 10);
    if (isNaN(n)) n = min;
    n = Math.max(min, n);
    setRaw(String(n));
    onChange(n);
  }

  return (
    <div className="space-y-1.5" title="Number of plotted points to use when estimating exit velocity and exit angle.">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm text-gray-400 whitespace-nowrap flex-shrink-0">Num points to use</label>
        <input
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={(e) => { setFocused(false); commit(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className={panelInputNumeric}
        />
      </div>
      <input
        type="range"
        min={min}
        max={sliderMax}
        step={1}
        value={Math.min(value, sliderMax)}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full h-1.5 accent-blue-500 cursor-pointer"
      />
    </div>
  );
}

interface Props {
  videos: VideoData[];
  selectedVideo: VideoData | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpload: (files: FileList) => void;
  onDelete: (id: string) => void;
  width: number;
  plottingMode: boolean;
  onPlottingModeChange: (v: boolean) => void;
  pointRadius: number;
  onPointRadiusChange: (v: number) => void;
  showAllTrajectories: boolean;
  onShowAllTrajectoriesChange: (v: boolean) => void;
  showAverageTrajectory: boolean;
  onShowAverageTrajectoryChange: (v: boolean) => void;
  showTrajectoryPoints: boolean;
  onShowTrajectoryPointsChange: (v: boolean) => void;
  focusedTrajectoryId: string | null;
  onFocusedTrajectoryChange: (id: string | null) => void;
  onTrajectoryUpdate: (points: TrajectoryPoint[]) => void;
  onFrameChange: (frame: number) => void;
  framerate: number;
  onFramerateChange: (fps: number) => void;
  totalFrames: number;
  videoDuration: number;
  empiricalNumPoints: number;
  onEmpiricalNumPointsChange: (n: number) => void;
  meterstick: Meterstick;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteCurrentPoint: () => void;
  onClearAllPoints: () => void;
  canDeleteCurrentPoint: boolean;
  canSkipFrame: boolean;
  onSkipFrame: () => void;
  onImportProject: (entries: ImportedProjectEntry[]) => void | Promise<void>;
  importProjectActionRef?: React.MutableRefObject<(() => void) | null>;
  onLaunchParamsChangeForTrajectory: (trajectoryId: string, p: LaunchParams) => void;
  onAttachConfig: (videoId: string, config: LoadedConfiguration) => void;
  onUpdateVideoXdir: (videoId: string, xdir: 1 | -1) => void;
}

export default function SysIdSidebar({
  videos,
  selectedVideo,
  selectedId,
  onSelect,
  onUpload,
  onDelete,
  width,
  plottingMode,
  onPlottingModeChange,
  pointRadius,
  onPointRadiusChange,
  showAllTrajectories,
  onShowAllTrajectoriesChange,
  showAverageTrajectory,
  onShowAverageTrajectoryChange,
  showTrajectoryPoints,
  onShowTrajectoryPointsChange,
  focusedTrajectoryId,
  onFocusedTrajectoryChange,
  onTrajectoryUpdate,
  onFrameChange,
  framerate,
  onFramerateChange,
  totalFrames,
  videoDuration,
  empiricalNumPoints,
  onEmpiricalNumPointsChange,
  meterstick,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDeleteCurrentPoint,
  onClearAllPoints,
  canDeleteCurrentPoint,
  canSkipFrame,
  onSkipFrame,
  onImportProject,
  importProjectActionRef,
  onLaunchParamsChangeForTrajectory,
  onAttachConfig,
  onUpdateVideoXdir,
}: Props) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('uploadSave');
  const [videoDialogId, setVideoDialogId] = useState<string | null>(null);
  const [editSettingsVideoId, setEditSettingsVideoId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const saveBusyRef = useRef(false);
  const saveProjectBusyRef = useRef(false);
  const importBusyRef = useRef(false);
  const projectDirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [importing, setImporting] = useState(false);
  const [projectStatus, setProjectStatus] = useState<{ ok: boolean | null; text: string } | null>(null);

  const segments = selectedVideo ? buildTrajectorySegments(selectedVideo.trajectory) : [];
  const segmentAtCurrent = selectedVideo
    ? activeSegmentAtFrame(segments, selectedVideo.currentFrame)
    : null;
  const focusedSegment =
    segments.find((s) => s.id === focusedTrajectoryId) ?? segmentAtCurrent ?? null;
  const editingSegment = segmentAtCurrent ?? focusedSegment;

  const segmentStats = useMemo(() => {
    const ppmSource: PixelsPerMeterSource = selectedVideo
      ? scaleToPpmFn(MeterstickScale.fromVideo(selectedVideo))
      : meterstick.length;
    const stored = selectedVideo?.trajectoryLaunchParams;
    return segments.map((seg) => {
      const actual = getLaunchParams(stored, seg.id);
      return {
        ...seg,
        ...empiricalFromPoints(
          seg.points,
          ppmSource,
          framerate,
          empiricalNumPoints,
          selectedVideo?.xdir ?? 1,
          selectedVideo?.frameTimes
        ),
        actualSpeed: actual.exitVelocity,
        actualAngle: actual.exitAngle,
      };
    });
  }, [segments, selectedVideo, meterstick.length, framerate, empiricalNumPoints, selectedVideo?.trajectoryLaunchParams, selectedVideo?.xdir, selectedVideo?.frameTimes]);

  const numPointsSliderMax = useMemo(() => {
    const longest = segments.reduce((m, s) => Math.max(m, countPlottedPoints(s.points)), 0);
    return Math.max(longest, empiricalNumPoints, 10);
  }, [segments, empiricalNumPoints]);

  const grayLineQuality = useMemo(() => {
    if (!editingSegment) return { r2: null, avgRadiusOfCurvature: null };
    const ppmSource: PixelsPerMeterSource = selectedVideo
      ? scaleToPpmFn(MeterstickScale.fromVideo(selectedVideo))
      : meterstick.length;
    return gravityCorrectionQuality(
      editingSegment.points,
      ppmSource,
      framerate,
      empiricalNumPoints,
      selectedVideo?.frameTimes
    );
  }, [editingSegment, selectedVideo, meterstick.length, framerate, empiricalNumPoints, selectedVideo?.frameTimes]);

  function formatRadius(r: number | null): string {
    if (r === null) return '—';
    if (r > 999) return '>999 m';
    if (r > 100) return `${r.toFixed(0)} m`;
    return `${r.toFixed(1)} m`;
  }

  function sampleStdDev(values: number[]): number | null {
    if (values.length < 2) return null;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  const averages = useMemo(() => {
    const withEstSpeed = segmentStats.filter((s) => s.speed !== null);
    const withEstAngle = segmentStats.filter((s) => s.angle !== null);
    const estSpeeds = withEstSpeed.map((s) => s.speed!);
    const estAngles = withEstAngle.map((s) => s.angle!);
    const actualSpeeds = segmentStats.map((s) => s.actualSpeed);
    const actualAngles = segmentStats.map((s) => s.actualAngle);
    return {
      estimateSpeed: estSpeeds.length > 0
        ? estSpeeds.reduce((sum, v) => sum + v, 0) / estSpeeds.length
        : null,
      estimateAngle: estAngles.length > 0
        ? estAngles.reduce((sum, v) => sum + v, 0) / estAngles.length
        : null,
      actualSpeed: actualSpeeds.length > 0
        ? actualSpeeds.reduce((sum, v) => sum + v, 0) / actualSpeeds.length
        : null,
      actualAngle: actualAngles.length > 0
        ? actualAngles.reduce((sum, v) => sum + v, 0) / actualAngles.length
        : null,
      estimateSpeedStd: sampleStdDev(estSpeeds),
      estimateAngleStd: sampleStdDev(estAngles),
      actualSpeedStd: sampleStdDev(actualSpeeds),
      actualAngleStd: sampleStdDev(actualAngles),
      count: segmentStats.length,
    };
  }, [segmentStats]);

  const dt = framerate > 0 ? 1 / framerate : null;
  const estimatedFps = estimateFpsFromFrameCount(totalFrames, videoDuration);

  function applyVelEstimate(trajectoryId: string, speed: number) {
    if (!selectedVideo) return;
    const current = getLaunchParams(selectedVideo.trajectoryLaunchParams, trajectoryId);
    onLaunchParamsChangeForTrajectory(trajectoryId, { ...current, exitVelocity: speed });
  }

  function applyAngleEstimate(trajectoryId: string, angle: number) {
    if (!selectedVideo) return;
    const current = getLaunchParams(selectedVideo.trajectoryLaunchParams, trajectoryId);
    onLaunchParamsChangeForTrajectory(trajectoryId, { ...current, exitAngle: angle });
  }

  function applyAllVelEstimates() {
    if (!selectedVideo) return;
    for (const seg of segmentStats) {
      if (seg.speed !== null) {
        applyVelEstimate(seg.id, seg.speed + 0.5);
      }
    }
  }

  function applyAllAngleEstimates() {
    if (!selectedVideo) return;
    for (const seg of segmentStats) {
      if (seg.angle !== null) {
        applyAngleEstimate(seg.id, seg.angle);
      }
    }
  }

  const canApplyAllVelEstimates = segmentStats.some((s) => s.speed !== null);
  const canApplyAllAngleEstimates = segmentStats.some((s) => s.angle !== null);
  const canExportEstimates = selectedVideo !== null && segmentStats.length > 0;

  function handleExportEstimates() {
    if (!selectedVideo || segmentStats.length === 0) return;
    downloadExitEstimatesTxt(
      selectedVideo.name,
      framerate,
      empiricalNumPoints,
      segmentStats.map((seg) => ({
        name: seg.name,
        speed: seg.speed,
        angle: seg.angle,
      }))
    );
  }

  function handleUploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
      e.target.value = '';
    }
  }

  function handleSaveConfigsClick() {
    if (saveBusyRef.current || saveProjectBusyRef.current || importBusyRef.current) return;
    if (videos.length === 0) return;

    saveBusyRef.current = true;
    setSaving(true);
    setProjectStatus(null);
    try {
      const { count } = downloadConfigFiles(videos);
      setProjectStatus({
        ok: true,
        text: `Downloaded ${count} config file(s). Place them in your project folder next to the videos.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus({ ok: false, text: `Could not save configs: ${msg}` });
    } finally {
      saveBusyRef.current = false;
      setSaving(false);
    }
  }

  function handleSaveProjectClick() {
    if (saveProjectBusyRef.current || saveBusyRef.current || importBusyRef.current) return;
    if (videos.length === 0) return;

    if (!projectDirHandleRef.current) {
      setProjectStatus({
        ok: false,
        text: 'Import a project folder first — Save Project writes to the folder you imported from.',
      });
      return;
    }

    saveProjectBusyRef.current = true;
    setSavingProject(true);
    setProjectStatus(null);

    void (async () => {
      try {
        const handle = projectDirHandleRef.current!;
        let perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await handle.requestPermission({ mode: 'readwrite' });
        }
        if (perm !== 'granted') {
          setProjectStatus({ ok: false, text: 'Write permission denied for the imported project folder.' });
          return;
        }

        const result = await saveConfigsToDirectoryFlat(handle, videos, (current, total) => {
          setProjectStatus({ ok: null, text: `Saving project ${current}/${total}…` });
        });
        if (!result.ok) {
          if (!result.cancelled) setProjectStatus({ ok: false, text: result.message });
          return;
        }
        setProjectStatus({
          ok: true,
          text: `Saved ${result.count} config(s) to imported project folder (replaced existing).`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setProjectStatus({ ok: false, text: `Could not save project: ${msg}` });
      } finally {
        saveProjectBusyRef.current = false;
        setSavingProject(false);
      }
    })();
  }

  function handleImportProjectFolder(dir: FileSystemDirectoryHandle) {
    return (async () => {
      projectDirHandleRef.current = dir;

      setProjectStatus({ ok: null, text: 'Scanning folder…' });
      const fileNames = await listProjectFileNames(dir);
      const preview = buildImportPreview(fileNames);
      if (preview.pairs.length === 0) {
        projectDirHandleRef.current = null;
        setProjectStatus({
          ok: false,
          text: formatImportFailureMessage(scanImportFileNames(fileNames)),
        });
        return;
      }

      setProjectStatus({ ok: null, text: 'Loading project files…' });
      const loadResult = await loadProjectFromDir(dir);
      if (!loadResult.ok) {
        projectDirHandleRef.current = null;
        setProjectStatus({ ok: false, text: loadResult.message });
        return;
      }

      onImportProject(loadResult.entries);
      let text = `Imported ${loadResult.entries.length} video(s). Save Project will update this folder.`;
      if (loadResult.warnings.length > 0) {
        text += ` ${loadResult.warnings.join(' ')}`;
      }
      setProjectStatus({ ok: true, text });
    })();
  }

  function videoRowStats(v: VideoData) {
    const segs = buildTrajectorySegments(v.trajectory);
    const trajCount = segs.length;
    const pointCount = segs.reduce((sum, s) => sum + countPlottedPoints(s.points), 0);
    return { trajCount, pointCount };
  }

  const videosSortedByExitVelocity = useMemo(() => {
    return [...videos].sort((a, b) => {
      const va = exitVelocityFromVideoName(a.name);
      const vb = exitVelocityFromVideoName(b.name);
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va !== vb) return va - vb;
      return a.name.localeCompare(b.name);
    });
  }, [videos]);

  const tabs: { id: SidebarTab; label: string }[] = [
    { id: 'uploadSave', label: 'Upload/Save' },
    { id: 'annotation', label: 'Traj Labeling' },
  ];

  const videoDialogVideo = videoDialogId ? videos.find((v) => v.id === videoDialogId) ?? null : null;
  const editSettingsVideo = editSettingsVideoId ? videos.find((v) => v.id === editSettingsVideoId) ?? null : null;

  function handleVideoRowClick(id: string) {
    onSelect(id);
  }

  function handleVideoRowContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault();
    onSelect(id);
    setVideoDialogId(id);
  }

  return (
    <aside className={`${panelAside} border-r border-gray-700 flex flex-col`} style={{ width }}>
      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={panelTab(activeTab === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
      {/* ── Upload/Save ── */}
      {activeTab === 'uploadSave' && (
        <>
          <div className="flex-shrink-0 p-4 border-b border-gray-700">
            <h2 className={`${panelSectionTitle} mb-3`}>Videos</h2>
            <button
              onClick={() => uploadInputRef.current?.click()}
              className={`w-full ${panelBtnPrimary} bg-blue-600 hover:bg-blue-500 text-white`}
            >
              <Upload size={16} />
              Upload Video
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept="video/*,.mov,.mp4,.m4v,.avi,.3gp"
              multiple
              className="hidden"
              onChange={handleUploadFiles}
            />
          </div>

          <div className="flex-1 min-h-[8rem] overflow-y-auto p-3 space-y-1.5">
            {videos.length === 0 && (
              <p className={`${panelEmpty} mt-8 px-2`}>
                No videos yet. Upload an iPhone video to get started.
              </p>
            )}
            {videosSortedByExitVelocity.map((v) => {
              const { trajCount, pointCount } = videoRowStats(v);
              const configName = configFileNameForVideo(v.name);
              return (
                <div
                  key={v.id}
                  onClick={() => handleVideoRowClick(v.id)}
                  onContextMenu={(e) => handleVideoRowContextMenu(e, v.id)}
                  className={`group flex items-start gap-2.5 ${panelListItem} cursor-pointer ${
                    v.id === selectedId
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <Film size={16} className="flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{v.name}</div>
                    <div className={`text-xs truncate mt-0.5 ${v.id === selectedId ? 'text-blue-100' : panelMeta}`}>
                      {configName}
                    </div>
                    <div className={`text-xs mt-1 ${v.id === selectedId ? 'text-blue-200' : 'text-gray-500'}`}>
                      {pointCount === 0
                        ? 'No points'
                        : `${trajCount} trajectory${trajCount !== 1 ? 'ies' : ''} · ${pointCount} point${pointCount !== 1 ? 's' : ''}`}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(v.id); }}
                    className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 mt-0.5 ${
                      v.id === selectedId ? 'hover:bg-blue-400' : 'hover:bg-gray-700'
                    }`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex-shrink-0 max-h-48 min-h-0 overflow-y-auto border-t border-gray-700 p-3 space-y-1.5">
            <button
              type="button"
              onClick={handleSaveConfigsClick}
              disabled={videos.length === 0 || saving || savingProject || importing}
              className={`w-full ${panelBtnPrimary} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed py-1.5 text-sm`}
            >
              <Save size={14} />
              {saving ? 'Saving…' : 'Save Configs'}
            </button>
            <button
              type="button"
              onClick={handleSaveProjectClick}
              disabled={videos.length === 0 || saving || savingProject || importing}
              className={`w-full ${panelBtnPrimary} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed py-1.5 text-sm`}
            >
              <Save size={14} />
              {savingProject ? 'Saving…' : 'Save Project'}
            </button>
            <ImportFolderButton
              label="Import Project"
              icon={FolderDown}
              disabled={saving || savingProject}
              busyRef={importBusyRef}
              onImportingChange={setImporting}
              actionRef={importProjectActionRef}
              unsupportedMessage="Import Project requires Chrome or Edge. Your browser does not support folder selection."
              onBeforeImport={() => {
                if (saveBusyRef.current || saveProjectBusyRef.current) {
                  setProjectStatus({ ok: null, text: 'Import already in progress.' });
                  return false;
                }
                setProjectStatus(null);
                return true;
              }}
              onBusy={() => setProjectStatus({ ok: null, text: 'Import already in progress.' })}
              onCancel={() => setProjectStatus({ ok: null, text: 'Import cancelled.' })}
              onError={(text) => {
                projectDirHandleRef.current = null;
                setProjectStatus({ ok: false, text });
              }}
              onFolderSelected={handleImportProjectFolder}
            />
            <div className={`${panelMeta} text-[11px] leading-snug space-y-1.5`}>
              <p>
                Import Project selects your project folder. Save Project then overwrites configs in that same folder.
              </p>
              <pre className={`${panelMono} text-gray-500 whitespace-pre-wrap text-[10px] leading-tight`}>{`MyProject/
  shot1.mp4
  shot1_configuration.json
  shot2.mov
  shot2_configuration.json`}</pre>
              <p>Each video pairs with <span className={panelMono}>{'{name}_configuration.json'}</span>.</p>
            </div>
            {projectStatus && (
              <p
                className={`text-xs leading-snug ${
                  projectStatus.ok === true
                    ? 'text-green-400'
                    : projectStatus.ok === false
                      ? 'text-red-400'
                      : 'text-gray-400'
                }`}
              >
                {projectStatus.text}
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Trajectory Annotation ── */}
      {activeTab === 'annotation' && (
        <>
        <div className="flex-1 min-h-0 overflow-y-auto [direction:rtl]">
        <div className="[direction:ltr]">
          {!selectedVideo ? (
            <p className={`${panelEmpty} mt-8 px-4 pb-8`}>
              Select a video from the Upload/Save tab to annotate trajectories.
            </p>
          ) : (
            <>
              {/* Section 1: video info & instructions */}
              <div className="flex-shrink-0 p-4 border-b border-gray-700 space-y-2">
                <h2 className={`${panelItemTitle} truncate`} title={selectedVideo.name}>
                  {selectedVideo.name}
                </h2>

                <p className="text-sm text-gray-400">
                  Currently editing{' '}
                  {editingSegment ? (
                    <span style={{ color: editingSegment.color }} className="font-semibold">
                      {editingSegment.name}
                    </span>
                  ) : (
                    <span className="text-gray-500 italic">new trajectory</span>
                  )}
                </p>

                <p className={panelBody}>
                  Click on video to plot points. Arrow keys to step frames. WASD to nudge the current point by 1 cm. Delete key to remove current point. Ctrl + Z / Ctrl + Y to undo/redo. Drag the yellow meterstick on the video to calibrate scale (each pair of points = 1 m). Right-click the line to add points; right-click a point to delete. Ctrl + C / Ctrl + V copies the meterstick to another video.
                </p>
              </div>

              {/* Section 2: exit velocity/angle calculations */}
              <div className="flex-shrink-0 p-4 border-b border-gray-700 space-y-2">
                <h3 className={panelSubsectionTitle}>Exit velocity / angle</h3>
                <p className={panelBody}>
                  Set framerate and calibrate the horizontal meterstick on the video. Each consecutive pair of points spans 1 m; scale is interpolated by x for perspective. Exit speed and angle use gravity-corrected points (gray dots).
                </p>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-400 whitespace-nowrap flex-shrink-0">Framerate (fps)</label>
                  <div className="flex-1 min-w-0">
                    <FramerateInput value={framerate} onChange={onFramerateChange} />
                  </div>
                </div>
                {estimatedFps !== null && (
                  <p className={`${panelMeta} ${panelMono}`} title={`${totalFrames} frames / ${videoDuration.toFixed(3)} s`}>
                    Estimated FPS: {estimatedFps.toFixed(2)}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => selectedVideo && downloadFrameTimingDebug(selectedVideo, 0)}
                  disabled={!selectedVideo?.frameTimes?.length}
                  className={`${panelBtn} w-full text-xs disabled:opacity-40 disabled:cursor-not-allowed`}
                  title="Download frame PTS/DTS timing table (debug)"
                >
                  Debug timing
                </button>
                {dt !== null && (
                  <p className={`${panelMeta} ${panelMono}`}>dt = {dt.toFixed(6)} s</p>
                )}
                <NumPointsInput
                  value={empiricalNumPoints}
                  onChange={onEmpiricalNumPointsChange}
                  max={numPointsSliderMax}
                />
                {editingSegment && (
                  <div className="pt-1 space-y-1">
                    <p className={panelMeta}>
                      Gravity offsetted points quality
                    </p>
                    <div className={`flex items-baseline gap-4 ${panelMono} text-sm text-gray-300`}>
                      <div title="Linear fit R² for gravity-corrected points. 1 = perfectly straight.">
                        <span className={panelMeta}>R² </span>
                        <span className="font-semibold text-white">
                          {grayLineQuality.r2 !== null ? grayLineQuality.r2.toFixed(4) : '—'}
                        </span>
                      </div>
                      <div title="Average radius of curvature across consecutive gray-point triplets. Larger = straighter; very large means near-linear.">
                        <span className={panelMeta}>Avg radius </span>
                        <span className="font-semibold text-white">
                          {formatRadius(grayLineQuality.avgRadiusOfCurvature)}
                        </span>
                      </div>
                    </div>
                    {empiricalNumPoints < 3 && (
                      <p className={panelHint}>Avg radius requires at least 3 points.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Section 3: video annotation controls */}
              <div className="flex-shrink-0 p-4 border-b border-gray-700 space-y-3">
                <h3 className={panelSubsectionTitle}>Video annotation</h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" className={panelBtn}>
                    Undo
                  </button>
                  <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)" className={panelBtn}>
                    Redo
                  </button>
                  <button
                    onClick={onDeleteCurrentPoint}
                    disabled={!canDeleteCurrentPoint}
                    title="Delete current (Delete)"
                    className={`${panelBtn} bg-red-950/50 text-red-300 hover:bg-red-900/60 hover:text-red-200 border border-red-900/40`}
                  >
                    <Trash size={14} />
                    Delete current
                  </button>
                  <button
                    onClick={onClearAllPoints}
                    className={`${panelBtn} bg-red-950/50 text-red-300 hover:bg-red-900/60 hover:text-red-200 border border-red-900/40`}
                  >
                    <RotateCcw size={14} />
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onPlottingModeChange(!plottingMode)}
                    className={`${panelBtn} ${
                      plottingMode
                        ? 'bg-green-700 text-white hover:bg-green-600'
                        : 'bg-green-600 text-white hover:bg-green-500'
                    }`}
                  >
                    <Crosshair size={14} />
                    {plottingMode ? 'Stop Plotting' : 'Plot Ball'}
                  </button>
                  <button
                    onClick={onSkipFrame}
                    disabled={!canSkipFrame}
                    title="Label current frame as skipped (ball off-screen) and advance (R)"
                    className={`${panelBtn} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed`}
                  >
                    <SkipForward size={14} />
                    Skip frame
                  </button>
                </div>

                <PointRadiusSlider value={pointRadius} onChange={onPointRadiusChange} />

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <CheckboxLabel
                    checked={showAllTrajectories}
                    onChange={onShowAllTrajectoriesChange}
                    label="Show all"
                  />
                  <CheckboxLabel
                    checked={showAverageTrajectory}
                    disabled={segments.length < 2}
                    onChange={onShowAverageTrajectoryChange}
                    label="Show average"
                    wrapperClassName={segments.length < 2 ? 'opacity-40' : ''}
                    title={
                      segments.length < 2
                        ? 'Plot at least 2 trajectories to show the average'
                        : undefined
                    }
                  />
                  <CheckboxLabel
                    checked={showTrajectoryPoints}
                    onChange={onShowTrajectoryPointsChange}
                    label="Show points"
                  />
                </div>
              </div>

              {/* Trajectory list */}
              <div className="border-t border-gray-700">
                <h3 className={`px-4 py-2.5 ${panelSectionTitle}`}>
                  Trajectories ({segments.length})
                </h3>
                {segments.length > 0 && (
                  <div className="px-3 pb-2 flex gap-1.5">
                    <button
                      type="button"
                      disabled={!canApplyAllVelEstimates}
                      onClick={applyAllVelEstimates}
                      className={`flex-1 ${panelBtn} text-[11px] py-1 px-1.5 disabled:opacity-30 disabled:cursor-not-allowed`}
                    >
                      Use vel estimate
                    </button>
                    <button
                      type="button"
                      disabled={!canApplyAllAngleEstimates}
                      onClick={applyAllAngleEstimates}
                      className={`flex-1 ${panelBtn} text-[11px] py-1 px-1.5 disabled:opacity-30 disabled:cursor-not-allowed`}
                    >
                      Use angle estimate
                    </button>
                  </div>
                )}
                <div className="px-3 pb-3 space-y-1.5">
                  {segments.length === 0 && (
                    <p className={`${panelEmpty} py-4`}>No trajectories plotted yet</p>
                  )}
                  {segmentStats.map((seg) => {
                    const isActive =
                      seg.id === editingSegment?.id ||
                      (focusedTrajectoryId === seg.id && !segmentAtCurrent);
                    return (
                      <div
                        key={seg.id}
                        className={`${panelListItem} ${
                          isActive ? 'bg-gray-800 ring-1 ring-gray-600' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onFocusedTrajectoryChange(seg.id);
                            onFrameChange(seg.frameStart);
                          }}
                          className="w-full text-left hover:opacity-90"
                        >
                          <div className="font-semibold" style={{ color: seg.color }}>
                            {seg.name}
                          </div>
                          <div className={`text-sm text-gray-300 mt-1 ${panelMono}`}>
                            <span className={panelMeta}>Estimate: </span>
                            {seg.speed !== null ? `${seg.speed.toFixed(2)} m/s` : '— m/s'}
                            {' · '}
                            {seg.angle !== null ? `${seg.angle.toFixed(1)}°` : '—°'}
                          </div>
                          <div className={`text-sm text-gray-300 mt-0.5 ${panelMono}`}>
                            <span className={panelMeta}>Actual: </span>
                            {seg.actualSpeed.toFixed(2)} m/s
                            {' · '}
                            {seg.actualAngle.toFixed(1)}°
                          </div>
                        </button>
                        <div className="flex gap-1.5 mt-2">
                          <button
                            type="button"
                            disabled={seg.speed === null}
                            onClick={() => seg.speed !== null && applyVelEstimate(seg.id, seg.speed)}
                            className={`flex-1 ${panelBtn} text-[11px] py-1 px-1.5 disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            Use vel estimate
                          </button>
                          <button
                            type="button"
                            disabled={seg.angle === null}
                            onClick={() => seg.angle !== null && applyAngleEstimate(seg.id, seg.angle)}
                            className={`flex-1 ${panelBtn} text-[11px] py-1 px-1.5 disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            Use angle estimate
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {averages.count > 0 && (
                  <div className="px-4 py-3 border-t border-gray-700 bg-gray-800/40 space-y-2">
                    <p className={panelSectionTitle}>
                      Averages ({averages.count} trajectory{averages.count !== 1 ? 'ies' : ''})
                    </p>
                    <div className={`text-sm text-gray-300 ${panelMono}`}>
                      <span className={panelMeta}>Estimate: </span>
                      {averages.estimateSpeed !== null ? `${averages.estimateSpeed.toFixed(2)} m/s` : '— m/s'}
                      {' · '}
                      {averages.estimateAngle !== null ? `${averages.estimateAngle.toFixed(1)}°` : '—°'}
                    </div>
                    <div className={`text-sm text-gray-300 ${panelMono}`}>
                      <span className={panelMeta}>Actual: </span>
                      {averages.actualSpeed !== null ? `${averages.actualSpeed.toFixed(2)} m/s` : '— m/s'}
                      {' · '}
                      {averages.actualAngle !== null ? `${averages.actualAngle.toFixed(1)}°` : '—°'}
                    </div>
                    <p className={`${panelSectionTitle} pt-1`}>Std. dev.</p>
                    <div className={`text-sm text-gray-300 ${panelMono}`}>
                      <span className={panelMeta}>Estimate: </span>
                      {averages.estimateSpeedStd !== null ? `${averages.estimateSpeedStd.toFixed(2)} m/s` : '— m/s'}
                      {' · '}
                      {averages.estimateAngleStd !== null ? `${averages.estimateAngleStd.toFixed(1)}°` : '—°'}
                    </div>
                    <div className={`text-sm text-gray-300 ${panelMono}`}>
                      <span className={panelMeta}>Actual: </span>
                      {averages.actualSpeedStd !== null ? `${averages.actualSpeedStd.toFixed(2)} m/s` : '— m/s'}
                      {' · '}
                      {averages.actualAngleStd !== null ? `${averages.actualAngleStd.toFixed(1)}°` : '—°'}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        </div>
        <div className="flex-shrink-0 border-t border-gray-700 p-3">
          <button
            type="button"
            onClick={handleExportEstimates}
            disabled={!canExportEstimates}
            className={`w-full ${panelBtnPrimary} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed py-1.5 text-sm`}
            title="Download estimated exit velocity and angle for every trajectory in this video"
          >
            <Download size={14} />
            Export exit estimates
          </button>
        </div>
        </>
      )}
      </div>

      {videoDialogVideo && (
        <VideoOptionsDialog
          video={videoDialogVideo}
          onAttachConfig={(config) => onAttachConfig(videoDialogVideo.id, config)}
          onEditSettings={() => {
            setEditSettingsVideoId(videoDialogVideo.id);
            setVideoDialogId(null);
          }}
          onDismiss={() => setVideoDialogId(null)}
        />
      )}

      {editSettingsVideo && (
        <XdirUploadDialog
          mode="edit"
          videoName={editSettingsVideo.name}
          initialXdir={editSettingsVideo.xdir ?? 1}
          onSubmit={(xdir) => {
            onUpdateVideoXdir(editSettingsVideo.id, xdir);
            setEditSettingsVideoId(null);
          }}
          onCancel={() => setEditSettingsVideoId(null)}
        />
      )}
    </aside>
  );
}
