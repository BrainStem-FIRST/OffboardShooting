import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { VideoData, TrajectoryPoint, Meterstick, SimulationParams, GeneratedTrajectory, TrajGenParams, TrajGroup } from './types';
import VideoSidebar from './components/VideoSidebar';
import VideoDisplay from './components/VideoDisplay';
import SimulationControls from './components/SimulationControls';
import TrajectoryGenCanvas from './components/TrajectoryGenCanvas';
import TrajectoryGenLeft from './components/TrajectoryGenLeft';
import TrajectoryGenRight from './components/TrajectoryGenRight';
import { generateTrajectories } from './simulation';

const LEFT_MIN = 160;
const LEFT_MAX = 480;
const LEFT_DEFAULT = 256;

const RIGHT_MIN = 220;
const RIGHT_MAX = 520;
const RIGHT_DEFAULT = 310;

type Tab = 'trajgen' | 'sysid';

function makeDefaultVideo(id: string, name: string, url: string): VideoData {
  return {
    id,
    name,
    url,
    trajectory: [],
    meterstick: { x: 80, y: 680, length: 160 },
    simulationParams: { exitVelocity: 8, exitAngle: 45, dragCoefficient: 0.01, magnusGain: 0, exitX: 0, exitY: 0 },
    showSimulation: false,
    currentFrame: 0,
    hasExitPos: false,
  };
}

