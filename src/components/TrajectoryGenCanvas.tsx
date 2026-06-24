import { useEffect, useRef, useCallback, useState } from 'react';
import { TrajGenParams, TrajGroup, GeneratedTrajectory } from '../types';
import { simulateShot, SIM_MAX_TIME, SIM_DT } from '../simulation';

interface Props {
  params: TrajGenParams;
  groups: TrajGroup[];
  selectedGroupId: string | null;
  hoveredId: string | null;
  onHoverTraj: (id: string | null) => void;
}

interface View {
  panX: number;
  panY: number;
  zoom: number;
}

interface HitPolyline {
  id: string;
  points: [number, number][];
  traj: GeneratedTrajectory;
}

interface CanvasTooltip {
  x: number;
  y: number;
  exitVelocity: number;
  exitAngle: number;
  timeOfFlight: number;
}

const INIT_ZOOM = 80;
const HIT_THRESHOLD_PX = 8;
const TRAJ_COLOR = 'rgba(59,130,246,0.3)';
const TRAJ_HOVER_COLOR = '#93c5fd';

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitTestPolylines(polylines: HitPolyline[], mx: number, my: number): HitPolyline | null {
  let best: HitPolyline | null = null;
  let bestDist = HIT_THRESHOLD_PX;
  for (const poly of polylines) {
    const pts = poly.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSegment(mx, my, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < bestDist) {
        bestDist = d;
        best = poly;
      }
    }
  }
  return best;
}

