import { useRef, useState, useEffect, useMemo } from 'react';
import {
  Upload, Film, Trash2, Crosshair, RotateCcw, Save, Trash, SkipForward, FolderDown,
} from 'lucide-react';
import { VideoData, TrajectoryPoint, Meterstick } from '../types';
import { empiricalFromPoints, gravityCorrectionQuality } from '../simulation';
import {
  buildTrajectorySegments,
  activeSegmentAtFrame,
  getLaunchParams,
  countPlottedPoints,
} from '../utils/trajectorySegments';
import {
  PROJECT_SUBDIR,
  configFileNameForVideo,
  downloadConfigFiles,
  previewProjectFiles,
  loadProjectEntriesFromFiles,
} from '../utils/projectIO';
import type { ImportedProjectEntry } from '../utils/projectIO';
import {
  panelAside, panelTab, panelSectionTitle, panelSubsectionTitle, panelItemTitle, panelLabelInline, panelBody,
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
  onImportProject: (entries: ImportedProjectEntry[]) => void;
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
}: Props) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('uploadSave');
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  const saveBusyRef = useRef(false);
  const importBusyRef = useRef(false);
  const importPickerOpenedRef = useRef(false);
  const ignoreNextEmptyImportRef = useRef(false);
  const [saving, setSaving] = useState(false);
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
    const ppm = meterstick.length;
    const stored = selectedVideo?.trajectoryLaunchParams;
    return segments.map((seg) => {
      const actual = getLaunchParams(stored, seg.id);
      return {
        ...seg,
        ...empiricalFromPoints(seg.points, ppm, framerate, empiricalNumPoints),
        actualSpeed: actual.exitVelocity,
        actualAngle: actual.exitAngle,
      };
    });
  }, [segments, meterstick.length, framerate, empiricalNumPoints, selectedVideo?.trajectoryLaunchParams]);

  const numPointsSliderMax = useMemo(() => {
    const longest = segments.reduce((m, s) => Math.max(m, countPlottedPoints(s.points)), 0);
    return Math.max(longest, empiricalNumPoints, 10);
  }, [segments, empiricalNumPoints]);

  const grayLineQuality = useMemo(() => {
    if (!editingSegment) return { r2: null, avgRadiusOfCurvature: null };
    return gravityCorrectionQuality(
      editingSegment.points,
      meterstick.length,
      framerate,
      empiricalNumPoints
    );
  }, [editingSegment, meterstick.length, framerate, empiricalNumPoints]);

  function formatRadius(r: number | null): string {
    if (r === null) return '—';
    if (r > 999) return '>999 m';
    if (r > 100) return `${r.toFixed(0)} m`;
    return `${r.toFixed(1)} m`;
  }

  const averages = useMemo(() => {
    const withEstSpeed = segmentStats.filter((s) => s.speed !== null);
    const withEstAngle = segmentStats.filter((s) => s.angle !== null);
    return {
      estimateSpeed: withEstSpeed.length > 0
        ? withEstSpeed.reduce((sum, s) => sum + s.speed!, 0) / withEstSpeed.length
        : null,
      estimateAngle: withEstAngle.length > 0
        ? withEstAngle.reduce((sum, s) => sum + s.angle!, 0) / withEstAngle.length
        : null,
      actualSpeed: segmentStats.length > 0
        ? segmentStats.reduce((sum, s) => sum + s.actualSpeed, 0) / segmentStats.length
        : null,
      actualAngle: segmentStats.length > 0
        ? segmentStats.reduce((sum, s) => sum + s.actualAngle, 0) / segmentStats.length
        : null,
      count: segmentStats.length,
    };
  }, [segmentStats]);

  const dt = framerate > 0 ? 1 / framerate : null;

  function handleUploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
      e.target.value = '';
    }
  }

  function handleSaveProjectClick() {
    if (saveBusyRef.current || importBusyRef.current) return;
    if (videos.length === 0) return;

    saveBusyRef.current = true;
    setSaving(true);
    setProjectStatus(null);
    try {
      const { count } = downloadConfigFiles(videos);
      setProjectStatus({
        ok: true,
        text: `Downloaded ${count} config file(s). Move them into ${PROJECT_SUBDIR}/ with your videos.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus({ ok: false, text: `Could not save configs: ${msg}` });
    } finally {
      saveBusyRef.current = false;
      setSaving(false);
    }
  }

  function handleImportProjectClick() {
    if (importBusyRef.current || saveBusyRef.current) {
      setProjectStatus({ ok: null, text: 'Import already in progress.' });
      return;
    }
    importPickerOpenedRef.current = true;
    importFolderInputRef.current?.click();
  }

  async function handleImportFolderSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const fileList = input.files;

    if (!fileList || fileList.length === 0) {
      if (ignoreNextEmptyImportRef.current) {
        ignoreNextEmptyImportRef.current = false;
        return;
      }
      if (importPickerOpenedRef.current) {
        importPickerOpenedRef.current = false;
        setProjectStatus({ ok: null, text: 'Import cancelled — no folder selected.' });
      }
      return;
    }

    if (importBusyRef.current || saveBusyRef.current) {
      setProjectStatus({ ok: null, text: 'Import already in progress.' });
      return;
    }

    importPickerOpenedRef.current = false;
    const allFiles = Array.from(fileList);

    importBusyRef.current = true;
    setImporting(true);
    setProjectStatus({ ok: null, text: `Scanning ${allFiles.length} file(s)…` });
    try {
      const previewResult = previewProjectFiles(allFiles);
      if (!previewResult.ok) {
        setProjectStatus({ ok: false, text: previewResult.message });
        return;
      }

      const { preview, files } = previewResult;

      let confirmMsg = `Import ${preview.pairs.length} video(s) and replace the current session?\n\n`;
      for (const pair of preview.pairs) {
        confirmMsg += `• ${pair.videoName}`;
        confirmMsg += pair.configName ? ` + ${pair.configName}` : ' (no config)';
        confirmMsg += '\n';
      }
      if (preview.orphanConfigs.length > 0) {
        confirmMsg += `\nWarning: unmatched config file${preview.orphanConfigs.length !== 1 ? 's' : ''}: ${preview.orphanConfigs.join(', ')}\n`;
      }

      if (!window.confirm(confirmMsg)) {
        setProjectStatus({ ok: null, text: 'Import cancelled.' });
        return;
      }

      setProjectStatus({ ok: null, text: 'Loading project files…' });
      const loadResult = await loadProjectEntriesFromFiles(files, preview);
      if (!loadResult.ok) {
        setProjectStatus({ ok: false, text: loadResult.message });
        return;
      }

      onImportProject(loadResult.entries);
      let text = `Imported ${loadResult.entries.length} video(s).`;
      if (loadResult.warnings.length > 0) {
        text += ` ${loadResult.warnings.join(' ')}`;
      }
      setProjectStatus({ ok: true, text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ProjectImport] Unexpected error:', err);
      setProjectStatus({ ok: false, text: `Import failed: ${msg}` });
    } finally {
      importBusyRef.current = false;
      setImporting(false);
      ignoreNextEmptyImportRef.current = true;
      input.value = '';
    }
  }

  function videoRowStats(v: VideoData) {
    const segs = buildTrajectorySegments(v.trajectory);
    const trajCount = segs.length;
    const pointCount = segs.reduce((sum, s) => sum + countPlottedPoints(s.points), 0);
    return { trajCount, pointCount };
  }

  const tabs: { id: SidebarTab; label: string }[] = [
    { id: 'uploadSave', label: 'Upload/Save' },
    { id: 'annotation', label: 'Trajectory Annotation' },
  ];

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
            {videos.map((v) => {
              const { trajCount, pointCount } = videoRowStats(v);
              const configName = configFileNameForVideo(v.name);
              return (
                <div
                  key={v.id}
                  onClick={() => onSelect(v.id)}
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
              onClick={handleSaveProjectClick}
              disabled={videos.length === 0 || saving || importing}
              className={`w-full ${panelBtnPrimary} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed py-1.5 text-sm`}
            >
              <Save size={14} />
              {saving ? 'Saving…' : 'Save Configs'}
            </button>
            <input
              ref={importFolderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is supported in Chromium; same picker path as Upload Video
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleImportFolderSelected}
            />
            <button
              type="button"
              onClick={handleImportProjectClick}
              disabled={saving || importing}
              className={`w-full ${panelBtnPrimary} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed py-1.5 text-sm`}
            >
              <FolderDown size={14} />
              {importing ? 'Importing…' : 'Import Project'}
            </button>
            <div className={`${panelMeta} text-[11px] leading-snug space-y-1.5`}>
              <p>
                Select a project folder containing video and config files together.
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
                  Click on video to plot points. Arrow keys to step frames. WASD to nudge the current point by 1 cm. Delete key to remove current point. Ctrl + Z / Ctrl + Y to undo/redo. Click the meterstick, then Ctrl + C / Ctrl + V to copy its position and scale to another video.
                </p>
              </div>

              {/* Section 2: exit velocity/angle calculations */}
              <div className="flex-shrink-0 p-4 border-b border-gray-700 space-y-2">
                <h3 className={panelSubsectionTitle}>Exit velocity / angle</h3>
                <p className={panelBody}>
                  Set framerate and calibrate the meterstick on the video. Exit speed and angle use gravity-corrected points (gray dots)—each shifted up by ½g·t² to undo sag—then weighted toward the earliest pairs. Gray points should form a straight line when correction is accurate.
                </p>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-400 whitespace-nowrap flex-shrink-0">Framerate (fps)</label>
                  <div className="flex-1 min-w-0">
                    <FramerateInput value={framerate} onChange={onFramerateChange} />
                  </div>
                </div>
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
                    title="Label current frame as skipped (ball off-screen) and advance"
                    className={`${panelBtn} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed`}
                  >
                    <SkipForward size={14} />
                    Skip frame
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showAllTrajectories}
                      onChange={(e) => onShowAllTrajectoriesChange(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-gray-900"
                    />
                    <span className={panelLabelInline}>Show all</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 select-none ${
                      segments.length < 2 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                    title={
                      segments.length < 2
                        ? 'Plot at least 2 trajectories to show the average'
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={showAverageTrajectory}
                      disabled={segments.length < 2}
                      onChange={(e) => onShowAverageTrajectoryChange(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-gray-900 disabled:cursor-not-allowed"
                    />
                    <span className={panelLabelInline}>Show average</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showTrajectoryPoints}
                      onChange={(e) => onShowTrajectoryPointsChange(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-gray-900"
                    />
                    <span className={panelLabelInline}>Show points</span>
                  </label>
                </div>
              </div>

              {/* Trajectory list */}
              <div className="border-t border-gray-700">
                <h3 className={`px-4 py-2.5 ${panelSectionTitle}`}>
                  Trajectories ({segments.length})
                </h3>
                <div className="px-3 pb-3 space-y-1.5">
                  {segments.length === 0 && (
                    <p className={`${panelEmpty} py-4`}>No trajectories plotted yet</p>
                  )}
                  {segmentStats.map((seg) => {
                    const isActive =
                      seg.id === editingSegment?.id ||
                      (focusedTrajectoryId === seg.id && !segmentAtCurrent);
                    return (
                      <button
                        key={seg.id}
                        onClick={() => {
                          onFocusedTrajectoryChange(seg.id);
                          onFrameChange(seg.frameStart);
                        }}
                        className={`w-full text-left ${panelListItem} ${
                          isActive ? 'bg-gray-800 ring-1 ring-gray-600' : 'hover:bg-gray-800/60'
                        }`}
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
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        </div>
      )}
      </div>
    </aside>
  );
}
