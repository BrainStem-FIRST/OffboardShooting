import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface DualAxisPoint {
  dx: number;
  left: number;
  right: number;
}

export interface DualAxisDistanceChartProps {
  points: DualAxisPoint[];
  leftLegend: string;
  rightLegend: string;
  leftAxisTitle: string;
  rightAxisTitle: string;
  xAxisTitle?: string;
  leftColor?: string;
  rightColor?: string;
  /** Scale y axes from 0 to max instead of auto min/max. */
  yAxisFromZero?: boolean;
  /** Dashed zero line on the left axis when the range spans zero. */
  showZeroLine?: boolean;
  emptyMessage?: ReactNode;
  renderTooltip?: (point: DualAxisPoint) => ReactNode;
}

interface PlotLayout {
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  plotW: number;
  plotH: number;
  xMin: number;
  xMax: number;
}

export const DUAL_AXIS_LEFT_COLOR = '#60a5fa';
export const DUAL_AXIS_RIGHT_COLOR = '#34d399';

function niceStep(range: number, targetTicks: number): number {
  if (range <= 0) return 1;
  const rough = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function axisRange(values: number[], fromZero: boolean): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  if (fromZero) {
    const max = Math.max(...values, 0.001);
    const step = niceStep(max, 5);
    return { min: 0, max: Math.ceil(max / step) * step || step };
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 0.01);
    min -= pad;
    max += pad;
  }
  const step = niceStep(max - min, 5);
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step || step,
  };
}

function xDomain(points: DualAxisPoint[]): { xMin: number; xMax: number } {
  const dxMin = points[0].dx;
  const dxMax = points[points.length - 1].dx;
  const dxPad = dxMax === dxMin ? 0.5 : (dxMax - dxMin) * 0.05;
  return { xMin: dxMin - dxPad, xMax: dxMax + dxPad };
}

export default function DualAxisDistanceChart({
  points,
  leftLegend,
  rightLegend,
  leftAxisTitle,
  rightAxisTitle,
  xAxisTitle = 'Distance from goal (m)',
  leftColor = DUAL_AXIS_LEFT_COLOR,
  rightColor = DUAL_AXIS_RIGHT_COLOR,
  yAxisFromZero = false,
  showZeroLine = false,
  emptyMessage,
  renderTooltip,
}: DualAxisDistanceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<PlotLayout | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 76;
    const padR = 76;
    const padT = 48;
    const padB = 52;
    const plotW = Math.max(1, cssW - padL - padR);
    const plotH = Math.max(1, cssH - padT - padB);

    if (points.length === 0) return;

    const { xMin, xMax } = xDomain(points);
    layoutRef.current = { padL, padR, padT, padB, plotW, plotH, xMin, xMax };

    const leftRange = axisRange(
      points.map((p) => p.left),
      yAxisFromZero,
    );
    const rightRange = axisRange(
      points.map((p) => p.right),
      yAxisFromZero,
    );
    const leftStep = niceStep(leftRange.max - leftRange.min, 5);
    const rightStep = niceStep(rightRange.max - rightRange.min, 5);

    const toX = (dx: number) => padL + ((dx - xMin) / (xMax - xMin)) * plotW;
    const toLeftY = (v: number) =>
      padT + plotH - ((v - leftRange.min) / (leftRange.max - leftRange.min)) * plotH;
    const toRightY = (v: number) =>
      padT + plotH - ((v - rightRange.min) / (rightRange.max - rightRange.min)) * plotH;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui';
    ctx.fillStyle = 'rgba(156,163,175,0.75)';
    ctx.textBaseline = 'middle';

    for (let v = leftRange.min; v <= leftRange.max + leftStep * 0.001; v += leftStep) {
      const y = toLeftY(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(formatTick(v), padL - 12, y);
    }

    for (let v = rightRange.min; v <= rightRange.max + rightStep * 0.001; v += rightStep) {
      const y = toRightY(v);
      ctx.textAlign = 'left';
      ctx.fillText(formatTick(v), padL + plotW + 12, y);
    }

    const xStep = niceStep(xMax - xMin, 6);
    const xTick0 = Math.ceil(xMin / xStep) * xStep;
    ctx.textBaseline = 'top';
    for (let x = xTick0; x <= xMax + xStep * 0.001; x += xStep) {
      const sx = toX(x);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(sx, padT);
      ctx.lineTo(sx, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = 'rgba(156,163,175,0.75)';
      ctx.textAlign = 'center';
      ctx.fillText(formatTick(x), sx, padT + plotH + 8);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.lineTo(padL + plotW, padT);
    ctx.stroke();

    if (showZeroLine && leftRange.min <= 0 && leftRange.max >= 0) {
      const zy = toLeftY(0);
      ctx.strokeStyle = `${leftColor}40`;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, zy);
      ctx.lineTo(padL + plotW, zy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const drawSeries = (color: string, toY: (v: number) => number, key: 'left' | 'right') => {
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = toX(p.dx);
        const y = toY(p[key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const x = toX(p.dx);
        const y = toY(p[key]);
        const hovered = hoverIdx === i;
        ctx.beginPath();
        ctx.arc(x, y, hovered ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (hovered) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    };

    drawSeries(leftColor, toLeftY, 'left');
    drawSeries(rightColor, toRightY, 'right');

    ctx.font = '12px system-ui';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = leftColor;
    ctx.textAlign = 'left';
    ctx.fillText(leftLegend, padL, 16);
    ctx.fillStyle = rightColor;
    ctx.textAlign = 'right';
    ctx.fillText(rightLegend, padL + plotW, 16);

    ctx.save();
    ctx.translate(28, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(156,163,175,0.85)';
    ctx.font = '11px system-ui';
    ctx.fillText(leftAxisTitle, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(cssW - 28, padT + plotH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(156,163,175,0.85)';
    ctx.font = '11px system-ui';
    ctx.fillText(rightAxisTitle, 0, 0);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(156,163,175,0.85)';
    ctx.font = '11px system-ui';
    ctx.fillText(xAxisTitle, padL + plotW / 2, cssH - 6);
  }, [
    points,
    hoverIdx,
    leftLegend,
    rightLegend,
    leftAxisTitle,
    rightAxisTitle,
    xAxisTitle,
    leftColor,
    rightColor,
    yAxisFromZero,
    showZeroLine,
  ]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const layout = layoutRef.current;
      const canvas = canvasRef.current;
      if (!layout || !canvas || points.length === 0) {
        setHoverIdx(null);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (
        mx < layout.padL ||
        mx > layout.padL + layout.plotW ||
        my < layout.padT ||
        my > layout.padT + layout.plotH
      ) {
        setHoverIdx(null);
        return;
      }

      const plotDx =
        layout.xMin + ((mx - layout.padL) / layout.plotW) * (layout.xMax - layout.xMin);

      let bestIdx = 0;
      let bestDist = Math.abs(points[0].dx - plotDx);
      for (let i = 1; i < points.length; i++) {
        const d = Math.abs(points[i].dx - plotDx);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      setHoverIdx(bestIdx);
    },
    [points],
  );

  const handleMouseLeave = useCallback(() => setHoverIdx(null), []);

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500 px-6 text-center leading-relaxed">
        {emptyMessage ?? 'No data to display.'}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full p-5 box-border">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {hoverPoint && renderTooltip && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none px-3 py-2 rounded bg-gray-900 border border-gray-600 text-xs shadow-lg tabular-nums space-y-0.5">
          {renderTooltip(hoverPoint)}
        </div>
      )}
    </div>
  );
}