export default function TrajectoryGenCanvas({ params, groups, selectedGroupId, hoveredId, onHoverTraj }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ panX: -1, panY: -2, zoom: INIT_ZOOM });
  const draggingRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const hitPolylinesRef = useRef<HitPolyline[]>([]);
  const [tooltip, setTooltip] = useState<CanvasTooltip | null>(null);

  function worldToCanvas(wx: number, wy: number, view: View, cssH: number): [number, number] {
    const sx = (wx - view.panX) * view.zoom;
    const sy = cssH - (wy - view.panY) * view.zoom;
    return [sx, sy];
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;

    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = viewRef.current;
    ctx.clearRect(0, 0, cssW, cssH);

    function toS(wx: number, wy: number): [number, number] {
      return worldToCanvas(wx, wy, view, cssH);
    }

    const worldXMin = view.panX;
    const worldXMax = view.panX + cssW / view.zoom;
    const worldYMin = view.panY;
    const worldYMax = view.panY + cssH / view.zoom;

    const minPxGap = 40;
    const exp = Math.ceil(Math.log10(minPxGap / view.zoom));
    const coarseSpacing = Math.pow(10, exp);
    const fineSpacing = coarseSpacing / 10;
    const finePxGap = fineSpacing * view.zoom;

    function drawGridLines(spacing: number, alpha: number) {
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1;
      const x0 = Math.ceil(worldXMin / spacing) * spacing;
      const y0 = Math.ceil(worldYMin / spacing) * spacing;
      for (let gx = x0; gx <= worldXMax; gx += spacing) {
        const [sx] = toS(gx, 0);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, cssH); ctx.stroke();
      }
      for (let gy = y0; gy <= worldYMax; gy += spacing) {
        const [, sy] = toS(0, gy);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(cssW, sy); ctx.stroke();
      }
    }

    if (finePxGap >= minPxGap) drawGridLines(fineSpacing, 0.04);
    drawGridLines(coarseSpacing, 0.10);

    const [, groundY] = toS(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(cssW, groundY); ctx.stroke();
    ctx.setLineDash([]);

    const dxValues: number[] = [];
    let dxCursor = params.dxMin;
    while (dxCursor <= params.dxMax + 1e-9) {
      dxValues.push(Math.round(dxCursor * 1e6) / 1e6);
      dxCursor = Math.round((dxCursor + params.dxStep) * 1e6) / 1e6;
    }

    const selectedGroup = groups.find(g => g.id === selectedGroupId) ?? null;

    for (const dx of dxValues) {
      const isSelected = selectedGroup ? Math.abs(selectedGroup.dx - dx) < 1e-6 : false;
      const [rx] = toS(0, 0);
      const [gxBase, gyBase] = toS(dx, 0);
      const dy = params.dy;

      ctx.strokeStyle = isSelected ? 'rgba(150,150,150,0.5)' : 'rgba(100,100,100,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(rx, groundY);
      ctx.lineTo(gxBase, groundY);
      ctx.stroke();

      if (Math.abs(dy) > 0.01) {
        const [goalX, goalY] = toS(dx, dy);
        ctx.beginPath();
        ctx.moveTo(gxBase, gyBase);
        ctx.lineTo(goalX, goalY);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    for (const dx of dxValues) {
      const isSelected = selectedGroup ? Math.abs(selectedGroup.dx - dx) < 1e-6 : false;
      if (isSelected) continue;
      const dy = params.dy;
      const halfGoal = params.errorTolerance / 2;
      const [gxGoal, gyGoal] = toS(dx, dy);
      const [gxLeft] = toS(dx - halfGoal, dy);
      const [gxRight] = toS(dx + halfGoal, dy);
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.2)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(gxLeft, gyGoal);
      ctx.lineTo(gxRight, gyGoal);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(gxGoal, gyGoal, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(52, 211, 153, 0.2)';
      ctx.fill();
      ctx.lineCap = 'butt';
    }

    if (selectedGroup) {
      const [midSx] = toS(selectedGroup.dx / 2, 0);
      ctx.fillStyle = 'rgba(156,163,175,0.6)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`dx = ${selectedGroup.dx.toFixed(2)} m`, midSx, groundY + 5);

      if (Math.abs(params.dy) > 0.01) {
        const [gxGoal, gyGoal] = toS(selectedGroup.dx, params.dy);
        ctx.fillStyle = 'rgba(156,163,175,0.6)';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`dy = ${params.dy > 0 ? '+' : ''}${params.dy.toFixed(2)} m`, gxGoal - 8, (gyGoal + groundY) / 2);
      }
    } else if (dxValues.length > 0) {
      const dx0 = dxValues[0];
      const [midSx] = toS(dx0 / 2, 0);
      ctx.fillStyle = 'rgba(156,163,175,0.4)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`dx range: ${params.dxMin.toFixed(2)}–${params.dxMax.toFixed(2)} m`, midSx, groundY + 5);
    }

    const activeTraj = selectedGroup ? selectedGroup.trajectories : [];
    const activeDrag = selectedGroup ? selectedGroup.drag : params.dragCoefficient;
    const activeMagnus = selectedGroup ? selectedGroup.magnus : params.magnusGain;
    const activeMagnusPower = params.magnusPower ?? 2;

    const polylines: HitPolyline[] = [];

    function drawTraj(traj: GeneratedTrajectory, strokeStyle: string, lineWidth: number) {
      const simPts = simulateShot(traj.exitVelocity, traj.exitAngle, activeDrag, activeMagnus, SIM_MAX_TIME, SIM_DT, activeMagnusPower);
      const screenPts: [number, number][] = [];
      ctx.beginPath();
      let started = false;
      for (const p of simPts) {
        const [sx, sy] = toS(p.x, p.y);
        screenPts.push([sx, sy]);
        if (!started) { ctx.moveTo(sx, sy); started = true; }
        else ctx.lineTo(sx, sy);
        if (p.x > worldXMax + 1) break;
      }
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      if (screenPts.length >= 2) {
        polylines.push({ id: traj.id, points: screenPts, traj });
      }
    }

    for (const traj of activeTraj) {
      if (traj.id === hoveredId) continue;
      drawTraj(traj, TRAJ_COLOR, 1);
    }

    if (hoveredId) {
      const hovered = activeTraj.find(t => t.id === hoveredId);
      if (hovered) drawTraj(hovered, TRAJ_HOVER_COLOR, 2);
    }

    hitPolylinesRef.current = polylines;

    const activeDx = selectedGroup ? selectedGroup.dx : (dxValues[0] ?? params.dxMin);
    const activeDy = params.dy;
    const halfGoal = params.errorTolerance / 2;
    const [gxGoal, gyGoal] = toS(activeDx, activeDy);
    const [gxLeft] = toS(activeDx - halfGoal, activeDy);
    const [gxRight] = toS(activeDx + halfGoal, activeDy);

    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(gxLeft, gyGoal);
    ctx.lineTo(gxRight, gyGoal);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.beginPath();
    ctx.arc(gxGoal, gyGoal, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#34d399';
    ctx.fill();

    ctx.fillStyle = '#6ee7b7';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('goal', gxGoal + 8, gyGoal);

    const [rdx, rdy] = toS(0, 0);
    ctx.beginPath();
    ctx.arc(rdx, rdy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#60a5fa';
    ctx.fill();
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('exit position', rdx, rdy + 8);
  }, [params, groups, selectedGroupId, hoveredId]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const updateCanvasHover = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const hit = hitTestPolylines(hitPolylinesRef.current, mx, my);

    onHoverTraj(hit?.id ?? null);

    if (hit) {
      const containerRect = container.getBoundingClientRect();
      setTooltip({
        x: clientX - containerRect.left,
        y: clientY - containerRect.top,
        exitVelocity: hit.traj.exitVelocity,
        exitAngle: hit.traj.exitAngle,
        timeOfFlight: hit.traj.timeOfFlight,
      });
    } else {
      setTooltip(null);
    }
  }, [onHoverTraj]);

  const clearCanvasHover = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const cssH = canvas.clientHeight;
    const view = viewRef.current;

    const worldX = view.panX + cssX / view.zoom;
    const worldY = view.panY + (cssH - cssY) / view.zoom;

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(5, Math.min(2000, view.zoom * factor));

    view.panX = worldX - cssX / newZoom;
    view.panY = worldY - (cssH - cssY) / newZoom;
    view.zoom = newZoom;

    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = { lastX: e.clientX, lastY: e.clientY };
    setTooltip(null);
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingRef.current) {
      const view = viewRef.current;
      const dx = e.clientX - draggingRef.current.lastX;
      const dy = e.clientY - draggingRef.current.lastY;
      view.panX -= dx / view.zoom;
      view.panY += dy / view.zoom;
      draggingRef.current = { lastX: e.clientX, lastY: e.clientY };
      draw();
      return;
    }
    updateCanvasHover(e.clientX, e.clientY);
  }, [draw, updateCanvasHover]);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    draggingRef.current = null;
    clearCanvasHover();
    onHoverTraj(null);
  }, [clearCanvasHover, onHoverTraj]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: 'block', cursor: draggingRef.current ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none px-2.5 py-1.5 rounded bg-gray-900 border border-gray-600 text-xs shadow-lg tabular-nums space-y-0.5"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="text-gray-300">Speed <span className="text-white font-mono">{tooltip.exitVelocity.toFixed(3)} m/s</span></div>
          <div className="text-gray-300">Exit angle <span className="text-white font-mono">{tooltip.exitAngle.toFixed(2)}°</span></div>
          <div className="text-gray-300">ToF <span className="text-white font-mono">{tooltip.timeOfFlight.toFixed(3)} s</span></div>
        </div>
      )}
    </div>
  );
}