const DEFAULT_TRAJGEN_PARAMS: TrajGenParams = {
  dx: 3,
  dy: 1.8,
  dxMin: 1,
  dxMax: 5,
  dxStep: 1,
  goalWidth: 0.4,
  exitAngleMin: 40,
  exitAngleMax: 75,
  angleStep: 1,
  impactAngleMin: 0,
  impactAngleMax: 90,
  velocityMin: 4,
  velocityMax: 12,
  velocityStep: 0.05,
  refineMaxIter: 200,
  refineThreshold: 0.001,
  dragCoefficient: 0.01,
  magnusGain: 0,
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

  // System ID state
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickingExitPos, setPickingExitPos] = useState(false);

  // Trajectory generation state
  const [trajGenParams, setTrajGenParams] = useState<TrajGenParams>(DEFAULT_TRAJGEN_PARAMS);
  const [trajGroups, setTrajGroups] = useState<TrajGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedTrajId, setSelectedTrajId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [hoveredTrajId, setHoveredTrajId] = useState<string | null>(null);

  // Panel sizing
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
  const [rightOpen, setRightOpen] = useState(true);

  const leftDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const rightDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const centerUploadRef = useRef<HTMLInputElement>(null);

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

  function updateVideo(id: string, patch: Partial<VideoData>) {
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  function handleUpload(files: FileList) {
    const newVideos: VideoData[] = [];
    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      newVideos.push(makeDefaultVideo(id, file.name, url));
    });
    setVideos((prev) => [...prev, ...newVideos]);
    if (!selectedId && newVideos.length > 0) setSelectedId(newVideos[0].id);
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

  const handleMetastickUpdate = useCallback(
    (m: Meterstick) => {
      if (!selectedId) return;
      updateVideo(selectedId, { meterstick: m });
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

  const handleSimParamsChange = useCallback(
    (p: SimulationParams) => {
      if (!selectedId) return;
      updateVideo(selectedId, { simulationParams: p });
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

  const handleExitPosPicked = useCallback(
    (x: number, y: number) => {
      if (!selectedId) return;
      setPickingExitPos(false);
      setVideos((prev) =>
        prev.map((v) =>
          v.id === selectedId
            ? { ...v, hasExitPos: true, simulationParams: { ...v.simulationParams, exitX: x, exitY: y } }
            : v
        )
      );
    },
    [selectedId]
  );

  function handleGenerate() {
    const drag = trajGenParams.dragCoefficient;
    const magnus = trajGenParams.magnusGain;
    const dy = trajGenParams.dy;
    setGenerating(true);
    setTimeout(() => {
      const newGroups: TrajGroup[] = [];
      // Enumerate all dx values in [dxMin, dxMax] by dxStep
      let dx = trajGenParams.dxMin;
      while (dx <= trajGenParams.dxMax + 1e-9) {
        const roundedDx = Math.round(dx * 1e6) / 1e6;
        const paramsForDx = { ...trajGenParams, dx: roundedDx };
        const results = generateTrajectories(paramsForDx, drag, magnus);
        const groupId = `${roundedDx.toFixed(6)}-${dy.toFixed(6)}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        newGroups.push({ id: groupId, dx: roundedDx, dy, drag, magnus, trajectories: results });
        dx = Math.round((dx + trajGenParams.dxStep) * 1e6) / 1e6;
      }
      setTrajGroups(prev => {
        const next = [...prev, ...newGroups];
        return next;
      });
      if (newGroups.length > 0) {
        setSelectedGroupId(newGroups[0].id);
        setSelectedTrajId(newGroups[0].trajectories.length > 0 ? newGroups[0].trajectories[0].id : null);
      }
      setGenerating(false);
    }, 0);
  }

  function handleDeleteTraj(groupId: string, trajId: string) {
    setTrajGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const next = g.trajectories.filter(t => t.id !== trajId);
      if (selectedTrajId === trajId) setSelectedTrajId(next.length > 0 ? next[0].id : null);
      return { ...g, trajectories: next };
    }));
  }

  function handleDeleteGroup(groupId: string) {
    setTrajGroups(prev => {
      const next = prev.filter(g => g.id !== groupId);
      if (selectedGroupId === groupId) {
        const newSel = next.length > 0 ? next[next.length - 1].id : null;
        setSelectedGroupId(newSel);
        const newGroup = next.find(g => g.id === newSel);
        setSelectedTrajId(newGroup && newGroup.trajectories.length > 0 ? newGroup.trajectories[0].id : null);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-6 pt-3.5 pb-0">
        <div className="flex items-end justify-between">
          <h1 className="text-xl font-bold tracking-tight pb-3">
            <span style={{ color: '#4a7fd4' }}>Brain</span><span style={{ color: '#3cb54a' }}>S</span><span style={{ color: '#e04020' }}>T</span><span style={{ color: '#4a7fd4' }}>E</span><span style={{ color: '#e8b020' }}>M</span><span style={{ color: '#4a7fd4' }}> Shooting Simulator</span>
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
              className={`flex-shrink-0 overflow-hidden ${isDragging ? '' : 'transition-[width] duration-200'}`}
              style={{ width: leftOpen ? leftWidth : 0 }}
            >
              <VideoSidebar
                videos={videos}
                selectedId={selectedId}
                onSelect={(id) => { setSelectedId(id); setPickingExitPos(false); }}
                onUpload={handleUpload}
                onDelete={handleDelete}
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
                  onMetastickUpdate={handleMetastickUpdate}
                  onFrameChange={handleFrameChange}
                  pickingExitPos={pickingExitPos}
                  onExitPosPicked={handleExitPosPicked}
                />
              ) : (
                <>
                  <input
                    ref={centerUploadRef}
                    type="file"
                    accept="video/*,.mov,.mp4,.m4v,.avi,.3gp"
                    multiple
                    className="hidden"
                    onChange={(e) => { if (e.target.files?.length) { handleUpload(e.target.files); e.target.value = ''; } }}
                  />
                  <button
                    onClick={() => centerUploadRef.current?.click()}
                    className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-600 hover:text-gray-400 transition-colors group"
                  >
                    <div className="w-16 h-16 rounded-full bg-gray-800 group-hover:bg-gray-700 transition-colors flex items-center justify-center">
                      <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium">Upload a video to get started</p>
                  </button>
                </>
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
                  params={selectedVideo.simulationParams}
                  hasExitPos={selectedVideo.hasExitPos}
                  showSimulation={selectedVideo.showSimulation}
                  trajectory={selectedVideo.trajectory}
                  meterstick={selectedVideo.meterstick}
                  onChange={handleSimParamsChange}
                  onToggleShow={handleToggleSimulation}
                  pickingExitPos={pickingExitPos}
                  onStartPickExitPos={() => setPickingExitPos((v) => !v)}
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
                generating={generating}
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

            {/* Center: canvas */}
            <main className="flex flex-1 min-w-0 min-h-0 bg-gray-950">
              <TrajectoryGenCanvas
                params={trajGenParams}
                groups={trajGroups}
                selectedGroupId={selectedGroup?.id ?? null}
                selectedId={selectedTrajId}
                hoveredId={hoveredTrajId}
              />
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

            {/* Right panel: trajectory list */}
            <div
              className={`flex-shrink-0 overflow-hidden ${isDragging ? '' : 'transition-[width] duration-200'}`}
              style={{ width: rightOpen ? rightWidth : 0 }}
            >
              <TrajectoryGenRight
                groups={trajGroups}
                selectedGroupId={selectedGroup?.id ?? null}
                selectedTrajId={selectedTrajId}
                hoveredTrajId={hoveredTrajId}
                onSelectGroup={(id) => {
                  setSelectedGroupId(id);
                  const g = trajGroups.find(g => g.id === id);
                  setSelectedTrajId(g && g.trajectories.length > 0 ? g.trajectories[0].id : null);
                }}
                onSelectTraj={setSelectedTrajId}
                onHoverTraj={setHoveredTrajId}
                onDeleteTraj={handleDeleteTraj}
                onDeleteGroup={handleDeleteGroup}
                onUpdateGroup={(groupId, trajs) => {
                  setTrajGroups(prev => prev.map(g => g.id === groupId ? { ...g, trajectories: trajs } : g));
                }}
                onImportGroup={(group) => {
                  setTrajGroups(prev => [...prev, group]);
                  setSelectedGroupId(group.id);
                  setSelectedTrajId(group.trajectories.length > 0 ? group.trajectories[0].id : null);
                }}
                params={trajGenParams}
                width={rightWidth}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
