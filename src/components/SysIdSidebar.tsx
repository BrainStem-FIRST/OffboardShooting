import { useRef, useState, useEffect, useMemo } from 'react';
import {
  Upload, Film, Trash2, Crosshair, RotateCcw, Save, Trash,
} from 'lucide-react';
import { VideoData, TrajectoryPoint, Meterstick } from '../types';
import { empiricalFromPoints, gravityCorrectionQuality } from '../simulation';
import {
  buildTrajectorySegments,
  segmentAtFrame,
  activeSegmentAtFrame,
  formatFrameRange,
  trajectoryPointsToSaveFile,
  saveFileToTrajectoryPoints,
  parseLegacyTrajectoryText,
  TrajectorySaveFile,
} from '../utils/trajectorySegments';
import {
  panelAside, panelTab, panelSectionTitle, panelSubsectionTitle, panelItemTitle, panelLabel, panelBody,
  panelHint, panelMeta, panelInput, panelInputNumeric, panelBtn, panelBtnPrimary, panelListItem,
  panelEmpty, panelMono, panelContent, panelDivider,
} from './panelStyles';

type SidebarTab = 'upload' | 'annotation' | 'export';

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
  onLoadTrajectory: (videoId: string, points: TrajectoryPoint[]) => void;
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
  onLoadTrajectory,
}: Props) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('upload');
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);
  const [saveName, setSaveName] = useState('');
  const [loadTargetVideoId, setLoadTargetVideoId] = useState<string | null>(selectedId);

  useEffect(() => {
    if (selectedId && videos.some((v) => v.id === selectedId)) {
      setLoadTargetVideoId(selectedId);
    } else if (videos.length > 0) {
      setLoadTargetVideoId(videos[0].id);
    } else {
      setLoadTargetVideoId(null);
    }
  }, [selectedId, videos]);

  const segments = selectedVideo ? buildTrajectorySegments(selectedVideo.trajectory) : [];
  const segmentAtCurrent = selectedVideo
    ? activeSegmentAtFrame(segments, selectedVideo.currentFrame)
    : null;
  const focusedSegment =
    segments.find((s) => s.id === focusedTrajectoryId) ?? segmentAtCurrent ?? null;
  const editingSegment = segmentAtCurrent ?? focusedSegment;

  const segmentStats = useMemo(() => {
    const ppm = meterstick.length;
    return segments.map((seg) => ({
      ...seg,
      ...empiricalFromPoints(seg.points, ppm, framerate, empiricalNumPoints),
    }));
  }, [segments, meterstick.length, framerate, empiricalNumPoints]);

  const numPointsSliderMax = useMemo(() => {
    const longest = segments.reduce((m, s) => Math.max(m, s.points.length), 0);
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
    const withSpeed = segmentStats.filter((s) => s.speed !== null);
    const withAngle = segmentStats.filter((s) => s.angle !== null);
    return {
      speed: withSpeed.length > 0
        ? withSpeed.reduce((sum, s) => sum + s.speed!, 0) / withSpeed.length
        : null,
      angle: withAngle.length > 0
        ? withAngle.reduce((sum, s) => sum + s.angle!, 0) / withAngle.length
        : null,
      count: withSpeed.length,
    };
  }, [segmentStats]);

  const dt = framerate > 0 ? 1 / framerate : null;

  function handleUploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
      e.target.value = '';
    }
  }

  function handleSave() {
    if (!selectedVideo || selectedVideo.trajectory.length === 0) return;
    const baseName = saveName.trim() || selectedVideo.name.replace(/\.[^.]+$/, '') + '_trajectories';
    const fileName = baseName.endsWith('.json') ? baseName : baseName + '.json';
    const payload = trajectoryPointsToSaveFile(selectedVideo.name, selectedVideo.trajectory);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !loadTargetVideoId) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      let points: TrajectoryPoint[] = [];
      try {
        const parsed = JSON.parse(text) as TrajectorySaveFile;
        if (parsed.version === 1 && Array.isArray(parsed.trajectories)) {
          points = saveFileToTrajectoryPoints(parsed);
        }
      } catch {
        points = parseLegacyTrajectoryText(text);
      }
      if (points.length > 0) onLoadTrajectory(loadTargetVideoId, points);
    };
    reader.readAsText(file);
  }

  const tabs: { id: SidebarTab; label: string }[] = [
    { id: 'upload', label: 'Video Upload' },
    { id: 'annotation', label: 'Trajectory Annotation' },
    { id: 'export', label: 'Export & Import' },
  ];

  return (
    <aside className={`${panelAside} border-r border-gray-700`} style={{ width }}>
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

      {/* ── Video Upload ── */}
      {activeTab === 'upload' && (
        <>
          <div className="p-4 border-b border-gray-700">
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
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {videos.length === 0 && (
              <p className={`${panelEmpty} mt-8 px-2`}>
                No videos yet. Upload an iPhone video to get started.
              </p>
            )}
            {videos.map((v) => (
              <div
                key={v.id}
                onClick={() => onSelect(v.id)}
                className={`group flex items-center gap-2.5 ${panelListItem} cursor-pointer ${
                  v.id === selectedId
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <Film size={16} className="flex-shrink-0" />
                <span className="font-medium truncate flex-1">{v.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(v.id); }}
                  className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 ${
                    v.id === selectedId ? 'hover:bg-blue-400' : 'hover:bg-gray-700'
                  }`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Trajectory Annotation ── */}
      {activeTab === 'annotation' && (
        <div className="flex flex-col flex-1 min-h-0">
          {!selectedVideo ? (
            <p className={`${panelEmpty} mt-8 px-4`}>
              Select a video from the Video Upload tab to annotate trajectories.
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
                  Click on video to plot points. Arrow keys to step frames. Delete key to remove current point. Ctrl + Z / Ctrl + Y to undo/redo.
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

                <div className="rounded-md bg-gray-950 border border-gray-700 p-0.5 flex gap-0.5">
                  <button
                    onClick={() => onShowAllTrajectoriesChange(true)}
                    className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-all ${
                      showAllTrajectories
                        ? 'bg-blue-600 text-white ring-1 ring-blue-400/50 font-semibold'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/60'
                    }`}
                  >
                    Show all
                  </button>
                  <button
                    onClick={() => onShowAllTrajectoriesChange(false)}
                    className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-all ${
                      !showAllTrajectories
                        ? 'bg-blue-600 text-white ring-1 ring-blue-400/50 font-semibold'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/60'
                    }`}
                  >
                    Show current
                  </button>
                </div>
              </div>

              {/* Trajectory list */}
              <div className="flex-1 min-h-0 flex flex-col border-t border-gray-700">
                <h3 className={`flex-shrink-0 px-4 py-2.5 ${panelSectionTitle}`}>
                  Trajectories ({segments.length})
                </h3>
                <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
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
                        <div className={`${panelMeta} mt-1`}>
                          {formatFrameRange(seg.frameStart, seg.frameEnd)} · {seg.points.length} pt{seg.points.length !== 1 ? 's' : ''}
                        </div>
                        <div className={`text-sm text-gray-300 mt-1 ${panelMono}`}>
                          {seg.speed !== null ? `${seg.speed.toFixed(2)} m/s` : '— m/s'}
                          {' · '}
                          {seg.angle !== null ? `${seg.angle.toFixed(1)}°` : '—°'}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {(averages.speed !== null || averages.angle !== null) && (
                  <div className="flex-shrink-0 px-4 py-3 border-t border-gray-700 bg-gray-800/40 space-y-2">
                    <p className={panelSectionTitle}>
                      Averages ({averages.count} trajectory{averages.count !== 1 ? 'ies' : ''})
                    </p>
                    <div className="flex items-baseline gap-6">
                      <div>
                        <span className={`${panelMeta} block mb-0.5`}>Exit speed</span>
                        <span className={`text-base ${panelMono} font-semibold text-white`}>
                          {averages.speed !== null ? averages.speed.toFixed(2) : '—'}
                        </span>
                        {averages.speed !== null && (
                          <span className="text-sm text-gray-500 ml-1">m/s</span>
                        )}
                      </div>
                      <div>
                        <span className={`${panelMeta} block mb-0.5`}>Exit angle</span>
                        <span className={`text-base ${panelMono} font-semibold text-white`}>
                          {averages.angle !== null ? averages.angle.toFixed(1) : '—'}
                        </span>
                        {averages.angle !== null && (
                          <span className="text-sm text-gray-500 ml-0.5">°</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Export & Import ── */}
      {activeTab === 'export' && (
        <div className={panelContent}>
          {videos.length === 0 ? (
            <p className={`${panelEmpty} mt-8 px-2`}>
              Upload a video to save or load trajectory annotations.
            </p>
          ) : (
            <>
              {selectedVideo ? (
                <>
                  <div>
                    <h2 className={`${panelItemTitle} mb-1 truncate`}>{selectedVideo.name}</h2>
                    <p className={panelBody}>
                      Save all annotated trajectories as JSON. Legacy .txt files can still be imported.
                    </p>
                  </div>

                  <div>
                    <label className={panelLabel}>File name</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        placeholder={`${selectedVideo.name.replace(/\.[^.]+$/, '')}_trajectories`}
                        className={`flex-1 min-w-0 ${panelInput}`}
                      />
                      <span className={`${panelMeta} flex-shrink-0`}>.json</span>
                    </div>
                  </div>

                  <button
                    onClick={handleSave}
                    disabled={selectedVideo.trajectory.length === 0}
                    className={`w-full ${panelBtnPrimary} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed`}
                  >
                    <Save size={14} />
                    Save Trajectories
                  </button>

                  {selectedVideo.trajectory.length === 0 && (
                    <p className={`${panelEmpty} text-gray-600`}>No points plotted yet</p>
                  )}
                  {segments.length > 0 && (
                    <p className={`${panelEmpty}`}>
                      {segments.length} trajectory{segments.length !== 1 ? 'ies' : ''} · {selectedVideo.trajectory.length} total points
                    </p>
                  )}

                  <div className={panelDivider} />
                </>
              ) : (
                <p className={panelBody}>Select a video to save trajectory annotations.</p>
              )}

              <div>
                <label className={panelLabel} htmlFor="load-target-video">
                  Load into video
                </label>
                <select
                  id="load-target-video"
                  value={loadTargetVideoId ?? ''}
                  onChange={(e) => setLoadTargetVideoId(e.target.value)}
                  className={panelInput}
                >
                  {videos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>

              <input
                ref={loadInputRef}
                type="file"
                accept=".json,.txt"
                className="hidden"
                onChange={handleLoad}
              />
              <button
                onClick={() => loadInputRef.current?.click()}
                disabled={!loadTargetVideoId}
                className={`w-full ${panelBtnPrimary} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                <Upload size={14} />
                Load Trajectories
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
