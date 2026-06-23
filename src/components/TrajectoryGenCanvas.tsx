import { useEffect, useRef, useCallback } from 'react';
import { TrajGenParams, TrajGroup } from '../types';
import { simulateShot, SIM_MAX_TIME, SIM_DT } from '../simulation';

interface Props {
  params: TrajGenParams;
  groups: TrajGroup[];
  selectedGroupId: string | null;
  selectedId: string | null;
  hoveredId: string | null;
}

interface View {
  panX: number;
  panY: number;
  zoom: number;
}

const INIT_ZOOM = 80;

export default function TrajectoryGenCanvas({ params, groups, selectedGroupId, selectedId, hoveredId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ panX: -1, panY: -2, zoom: INIT_ZOOM });
  const draggingRef = useRef<{ lastX: number; lastY: number } | null>(null);

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

    // Ground line
    const [, groundY] = toS(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(cssW, groundY); ctx.stroke();
    ctx.setLineDash([]);

    // Compute all dx values from slider
    const dxValues: number[] = [];
    let dxCursor = params.dxMin;
    while (dxCursor <= params.dxMax + 1e-9) {
      dxValues.push(Math.round(dxCursor * 1e6) / 1e6);
      dxCursor = Math.round((dxCursor + params.dxStep) * 1e6) / 1e6;
    }

    const selectedGroup = groups.find(g => g.id === selectedGroupId) ?? null;

    // Draw ghost dx/dy lines and ghost goals for all dx values
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

    // Draw ghost goals for non-selected dx values
    for (const dx of dxValues) {
      const isSelected = selectedGroup ? Math.abs(selectedGroup.dx - dx) < 1e-6 : false;
      if (isSelected) continue;
      const dy = params.dy;
      const halfGoal = params.goalWidth / 2;
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

    // Draw dx label for selected group
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
      // No groups yet — draw labels from slider params
      const dx0 = dxValues[0];
      const [midSx] = toS(dx0 / 2, 0);
      ctx.fillStyle = 'rgba(156,163,175,0.4)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`dx range: ${params.dxMin.toFixed(2)}–${params.dxMax.toFixed(2)} m`, midSx, groundY + 5);
    }

    // Draw trajectories for selected group only
    const activeTraj = selectedGroup ? selectedGroup.trajectories : [];
    const activeDrag = selectedGroup ? selectedGroup.drag : params.dragCoefficient;
    const activeMagnus = selectedGroup ? selectedGroup.magnus : params.magnusGain;
    const activeMagnusPower = params.magnusPower ?? 2;

    const highlighted = new Set([selectedId, hoveredId].filter(Boolean) as string[]);

    for (const traj of activeTraj) {
      if (highlighted.has(traj.id)) continue;
      const pts = simulateShot(traj.exitVelocity, traj.exitAngle, activeDrag, activeMagnus, SIM_MAX_TIME, SIM_DT, activeMagnusPower);
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

    for (const traj of activeTraj) {
      if (!highlighted.has(traj.id)) continue;
      const isSelected = traj.id === selectedId;
      const pts = simulateShot(traj.exitVelocity, traj.exitAngle, activeDrag, activeMagnus, SIM_MAX_TIME, SIM_DT, activeMagnusPower);
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

    // Active goal (selected group dx/dy, or fallback to first dxValue)
    const activeDx = selectedGroup ? selectedGroup.dx : (dxValues[0] ?? params.dxMin);
    const activeDy = params.dy;
    const halfGoal = params.goalWidth / 2;
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

    // Robot dot
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
  }, [params, groups, selectedGroupId, selectedId, hoveredId]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

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
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
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
