import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { VideoData, TrajectoryPoint, Meterstick } from '../types';
import { simulateShot, gravityCorrectedPoints, interpSimAtTime, SIM_MAX_TIME, SIM_DT } from '../simulation';
import { buildTrajectorySegments, activeSegmentAtFrame, resolveActiveSegment, firstTrajectoryPoint, averageTrajectoryFromSegments, getLaunchParams, plottedPathSegments, plottedPoints, isSkippedPoint } from '../utils/trajectorySegments';

interface Props {
  video: VideoData;
  onTrajectoryUpdate: (points: TrajectoryPoint[]) => void;
  onMetastickUpdate: (m: Meterstick) => void;
  meterstickClipboardRef: React.MutableRefObject<Meterstick | null>;
  onFrameChange: (frame: number) => void;
  onTotalFramesChange: (total: number) => void;
  plottingMode: boolean;
  showAllTrajectories: boolean;
  showAverageTrajectory: boolean;
  showTrajectoryPoints: boolean;
  focusedTrajectoryId: string | null;
  onPushUndo: (current: TrajectoryPoint[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteCurrentPoint: () => void;
  onStepFrame: (delta: number) => void;
  onStartFrameHold: (dir: number) => void;
  onStopFrameHold: () => void;
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

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function darkenHex(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_WHEEL_FACTOR = 1.1;

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function scrubSegmentStyle(frameStart: number, frameEnd: number, totalFrames: number) {
  if (totalFrames <= 1) return { left: '0%', width: '100%' };
  const span = totalFrames - 1;
  const leftPct = (frameStart / span) * 100;
  let widthPct = ((frameEnd - frameStart) / span) * 100;
  const minPct = 100 / totalFrames;
  if (widthPct < minPct) widthPct = minPct;
  return { left: `${leftPct}%`, width: `${widthPct}%` };
}

export default function VideoDisplay({
  video,
  onTrajectoryUpdate,
  onMetastickUpdate,
  meterstickClipboardRef,
  onFrameChange,
  onTotalFramesChange,
  plottingMode,
  showAllTrajectories,
  showAverageTrajectory,
  showTrajectoryPoints,
  focusedTrajectoryId,
  onPushUndo,
  onUndo,
  onRedo,
  onDeleteCurrentPoint,
  onStepFrame,
  onStartFrameHold,
  onStopFrameHold,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState(0);
  const [fps] = useState(30);
  const [hoveredZone, setHoveredZone] = useState<null | 'left' | 'right' | 'body'>(null);
  const [draggingZone, setDraggingZone] = useState<null | 'left' | 'right' | 'body'>(null);
  const [stickSelected, setStickSelected] = useState(false);
  const dragStartRef = useRef<{ mx: number; my: number; stickSnap: Meterstick } | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const didPanRef = useRef(false);
  const scrubTrackRef = useRef<HTMLDivElement>(null);
  const totalFramesRef = useRef(1);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const segments = useMemo(
    () => buildTrajectorySegments(video.trajectory),
    [video.trajectory]
  );

  const visibleSegments = useMemo(() => {
    if (showAllTrajectories) return segments;
    const active = resolveActiveSegment(segments, video.currentFrame, focusedTrajectoryId);
    return active ? [active] : [];
  }, [segments, showAllTrajectories, video.currentFrame, focusedTrajectoryId]);

  const averagePoints = useMemo(() => {
    if (!showAverageTrajectory) return [];
    return averageTrajectoryFromSegments(segments, video.framerate);
  }, [showAverageTrajectory, segments, video.framerate]);

  const activeSegment = useMemo(
    () => resolveActiveSegment(segments, video.currentFrame, focusedTrajectoryId),
    [segments, video.currentFrame, focusedTrajectoryId]
  );

  const simulationPoints = useMemo(() => activeSegment?.points ?? [], [activeSegment]);

  const launchParams = useMemo(
    () => getLaunchParams(video.trajectoryLaunchParams, activeSegment?.id ?? null),
    [video.trajectoryLaunchParams, activeSegment]
  );

  const launchPoint = useMemo(
    () => firstTrajectoryPoint(simulationPoints),
    [simulationPoints]
  );

  const totalFrames = Math.max(1, Math.round(duration * fps));
  totalFramesRef.current = totalFrames;
  const progressPercent = totalFrames > 1 ? (video.currentFrame / (totalFrames - 1)) * 100 : 0;
  const activeScrubSegment = activeSegmentAtFrame(segments, video.currentFrame);

  useEffect(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setStickSelected(false);
  }, [video.id]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function applyZoom(oldZoom: number, newZoom: number, mx: number, my: number) {
      const rect = el!.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const lx = mx - rect.left;
      const ly = my - rect.top;
      const p = panRef.current;
      let nextPan = { x: 0, y: 0 };
      if (newZoom > 1) {
        nextPan = {
          x: lx - cx - (lx - cx - p.x) * (newZoom / oldZoom),
          y: ly - cy - (ly - cy - p.y) * (newZoom / oldZoom),
        };
      }
      zoomRef.current = newZoom;
      panRef.current = nextPan;
      setZoom(newZoom);
      setPan(nextPan);
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const oldZoom = zoomRef.current;
      const delta = e.deltaY;
      if (delta === 0) return;
      const factor = delta < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
      const newZoom = clampZoom(oldZoom * factor);
      if (newZoom === oldZoom) return;
      applyZoom(oldZoom, newZoom, e.clientX, e.clientY);
    }

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [video.id]);

  useEffect(() => {
    onTotalFramesChange(totalFrames);
  }, [totalFrames, onTotalFramesChange]);

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

  function scrubToClientX(clientX: number) {
    const bar = scrubTrackRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const frame = Math.round(ratio * (totalFramesRef.current - 1));
    onFrameChange(Math.min(totalFramesRef.current - 1, Math.max(0, frame)));
  }

  function handleScrubMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    scrubToClientX(e.clientX);
    function onMove(ev: MouseEvent) {
      scrubToClientX(ev.clientX);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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

  function startPanDrag(clientX: number, clientY: number) {
    panDragRef.current = {
      startX: clientX,
      startY: clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    didPanRef.current = false;
    setIsPanning(true);
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (draggingZone || didPanRef.current) {
      didPanRef.current = false;
      return;
    }
    const pos = clientToCanvas(e.clientX, e.clientY);
    if (!plottingMode) {
      setStickSelected(hitStick(pos.x, pos.y) !== null);
      return;
    }
    onPushUndo(video.trajectory);
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
    if (zoomRef.current > 1) {
      if (!plottingMode) {
        const pos = clientToCanvas(e.clientX, e.clientY);
        const zone = hitStick(pos.x, pos.y);
        if (zone) {
          e.preventDefault();
          setStickSelected(true);
          setDraggingZone(zone);
          dragStartRef.current = { mx: pos.x, my: pos.y, stickSnap: { ...video.meterstick } };
          return;
        }
      }
      e.preventDefault();
      startPanDrag(e.clientX, e.clientY);
      return;
    }
    if (plottingMode) return;
    const pos = clientToCanvas(e.clientX, e.clientY);
    const zone = hitStick(pos.x, pos.y);
    if (!zone) return;
    e.preventDefault();
    setStickSelected(true);
    setDraggingZone(zone);
    dragStartRef.current = { mx: pos.x, my: pos.y, stickSnap: { ...video.meterstick } };
  }

  const handleWindowMouseMove = useCallback((e: MouseEvent) => {
    if (panDragRef.current) {
      const dx = e.clientX - panDragRef.current.startX;
      const dy = e.clientY - panDragRef.current.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPanRef.current = true;
      const nextPan = {
        x: panDragRef.current.panX + dx,
        y: panDragRef.current.panY + dy,
      };
      panRef.current = nextPan;
      setPan(nextPan);
      return;
    }
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
    panDragRef.current = null;
    setIsPanning(false);
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

  const fineAdjustCurrentPoint = useCallback(
    (dxCm: number, dyCm: number, pushUndo: boolean) => {
      const ppm = video.meterstick.length;
      if (ppm <= 0) return;
      const pt = video.trajectory.find((p) => p.frame === video.currentFrame);
      if (!pt || pt.skipped) return;
      const pxPerMm = ppm / 1000;
      if (pushUndo) onPushUndo(video.trajectory);
      const updated = video.trajectory.map((p) =>
        p.frame === video.currentFrame
          ? { ...p, x: p.x + dxCm * pxPerMm, y: p.y + dyCm * pxPerMm }
          : p
      );
      onTrajectoryUpdate(updated);
    },
    [video, onPushUndo, onTrajectoryUpdate]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (e.key === 'ArrowRight' || key === 'e') { e.preventDefault(); onStepFrame(1); }
      if (e.key === 'ArrowLeft' || key === 'q') { e.preventDefault(); onStepFrame(-1); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); onUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); onRedo(); }
      if (e.key === 'Delete') { e.preventDefault(); onDeleteCurrentPoint(); }
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        const dxCm = key === 'a' ? -1 : key === 'd' ? 1 : 0;
        const dyCm = key === 'w' ? -1 : key === 's' ? 1 : 0;
        if (dxCm !== 0 || dyCm !== 0) {
          e.preventDefault();
          fineAdjustCurrentPoint(dxCm, dyCm, !e.repeat);
        }
      }
      if ((e.ctrlKey || e.metaKey) && key === 'c' && stickSelected) {
        e.preventDefault();
        meterstickClipboardRef.current = { ...video.meterstick };
      }
      if ((e.ctrlKey || e.metaKey) && key === 'v' && meterstickClipboardRef.current) {
        e.preventDefault();
        onMetastickUpdate({ ...meterstickClipboardRef.current });
        setStickSelected(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onStepFrame, onUndo, onRedo, onDeleteCurrentPoint, fineAdjustCurrentPoint, stickSelected, video.meterstick, meterstickClipboardRef, onMetastickUpdate]);

  const drawRef = useRef<() => void>(() => {});

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const vid = videoRef.current;
    if (!canvas || !vid) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const numPointsForEstimate = Math.max(2, video.empiricalNumPoints ?? 2);
    const ppm = video.meterstick.length;

    for (const seg of visibleSegments) {
      const sorted = [...seg.points].sort((a, b) => a.frame - b.frame);
      for (const run of plottedPathSegments(sorted)) {
        if (run.length >= 2) {
          ctx.beginPath();
          run.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
          ctx.strokeStyle = hexToRgba(seg.color, 0.75);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      if (showTrajectoryPoints) {
        sorted.forEach((pt) => {
          if (isSkippedPoint(pt)) return;
          const isActive = pt.frame === video.currentFrame;
          const r = isActive ? 11 : 5;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fillStyle = seg.color;
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = isActive ? 2 : 1.5;
          ctx.stroke();
          if (isActive) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
          }
        });
      }

      const plottedSorted = plottedPoints(sorted);
      if (ppm > 0 && video.framerate > 0 && plottedSorted.length >= 2) {
        const subset = plottedSorted.slice(0, Math.min(numPointsForEstimate, plottedSorted.length));
        const corrected = gravityCorrectedPoints(subset, ppm, video.framerate);
        if (corrected.length >= 2) {
          ctx.beginPath();
          corrected.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
          ctx.strokeStyle = 'rgba(156, 163, 175, 0.6)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (showTrajectoryPoints) {
          corrected.forEach((pt) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(156, 163, 175, 0.85)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(75, 85, 99, 0.9)';
            ctx.lineWidth = 1;
            ctx.stroke();
          });
        }
      }
    }

    if (averagePoints.length >= 2) {
      ctx.beginPath();
      averagePoints.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    const { exitVelocity, exitAngle, dragCoefficient, magnusGain, magnusPower } = launchParams;

    if (video.showSimulation && ppm > 0 && launchPoint) {
      const simPts = simulateShot(
        exitVelocity,
        exitAngle,
        dragCoefficient,
        magnusGain,
        SIM_MAX_TIME,
        SIM_DT,
        magnusPower ?? 2
      );
      ctx.beginPath();
      simPts.forEach((sp, i) => {
        const cx = launchPoint.x + sp.x * ppm;
        const cy = launchPoint.y - sp.y * ppm;
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.strokeStyle = 'rgba(34,197,94,0.95)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (video.framerate > 0) {
        const t = (video.currentFrame - launchPoint.frame) / video.framerate;
        const pos = interpSimAtTime(simPts, t, SIM_DT);
        if (pos) {
          const mx = launchPoint.x + pos.x * ppm;
          const my = launchPoint.y - pos.y * ppm;
          ctx.beginPath();
          ctx.arc(mx, my, 10, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(34,197,94,0.95)';
          ctx.fill();
          ctx.strokeStyle = 'black';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }
    }

    const s = video.meterstick;
    const rx = s.x + s.length;
    const isHovered = hoveredZone !== null || draggingZone !== null;
    const stickColor = stickSelected ? '#fef08a' : isHovered ? '#fde68a' : '#fbbf24';
    const stickWidth = stickSelected || isHovered ? 4 : 3;
    if (stickSelected) {
      ctx.beginPath();
      ctx.rect(s.x - 6, s.y - 16, s.length + 12, 32);
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(rx, s.y);
    ctx.strokeStyle = stickColor;
    ctx.lineWidth = stickWidth; ctx.stroke();
    const capH = 18;
    [s.x, rx].forEach((ex) => {
      ctx.beginPath(); ctx.arc(ex, s.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = stickColor; ctx.fill();
      ctx.strokeStyle = 'white'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, s.y - capH / 2); ctx.lineTo(ex, s.y + capH / 2);
      ctx.strokeStyle = stickColor;
      ctx.lineWidth = stickWidth; ctx.stroke();
    });
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = stickColor;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
    ctx.fillText('1 m', s.x + s.length / 2, s.y - 12);
    ctx.shadowBlur = 0;
  }, [video, hoveredZone, draggingZone, stickSelected, visibleSegments, averagePoints, showTrajectoryPoints, launchPoint, launchParams]);

  useEffect(() => { drawRef.current = draw; draw(); }, [draw]);

  const cursor = (isPanning || draggingZone) ? 'grabbing'
    : plottingMode ? 'crosshair'
    : 'default';

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full outline-none">
      <div ref={containerRef} className="relative flex-1 bg-black overflow-hidden">
        <div
          className="absolute inset-0 w-full h-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
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
      </div>

      <div className="relative bg-gray-900 border-t border-gray-700 flex-shrink-0 px-4 py-3">
        <div
          className="relative px-2 py-2 cursor-pointer select-none"
          onMouseDown={handleScrubMouseDown}
        >
          <div
            ref={scrubTrackRef}
            className="relative h-2.5 bg-gray-700 rounded-full overflow-hidden"
          >
            {segments.map((seg) => {
              const { left, width } = scrubSegmentStyle(seg.frameStart, seg.frameEnd, totalFrames);
              const isActive = activeScrubSegment?.id === seg.id;
              return (
                <div
                  key={seg.id}
                  className="absolute top-0 h-full pointer-events-none transition-opacity"
                  style={{
                    left,
                    width,
                    backgroundColor: seg.color,
                    opacity: isActive ? 1 : 0.85,
                  }}
                  title={`${seg.name} · frames ${seg.frameStart + 1}–${seg.frameEnd + 1}`}
                />
              );
            })}
            {segments.flatMap((seg) =>
              seg.points.filter(isSkippedPoint).map((pt) => {
                const { left, width } = scrubSegmentStyle(pt.frame, pt.frame, totalFrames);
                const isActive = activeScrubSegment?.id === seg.id;
                return (
                  <div
                    key={`${seg.id}-skip-${pt.frame}`}
                    className="absolute top-0 h-full pointer-events-none"
                    style={{
                      left,
                      width,
                      backgroundColor: darkenHex(seg.color, 0.45),
                      opacity: isActive ? 1 : 0.9,
                      zIndex: 1,
                    }}
                    title={`${seg.name} · frame ${pt.frame + 1} skipped`}
                  />
                );
              })
            )}
          </div>
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md border-2 border-gray-900 -translate-x-1/2 z-10 pointer-events-none"
            style={{ left: `calc(0.5rem + (100% - 1rem) * ${progressPercent / 100})` }}
          />
        </div>
        <div className="flex items-center justify-center gap-3 mt-2">
          <button
            onMouseDown={(e) => { e.preventDefault(); onStartFrameHold(-1); }}
            onMouseUp={onStopFrameHold}
            onMouseLeave={onStopFrameHold}
            className="p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors select-none"
            title="Previous frame (←)"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-xs text-gray-400 font-mono tabular-nums min-w-[7rem] text-center">
            Frame {video.currentFrame + 1} / {totalFrames}
            {video.trajectory.some((p) => p.frame === video.currentFrame && p.skipped) && (
              <span className="text-gray-500 ml-1">· skipped</span>
            )}
          </span>
          <button
            onMouseDown={(e) => { e.preventDefault(); onStartFrameHold(1); }}
            onMouseUp={onStopFrameHold}
            onMouseLeave={onStopFrameHold}
            className="p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors select-none"
            title="Next frame (→)"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <span className="absolute bottom-3 right-4 text-xs text-gray-500 font-mono tabular-nums pointer-events-none">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}
