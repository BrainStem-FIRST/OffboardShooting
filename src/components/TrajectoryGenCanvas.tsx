import { useEffect, useRef, useCallback, useState } from 'react';
import { TrajGenParams, TrajGroup, GeneratedTrajectory } from '../types';
import { simulateShot, SIM_MAX_TIME, SIM_DT, enumerateDxValues, resolveMagnusPower, goalPlaneSegment, formatMoeBounds, formatSpeedMoeBounds, type TrajectoryMoe } from '../simulation';

interface Props {
  params: TrajGenParams;
  groups: TrajGroup[];
  selectedGroupId: string | null;
  hoveredId: string | null;
  showAll: boolean;
  showOptimalTrajectories: boolean;
  trajMoeById: Map<string, TrajectoryMoe>;
  bestMoeTrajIds: Set<string>;
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
  dx: number;
  dy: number;
}

interface CanvasTooltip {
  x: number;
  y: number;
  dx: number;
  dy: number;
  exitVelocity: number;
  exitAngle: number;
  timeOfFlight: number;
  speedMoeMinus: number | null;
  speedMoePlus: number | null;
  angleMoeMinus: number | null;
  angleMoePlus: number | null;
}

const INIT_ZOOM = 80;
const HIT_THRESHOLD_PX = 8;
const TRAJ_COLOR = 'rgba(59,130,246,0.3)';
const TRAJ_HOVER_COLOR = '#93c5fd';
const TRAJ_MAX_MOE_COLOR = 'rgba(52, 211, 153, 0.85)';

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

