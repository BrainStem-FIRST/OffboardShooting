import { useEffect, useRef, useCallback } from 'react';
import { GeneratedTrajectory, TrajGenParams } from '../types';
import { simulateShot } from '../simulation';

interface Props {
  params: TrajGenParams;
  trajectories: GeneratedTrajectory[];
  selectedId: string | null;
  hoveredId: string | null;
  drag: number;
  magnus: number;
}

// World-to-screen transform: pan offset in world coords, zoom in px/m
interface View {
  panX: number; // world-x at left edge
  panY: number; // world-y at top edge
  zoom: number; // px per meter
}

const INIT_ZOOM = 80; // px/m default

export default function TrajectoryGenCanvas({ params, trajectories, selectedId, hoveredId, drag, magnus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ panX: -1, panY: -2, zoom: INIT_ZOOM });
  const draggingRef = useRef<{ lastX: number; lastY: number } | null>(null);

  // Convert world coords to canvas CSS pixels
  function worldToCanvas(wx: number, wy: number, view: View, cssW: number, cssH: number): [number, number] {
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

    // Resize backing buffer if needed
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const view = viewRef.current;

    ctx.clearRect(0, 0, cssW, cssH);

    function toS(wx: number, wy: number): [number, number] {
      return worldToCanvas(wx, wy, view, cssW, cssH);
    }

    // Background grid — adaptive spacing so lines are always 40–400px apart
    const worldXMin = view.panX;
    const worldXMax = view.panX + cssW / view.zoom;
    const worldYMin = view.panY;
    const worldYMax = view.panY + cssH / view.zoom;

    // Pick the coarsest power-of-10 spacing whose screen size is >= 40px,
    // then use 1/10 of that as the fine grid if it would also be >= 40px.
    const minPxGap = 40;
    const exp = Math.ceil(Math.log10(minPxGap / view.zoom));
    const coarseSpacing = Math.pow(10, exp);      // e.g. 1, 10, 0.1 …
    const fineSpacing = coarseSpacing / 10;        // one decade finer
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

    // Ground line at y=0
    const [, groundY] = toS(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(cssW, groundY); ctx.stroke();
    ctx.setLineDash([]);

    // Dotted dx line (horizontal, robot to goal base)
    const [rx] = toS(0, 0);
    const [gxBase, gyBase] = toS(params.dx, 0);
    const [, robotY] = toS(0, 0);
    ctx.strokeStyle = 'rgba(150,150,150,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(rx, robotY);
    ctx.lineTo(gxBase, robotY);
    ctx.stroke();

    // Dotted dy line (vertical, from goal base to goal)
    if (Math.abs(params.dy) > 0.01) {
      const [goalX, goalY] = toS(params.dx, params.dy);
      ctx.beginPath();
      ctx.moveTo(gxBase, gyBase);
      ctx.lineTo(goalX, goalY);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // dx label
    {
      const [midSx] = toS(params.dx / 2, 0);
      ctx.fillStyle = 'rgba(156,163,175,0.6)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`dx = ${params.dx.toFixed(2)} m`, midSx, groundY + 5);
    }

    // dy label
    if (Math.abs(params.dy) > 0.01) {
      const [gxGoal, gyGoal] = toS(params.dx, params.dy);
      ctx.fillStyle = 'rgba(156,163,175,0.6)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`dy = ${params.dy > 0 ? '+' : ''}${params.dy.toFixed(2)} m`, gxGoal - 8, (gyGoal + groundY) / 2);
    }

    // Draw all trajectories — faded first, then highlighted on top
    const highlighted = new Set([selectedId, hoveredId].filter(Boolean) as string[]);

    for (const traj of trajectories) {
      if (highlighted.has(traj.id)) continue;
      const pts = simulateShot(traj.exitVelocity, traj.exitAngle, drag, magnus);
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        const [sx, sy] = toS(p.x, p.y);
        if (!started) { ctx.moveTo(sx, sy); started = true; }
        else ctx.lineTo(sx, sy);
        if (p.x > worldXMax + 1) break;
      }
      ctx.strokeStyle = 'rgba(59,130,246,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw highlighted trajectories on top
    for (const traj of trajectories) {
      if (!highlighted.has(traj.id)) continue;
      const isSelected = traj.id === selectedId;
      const pts = simulateShot(traj.exitVelocity, traj.exitAngle, drag, magnus);
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        const [sx, sy] = toS(p.x, p.y);
        if (!started) { ctx.moveTo(sx, sy); started = true; }
        else ctx.lineTo(sx, sy);
        if (p.x > worldXMax + 1) break;
      }
      ctx.strokeStyle = isSelected ? 'rgba(251,191,36,0.95)' : 'rgba(253,224,71,0.6)';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.stroke();
    }

    // Goal line: horizontal line representing goal width (centered at dx, dy)
    const halfGoal = params.goalWidth / 2;
    const [gxGoal, gyGoal] = toS(params.dx, params.dy);
    const [gxLeft] = toS(params.dx - halfGoal, params.dy);
    const [gxRight] = toS(params.dx + halfGoal, params.dy);

    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(gxLeft, gyGoal);
    ctx.lineTo(gxRight, gyGoal);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Goal center dot
    ctx.beginPath();
    ctx.arc(gxGoal, gyGoal, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#34d399';
    ctx.fill();

    // Goal label
    ctx.fillStyle = '#6ee7b7';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('goal', gxGoal + 8, gyGoal);

    // Robot dot at (0, 0)
    const [rdx, rdy] = toS(0, 0);
    ctx.beginPath();
    ctx.arc(rdx, rdy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#60a5fa';
    ctx.fill();
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Robot label beneath dot
    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('exit position', rdx, rdy + 8);
  }, [params, trajectories, selectedId, hoveredId, drag, magnus]);

  // Redraw whenever props change
  useEffect(() => {
    draw();
  }, [draw]);

  // Handle resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // Scroll to zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const cssH = canvas.clientHeight;
    const view = viewRef.current;

    // World position under cursor before zoom
    const worldX = view.panX + cssX / view.zoom;
    const worldY = view.panY + (cssH - cssY) / view.zoom;

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(5, Math.min(2000, view.zoom * factor));

    // Adjust pan so world point stays under cursor
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

  // Pan drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = { lastX: e.clientX, lastY: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const view = viewRef.current;
    const dx = e.clientX - draggingRef.current.lastX;
    const dy = e.clientY - draggingRef.current.lastY;
    view.panX -= dx / view.zoom;
    view.panY += dy / view.zoom;
    draggingRef.current = { lastX: e.clientX, lastY: e.clientY };
    draw();
  }, [draw]);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: 'block', cursor: draggingRef.current ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}