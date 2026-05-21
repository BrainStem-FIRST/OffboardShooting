import { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, RotateCcw, Save, Upload } from 'lucide-react';
import { VideoData, TrajectoryPoint, Meterstick } from '../types';
import { simulateShot } from '../simulation';

interface Props {
  video: VideoData;
  onTrajectoryUpdate: (points: TrajectoryPoint[]) => void;
  onMetastickUpdate: (m: Meterstick) => void;
  onFrameChange: (frame: number) => void;
  pickingExitPos: boolean;
  onExitPosPicked: (x: number, y: number) => void;
}

function getContainBox(vid: HTMLVideoElement): { x: number; y: number; w: number; h: number } {
  const vw = vid.videoWidth || 1280;
  const vh = vid.videoHeight || 720;
  const dw = vid.clientWidth;
  const dh = vid.clientHeight;
  const vidAspect = vw / vh;
  const boxAspect = dw / dh;
  let renderW = dw, renderH = dh;
  if (vidAspect > boxAspect) renderH = dw / vidAspect;
  else renderW = dh * vidAspect;
  return { x: (dw - renderW) / 2, y: (dh - renderH) / 2, w: renderW, h: renderH };
}

const MAX_HISTORY = 10;
type Tab = 'trajectory' | 'save';

export default function VideoDisplay({
  video,
  onTrajectoryUpdate,
  onMetastickUpdate,
  onFrameChange,
  pickingExitPos,
  onExitPosPicked,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);

  const [duration, setDuration] = useState(0);
  const [fps] = useState(30);
  const [plottingMode, setPlottingMode] = useState(false);
  const [hoveredZone, setHoveredZone] = useState<null | 'left' | 'right' | 'body'>(null);
  const [draggingZone, setDraggingZone] = useState<null | 'left' | 'right' | 'body'>(null);
  const dragStartRef = useRef<{ mx: number; my: number; stickSnap: Meterstick } | null>(null);
  const frameHoldRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentFrameRef = useRef(video.currentFrame);
  currentFrameRef.current = video.currentFrame;
  const totalFramesRef = useRef(1);

  const undoStack = useRef<TrajectoryPoint[][]>([]);
  const redoStack = useRef<TrajectoryPoint[][]>([]);

  const [activeTab, setActiveTab] = useState<Tab>('trajectory');
  const [saveName, setSaveName] = useState('');

  const totalFrames = Math.max(1, Math.round(duration * fps));
  totalFramesRef.current = totalFrames;
  const progressPercent = totalFrames > 1 ? (video.currentFrame / (totalFrames - 1)) * 100 : 0;

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || duration === 0) return;
    const target = video.currentFrame / fps;
    if (Math.abs(vid.currentTime - target) > 0.5 / fps) vid.currentTime = target;
  }, [video.currentFrame, fps, duration]);

  function handleMetadata() {
    const vid = videoRef.current;
    if (!vid) return;
    setDuration(vid.duration);
  }

  function stepFrame(delta: number) {
    onFrameChange(Math.min(totalFramesRef.current - 1, Math.max(0, currentFrameRef.current + delta)));
  }

  function pushUndo(current: TrajectoryPoint[]) {
    undoStack.current = [...undoStack.current.slice(-MAX_HISTORY + 1), [...current]];
    redoStack.current = [];
  }

  function handleUndo() {
    if (undoStack.current.length === 0) return;
    redoStack.current = [[...video.trajectory], ...redoStack.current.slice(0, MAX_HISTORY - 1)];
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    onTrajectoryUpdate(prev);
  }

  function handleRedo() {
    if (redoStack.current.length === 0) return;
    undoStack.current = [...undoStack.current.slice(-MAX_HISTORY + 1), [...video.trajectory]];
    const next = redoStack.current[0];
    redoStack.current = redoStack.current.slice(1);
    onTrajectoryUpdate(next);
  }

  function clientToCanvas(cx: number, cy: number): { x: number; y: number } {
    const canvas = canvasRef.current;
    const vid = videoRef.current;
    if (!canvas || !vid) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = (vid.videoWidth || 1280) / rect.width;
    const scaleY = (vid.videoHeight || 720) / rect.height;
    return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
  }

  function syncCanvasToVideo() {
    const vid = videoRef.current;
    const canvas = canvasRef.current;
    if (!vid || !canvas) return;
    const box = getContainBox(vid);
    canvas.style.left = `${box.x}px`;
    canvas.style.top = `${box.y}px`;
    canvas.style.width = `${box.w}px`;
    canvas.style.height = `${box.h}px`;
    canvas.width = vid.videoWidth || 1280;
    canvas.height = vid.videoHeight || 720;
    drawRef.current();
  }

  useEffect(() => {
    syncCanvasToVideo();
    const ro = new ResizeObserver(() => syncCanvasToVideo());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  function hitStick(mx: number, my: number): 'left' | 'right' | 'body' | null {
    const s = video.meterstick;
    if (Math.abs(my - s.y) > 22) return null;
    if (Math.abs(mx - s.x) < 14) return 'left';
    if (Math.abs(mx - (s.x + s.length)) < 14) return 'right';
    if (mx >= s.x && mx <= s.x + s.length) return 'body';
    return null;
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (draggingZone) return;
    const pos = clientToCanvas(e.clientX, e.clientY);
    if (pickingExitPos) { onExitPosPicked(Math.round(pos.x), Math.round(pos.y)); return; }
    if (!plottingMode) return;
    pushUndo(video.trajectory);
    const newPt: TrajectoryPoint = { x: pos.x, y: pos.y, frame: video.currentFrame };
    const updated = [...video.trajectory.filter((p) => p.frame !== video.currentFrame), newPt]
      .sort((a, b) => a.frame - b.frame);
    onTrajectoryUpdate(updated);
  }

  function handleCanvasMouseMove(e: React.MouseEvent) {
    if (draggingZone) return;
    const pos = clientToCanvas(e.clientX, e.clientY);
    setHoveredZone(hitStick(pos.x, pos.y));
  }

  function handleCanvasMouseLeave() {
    if (!draggingZone) setHoveredZone(null);
  }

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (plottingMode || pickingExitPos) return;
    const pos = clientToCanvas(e.clientX, e.clientY);
    const zone = hitStick(pos.x, pos.y);
    if (!zone) return;
    e.preventDefault();
    setDraggingZone(zone);
    dragStartRef.current = { mx: pos.x, my: pos.y, stickSnap: { ...video.meterstick } };
  }

  const handleWindowMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingZone || !dragStartRef.current) return;
    const pos = clientToCanvas(e.clientX, e.clientY);
    const { mx, my, stickSnap } = dragStartRef.current;
    const dx = pos.x - mx;
    const dy = pos.y - my;
    if (draggingZone === 'body') {
      onMetastickUpdate({ ...stickSnap, x: stickSnap.x + dx, y: stickSnap.y + dy });
    } else if (draggingZone === 'left') {
      const newLen = stickSnap.length - dx;
      if (newLen > 20) onMetastickUpdate({ ...stickSnap, x: stickSnap.x + dx, length: newLen });
    } else if (draggingZone === 'right') {
      const newLen = stickSnap.length + dx;
      if (newLen > 20) onMetastickUpdate({ ...stickSnap, length: newLen });
    }
  }, [draggingZone, onMetastickUpdate]);

  const handleWindowMouseUp = useCallback(() => {
    setDraggingZone(null);
    dragStartRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [handleWindowMouseMove, handleWindowMouseUp]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.trajectory]);

  function startHold(dir: number) {
    if (frameHoldRef.current) clearInterval(frameHoldRef.current);
    frameHoldRef.current = setInterval(() => {
      const next = Math.min(totalFramesRef.current - 1, Math.max(0, currentFrameRef.current + dir));
      onFrameChange(next);
    }, 60);
  }

  function stopHold() {
    if (frameHoldRef.current) { clearInterval(frameHoldRef.current); frameHoldRef.current = null; }
  }

  useEffect(() => () => stopHold(), []);

  function handleSaveTrajectory() {
    if (video.trajectory.length === 0) return;
    const baseName = saveName.trim() || video.name.replace(/\.[^.]+$/, '') + '_trajectory';
    const fileName = baseName.endsWith('.txt') ? baseName : baseName + '.txt';
    const lines = [
      `# Trajectory for: ${video.name}`,
      `# frame, x_px, y_px`,
      ...video.trajectory.map((p) => `${p.frame},${p.x.toFixed(2)},${p.y.toFixed(2)}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLoadTrajectory(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
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
      if (points.length > 0) {
        pushUndo(video.trajectory);
        onTrajectoryUpdate(points.sort((a, b) => a.frame - b.frame));
      }
    };
    reader.readAsText(file);
  }

  const drawRef = useRef<() => void>(() => {});

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const vid = videoRef.current;
    if (!canvas || !vid) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sorted = [...video.trajectory].sort((a, b) => a.frame - b.frame);
    if (sorted.length >= 2) {
      ctx.beginPath();
      sorted.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      ctx.strokeStyle = 'rgba(239,68,68,0.65)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    sorted.forEach((pt) => {
      const isActive = pt.frame === video.currentFrame;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isActive ? 9 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#f59e0b' : 'rgba(239,68,68,0.9)';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    const { exitVelocity, exitAngle, dragCoefficient, magnusGain, exitX, exitY } = video.simulationParams;
    const ppm = video.meterstick.length;

    if (video.showSimulation && ppm > 0) {
      const simPts = simulateShot(exitVelocity, exitAngle, dragCoefficient, magnusGain);
      ctx.beginPath();
      simPts.forEach((sp, i) => {
        const cx = exitX + sp.x * ppm;
        const cy = exitY - sp.y * ppm;
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.strokeStyle = 'rgba(34,197,94,0.95)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (video.hasExitPos) {
      const r = 18, r2 = 10, crossLen = 28, gap = r + 6;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 8;
      for (const [radius, lw1, lw2] of [[r, 3.5, 2], [r2, 2.5, 1.5]] as [number, number, number][]) {
        ctx.beginPath(); ctx.arc(exitX, exitY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw1; ctx.stroke();
        ctx.beginPath(); ctx.arc(exitX, exitY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = lw2; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(exitX, exitY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#22c55e'; ctx.fill();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(exitX + dx * gap, exitY + dy * gap);
        ctx.lineTo(exitX + dx * (gap + crossLen), exitY + dy * (gap + crossLen));
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(exitX + dx * gap, exitY + dy * gap);
        ctx.lineTo(exitX + dx * (gap + crossLen), exitY + dy * (gap + crossLen));
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.stroke();
      });
      ctx.restore();
    }

    const s = video.meterstick;
    const rx = s.x + s.length;
    const isHovered = hoveredZone !== null || draggingZone !== null;
    const pad = 8;
    ctx.beginPath();
    ctx.roundRect(s.x - pad, s.y - 20, s.length + pad * 2, 40, 6);
    ctx.fillStyle = isHovered ? 'rgba(251,191,36,0.2)' : 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.strokeStyle = isHovered ? 'rgba(251,191,36,0.7)' : 'rgba(251,191,36,0.3)';
    ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(rx, s.y);
    ctx.strokeStyle = isHovered ? '#fde68a' : '#fbbf24';
    ctx.lineWidth = isHovered ? 4 : 3; ctx.stroke();
    const capH = 18;
    [s.x, rx].forEach((ex) => {
      ctx.beginPath(); ctx.arc(ex, s.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? '#fde68a' : '#fbbf24'; ctx.fill();
      ctx.strokeStyle = 'white'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, s.y - capH / 2); ctx.lineTo(ex, s.y + capH / 2);
      ctx.strokeStyle = isHovered ? '#fde68a' : '#fbbf24';
      ctx.lineWidth = isHovered ? 4 : 3; ctx.stroke();
    });
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = isHovered ? '#fde68a' : '#fbbf24';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
    ctx.fillText('1 m', s.x + s.length / 2, s.y - 12);
    ctx.shadowBlur = 0;
  }, [video, hoveredZone, draggingZone]);

  useEffect(() => { drawRef.current = draw; draw(); }, [draw]);

  const cursor = pickingExitPos || plottingMode ? 'crosshair'
    : draggingZone === 'body' ? 'grabbing'
    : draggingZone === 'left' || draggingZone === 'right' ? 'col-resize'
    : hoveredZone === 'body' ? 'grab'
    : hoveredZone ? 'col-resize'
    : 'default';

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'trajectory', label: 'Trajectory Editing' },
    { id: 'save', label: 'Save / Load' },
  ];

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full outline-none">
      {/* Video + canvas overlay */}
      <div ref={containerRef} className="relative flex-1 bg-black overflow-hidden">
        <video
          ref={videoRef}
          src={video.url}
          className="absolute inset-0 w-full h-full object-contain"
          onLoadedMetadata={handleMetadata}
          preload="auto"
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className="absolute"
          style={{ cursor }}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
          onMouseDown={handleCanvasMouseDown}
        />
      </div>

      {/* Bottom panel */}
      <div className="bg-gray-900 border-t border-gray-700 flex-shrink-0">

        {/* Scrub bar — always visible */}
        <div className="px-4 pt-3 pb-2">
          <div
            className="relative h-2 bg-gray-700 rounded-full cursor-pointer group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onFrameChange(Math.round(((e.clientX - rect.left) / rect.width) * (totalFrames - 1)));
            }}
          >
            <div
              className="absolute top-0 left-0 h-full bg-blue-500 rounded-full group-hover:bg-blue-400 transition-colors"
              style={{ width: `${progressPercent}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow -translate-x-1/2"
              style={{ left: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-700 px-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                activeTab === t.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="overflow-x-auto">

          {/* ── Trajectory Editing ── */}
          {activeTab === 'trajectory' && (
            <div className="flex flex-col gap-2 px-4 py-3 min-w-max">
              <div className="flex items-center gap-3">
                <button
                  onMouseDown={(e) => { e.preventDefault(); startHold(-1); }}
                  onMouseUp={stopHold} onMouseLeave={stopHold}
                  className="p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors select-none"
                  title="Previous frame (←)"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); startHold(1); }}
                  onMouseUp={stopHold} onMouseLeave={stopHold}
                  className="p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors select-none"
                  title="Next frame (→)"
                >
                  <ChevronRight size={18} />
                </button>
                <span className="text-xs text-gray-400 font-mono tabular-nums">
                  Frame {video.currentFrame + 1} / {totalFrames}
                </span>

                <div className="w-px h-4 bg-gray-700" />

                <button
                  onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
                  </svg>
                  Undo
                </button>
                <button
                  onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Y)"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>
                  </svg>
                  Redo
                </button>

                <div className="w-px h-4 bg-gray-700" />

                <button
                  onClick={() => setPlottingMode((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    plottingMode
                      ? 'bg-red-600 text-white hover:bg-red-500'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  <Crosshair size={13} />
                  {plottingMode ? 'Stop Plotting' : 'Plot Ball'}
                </button>
                <button
                  onClick={() => { pushUndo(video.trajectory); onTrajectoryUpdate([]); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  <RotateCcw size={13} />
                  Clear
                </button>
              </div>

              {plottingMode && !pickingExitPos && (
                <p className="text-xs text-amber-400">
                  Click on the ball to plot · ← → to step frames · Ctrl+Z / Ctrl+Y to undo/redo
                </p>
              )}
              {pickingExitPos && (
                <p className="text-xs text-green-400">
                  Click anywhere on the video to set the simulation launch point.
                </p>
              )}
            </div>
          )}

          {/* ── Save / Load ── */}
          {activeTab === 'save' && (
            <div className="flex items-center gap-3 px-4 py-3 min-w-max">
              <label className="text-xs text-gray-400 whitespace-nowrap">File name</label>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={`${video.name.replace(/\.[^.]+$/, '')}_trajectory`}
                className="w-56 text-xs bg-gray-800 border border-gray-600 rounded-md px-2.5 py-1.5 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <span className="text-xs text-gray-600">.txt</span>

              <div className="w-px h-4 bg-gray-700" />

              <button
                onClick={handleSaveTrajectory}
                disabled={video.trajectory.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Save size={13} />
                Save Trajectory
              </button>

              <input ref={loadInputRef} type="file" accept=".txt" className="hidden" onChange={handleLoadTrajectory} />
              <button
                onClick={() => loadInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
              >
                <Upload size={13} />
                Load Trajectory
              </button>

              {video.trajectory.length === 0 && (
                <span className="text-xs text-gray-600">No points plotted yet</span>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