export default function TrajectoryGenCanvas({
  params, groups, selectedGroupId, hoveredId, showAll, showOptimalTrajectories,
  trajMoeById, bestMoeTrajIds, onHoverTraj,
}: Props) {
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

    const dxValues = enumerateDxValues(params.dxMin, params.dxMax, params.dxStep);
    const selectedGroup = groups.find(g => g.id === selectedGroupId) ?? null;
    const goalDy = params.dy;

    // Single goal line at goal height with dots at each distance interval
    if (dxValues.length > 0) {
      const [lineLeftX, lineY] = toS(dxValues[0], goalDy);
      const [lineRightX] = toS(dxValues[dxValues.length - 1], goalDy);

      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lineLeftX, lineY);
      ctx.lineTo(lineRightX, lineY);
      ctx.stroke();
      ctx.lineCap = 'butt';

      for (const dx of dxValues) {
        const isSelected = selectedGroup ? Math.abs(selectedGroup.dx - dx) < 1e-6 : false;
        const [dotX, dotY] = toS(dx, goalDy);
        ctx.beginPath();
        ctx.arc(dotX, dotY, isSelected ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#6ee7b7' : '#34d399';
        ctx.fill();
        if (isSelected) {
          ctx.strokeStyle = '#a7f3d0';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      const [midSx] = toS((dxValues[0] + dxValues[dxValues.length - 1]) / 2, goalDy);
      ctx.fillStyle = 'rgba(156,163,175,0.6)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = goalDy >= 0 ? 'bottom' : 'top';
      const labelOffset = goalDy >= 0 ? -6 : 6;
      ctx.fillText(
        dxValues.length === 1
          ? `goal dx = ${dxValues[0].toFixed(2)} m`
          : `goal dx ${params.dxMin.toFixed(2)}–${params.dxMax.toFixed(2)} m`,
        midSx,
        lineY + labelOffset
      );

      if (Math.abs(goalDy) > 0.01) {
        const [rx] = toS(0, 0);
        const [, gyBase] = toS(0, goalDy);
        ctx.strokeStyle = 'rgba(100,100,100,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(rx, groundY);
        ctx.lineTo(rx, gyBase);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(156,163,175,0.6)';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`dy = ${goalDy > 0 ? '+' : ''}${goalDy.toFixed(2)} m`, rx - 8, (gyBase + groundY) / 2);
      }
    }

    if (params.showGoalPlanes && groups.length > 0) {
      const half = params.errorTolerance / 2;
      const planeGroups = showAll
        ? groups
        : selectedGroup
        ? [selectedGroup]
        : [];

      for (const g of planeGroups) {
        const isSelected = selectedGroup?.id === g.id;
        const seg = goalPlaneSegment(g.dx, g.dy, half, params.goalPlaneAngleDeg);
        const [x1, y1] = toS(seg.x1, seg.y1);
        const [x2, y2] = toS(seg.x2, seg.y2);
        ctx.strokeStyle = isSelected ? 'rgba(251, 191, 36, 0.95)' : 'rgba(251, 191, 36, 0.55)';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }

    const activeMagnusPower = resolveMagnusPower(params.magnusPower);

    type TrajDrawEntry = { traj: GeneratedTrajectory; drag: number; magnus: number; dx: number; dy: number };
    const trajEntries: TrajDrawEntry[] = showOptimalTrajectories
      ? groups.flatMap((g) => {
          const best = g.trajectories.find((t) => bestMoeTrajIds.has(t.id));
          return best ? [{ traj: best, drag: g.drag, magnus: g.magnus, dx: g.dx, dy: g.dy }] : [];
        })
      : showAll
      ? groups.flatMap((g) => g.trajectories.map((traj) => ({ traj, drag: g.drag, magnus: g.magnus, dx: g.dx, dy: g.dy })))
      : (selectedGroup?.trajectories ?? []).map((traj) => ({
          traj,
          drag: selectedGroup!.drag,
          magnus: selectedGroup!.magnus,
          dx: selectedGroup!.dx,
          dy: selectedGroup!.dy,
        }));

    const polylines: HitPolyline[] = [];

    function drawTraj(
      traj: GeneratedTrajectory,
      drag: number,
      magnus: number,
      dx: number,
      dy: number,
      strokeStyle: string,
      lineWidth: number
    ) {
      const simPts = simulateShot(traj.exitVelocity, traj.exitAngle, drag, magnus, SIM_MAX_TIME, SIM_DT, activeMagnusPower);
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
        polylines.push({ id: traj.id, points: screenPts, traj, dx, dy });
      }
    }

    for (const { traj, drag, magnus, dx, dy } of trajEntries) {
      if (traj.id === hoveredId || bestMoeTrajIds.has(traj.id)) continue;
      drawTraj(traj, drag, magnus, dx, dy, TRAJ_COLOR, 1);
    }

    for (const { traj, drag, magnus, dx, dy } of trajEntries) {
      if (bestMoeTrajIds.has(traj.id) && traj.id !== hoveredId) {
        drawTraj(traj, drag, magnus, dx, dy, TRAJ_MAX_MOE_COLOR, 2);
      }
    }

    if (hoveredId) {
      const hovered = trajEntries.find((e) => e.traj.id === hoveredId);
      if (hovered) drawTraj(hovered.traj, hovered.drag, hovered.magnus, hovered.dx, hovered.dy, TRAJ_HOVER_COLOR, 2);
    }

    hitPolylinesRef.current = polylines;

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
  }, [params, groups, selectedGroupId, hoveredId, showAll, showOptimalTrajectories, bestMoeTrajIds]);

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
      const moe = trajMoeById.get(hit.id);
      setTooltip({
        x: clientX - containerRect.left,
        y: clientY - containerRect.top,
        dx: hit.dx,
        dy: hit.dy,
        exitVelocity: hit.traj.exitVelocity,
        exitAngle: hit.traj.exitAngle,
        timeOfFlight: hit.traj.timeOfFlight,
        speedMoeMinus: moe?.speedMoeMinus ?? null,
        speedMoePlus: moe?.speedMoePlus ?? null,
        angleMoeMinus: moe?.angleMoeMinus ?? null,
        angleMoePlus: moe?.angleMoePlus ?? null,
      });
    } else {
      setTooltip(null);
    }
  }, [onHoverTraj, trajMoeById]);

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
          <div className="text-gray-300">
            Goal <span className="text-white font-mono">({tooltip.dx.toFixed(3)}, {tooltip.dy.toFixed(3)}) m</span>
          </div>
          <div className="text-gray-300">
            Speed <span className="text-white font-mono">{tooltip.exitVelocity.toFixed(3)} m/s</span>
            {tooltip.speedMoeMinus !== null && tooltip.speedMoePlus !== null && (
              <span className="text-gray-500 font-mono">
                {' '}{formatSpeedMoeBounds({ speedMoeMinus: tooltip.speedMoeMinus, speedMoePlus: tooltip.speedMoePlus })}
              </span>
            )}
          </div>
          <div className="text-gray-300">
            Exit angle <span className="text-white font-mono">{tooltip.exitAngle.toFixed(2)}°</span>
            {tooltip.angleMoeMinus !== null && tooltip.angleMoePlus !== null && (
              <span className="text-gray-500 font-mono">
                {' '}{formatMoeBounds(tooltip.angleMoeMinus, tooltip.angleMoePlus, 2, '°')}
              </span>
            )}
          </div>
          <div className="text-gray-300">ToF <span className="text-white font-mono">{tooltip.timeOfFlight.toFixed(3)} s</span></div>
        </div>
      )}
    </div>
  );
}
