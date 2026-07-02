import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface DualAxisPoint {
  dx: number;
  left: number;
  right: number;
  /** Optional second series on the left y-axis (e.g. speed MOE upper bound). */
  leftExtra?: number;
  groupId?: string;
  trajId?: string;
  velocityBuffer?: number;
}

export interface DualAxisRangeBar {
  dx: number;
  leftMin?: number;
  leftMax?: number;
  rightMin?: number;
  rightMax?: number;
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
  /** Legend and color for optional second left-axis series. */
  leftExtraLegend?: string;
  leftExtraColor?: string;
  /** Scale y axes from 0 to max instead of auto min/max. */
  yAxisFromZero?: boolean;
  /** Dashed zero line on the left axis when the range spans zero. */
  showZeroLine?: boolean;
  /** Render only the left y-axis and left series. */
  hideRightAxis?: boolean;
  rangeBars?: DualAxisRangeBar[];
  overlayLine?: { x1: number; y1: number; x2: number; y2: number; color?: string };
  onOverlayLineChange?: (line: { x1: number; y1: number; x2: number; y2: number }) => void;
  dragCandidates?: DualAxisPoint[];
  onPointDragCommit?: (point: DualAxisPoint) => void;
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
export const DUAL_AXIS_LEFT_EXTRA_COLOR = '#93c5fd';
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

/** Scale fonts, points, and margins with chart height (reference ~280px plot area). */
function chartUiScale(cssH: number): number {
  return Math.max(1, Math.min(2.5, cssH / 280));
}

function chartPadding(_cssH: number, uiScale: number) {
  return {
    padL: Math.round(58 * uiScale),
    padR: Math.round(58 * uiScale),
    padT: Math.round(40 * uiScale),
    padB: Math.round(44 * uiScale),
    tickGap: Math.round(10 * uiScale),
    legendY: Math.round(14 * uiScale),
    axisTitleInset: Math.round(24 * uiScale),
    xTitleBottom: Math.round(6 * uiScale),
  };
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
  leftExtraLegend,
  leftExtraColor = DUAL_AXIS_LEFT_EXTRA_COLOR,
  yAxisFromZero = false,
  showZeroLine = false,
  hideRightAxis = false,
  rangeBars = [],
  overlayLine,
  onOverlayLineChange,
  dragCandidates,
  onPointDragCommit,
  emptyMessage,
  renderTooltip,
}: DualAxisDistanceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<PlotLayout | null>(null);
  const rangesRef = useRef<{
    leftMin: number;
    leftMax: number;
    rightMin: number;
    rightMax: number;
    xMin: number;
    xMax: number;
    padL: number;
    padT: number;
    plotW: number;
    plotH: number;
  } | null>(null);
  const dragHandleRef = useRef<1 | 2 | null>(null);
  const pointDragRef = useRef<{
    pointerId: number;
    sourceDx: number;
    series: 'left' | 'right';
    point: DualAxisPoint;
  } | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [dragPoint, setDragPoint] = useState<DualAxisPoint | null>(null);

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

    const uiScale = chartUiScale(cssH);
    const pad = chartPadding(cssH, uiScale);
    const { padL, padT, padB } = pad;
    const padR = hideRightAxis ? Math.round(22 * uiScale) : pad.padR;
    const tickFont = `${Math.round(11 * uiScale)}px system-ui`;
    const legendFont = `${Math.round(12 * uiScale)}px system-ui`;
    const axisTitleFont = `${Math.round(11 * uiScale)}px system-ui`;
    const pointRadius = 3.5 * uiScale;
    const pointRadiusHover = 5 * uiScale;
    const seriesLineWidth = 2 * uiScale;
    const gridLineWidth = 1 * uiScale;
    const axisLineWidth = 1 * uiScale;
    const plotW = Math.max(1, cssW - padL - padR);
    const plotH = Math.max(1, cssH - padT - padB);

    if (points.length === 0) return;

    const { xMin, xMax } = xDomain(points);
    layoutRef.current = { padL, padR, padT, padB, plotW, plotH, xMin, xMax };

    const hasLeftExtra = points.some((p) => p.leftExtra !== undefined);
    const leftValues = points.flatMap((p) =>
      p.leftExtra !== undefined ? [p.left, p.leftExtra] : [p.left],
    );
    for (const bar of rangeBars) {
      if (bar.leftMin !== undefined) leftValues.push(bar.leftMin);
      if (bar.leftMax !== undefined) leftValues.push(bar.leftMax);
    }
    if (overlayLine) leftValues.push(overlayLine.y1, overlayLine.y2);
    const leftRange = axisRange(leftValues, yAxisFromZero);
    const rightRange = axisRange(
      [
        ...points.map((p) => p.right),
        ...rangeBars.flatMap((bar) => [
          ...(bar.rightMin !== undefined ? [bar.rightMin] : []),
          ...(bar.rightMax !== undefined ? [bar.rightMax] : []),
        ]),
      ],
      yAxisFromZero,
    );
    const leftStep = niceStep(leftRange.max - leftRange.min, 5);
    const rightStep = niceStep(rightRange.max - rightRange.min, 5);

    const toX = (dx: number) => padL + ((dx - xMin) / (xMax - xMin)) * plotW;
    const toLeftY = (v: number) =>
      padT + plotH - ((v - leftRange.min) / (leftRange.max - leftRange.min)) * plotH;
    const toRightY = (v: number) =>
      padT + plotH - ((v - rightRange.min) / (rightRange.max - rightRange.min)) * plotH;
    rangesRef.current = {
      leftMin: leftRange.min,
      leftMax: leftRange.max,
      rightMin: rightRange.min,
      rightMax: rightRange.max,
      xMin,
      xMax,
      padL,
      padT,
      plotW,
      plotH,
    };

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = gridLineWidth;
    ctx.font = tickFont;
    ctx.fillStyle = 'rgba(156,163,175,0.75)';
    ctx.textBaseline = 'middle';

    for (let v = leftRange.min; v <= leftRange.max + leftStep * 0.001; v += leftStep) {
      const y = toLeftY(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(formatTick(v), padL - pad.tickGap, y);
    }

    if (!hideRightAxis) {
      for (let v = rightRange.min; v <= rightRange.max + rightStep * 0.001; v += rightStep) {
        const y = toRightY(v);
        ctx.textAlign = 'left';
        ctx.fillText(formatTick(v), padL + plotW + pad.tickGap, y);
      }
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
      ctx.fillText(formatTick(x), sx, padT + plotH + pad.tickGap);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = axisLineWidth;
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

    const drawSeries = (color: string, toY: (v: number) => number, key: 'left' | 'right' | 'leftExtra') => {
      ctx.lineWidth = seriesLineWidth;
      ctx.strokeStyle = color;
      ctx.beginPath();
      let started = false;
      points.forEach((p) => {
        const v = key === 'leftExtra' ? p.leftExtra : p[key];
        if (v === undefined) return;
        const x = toX(p.dx);
        const y = toY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const v = key === 'leftExtra' ? p.leftExtra : p[key];
        if (v === undefined) continue;
        const x = toX(p.dx);
        const y = toY(v);
        const hovered = hoverIdx === i;
        ctx.beginPath();
        ctx.arc(x, y, hovered ? pointRadiusHover : pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (hovered) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5 * uiScale;
          ctx.stroke();
        }
      }
    };

    if (rangeBars.length > 0) {
      ctx.lineWidth = 3 * uiScale;
      ctx.lineCap = 'round';
      for (const bar of rangeBars) {
        const x = toX(bar.dx);
        if (bar.leftMin !== undefined && bar.leftMax !== undefined) {
          ctx.strokeStyle = '#1e3a8a';
          ctx.beginPath();
          ctx.moveTo(x - 2 * uiScale, toLeftY(bar.leftMin));
          ctx.lineTo(x - 2 * uiScale, toLeftY(bar.leftMax));
          ctx.stroke();
        }
        if (!hideRightAxis && bar.rightMin !== undefined && bar.rightMax !== undefined) {
          ctx.strokeStyle = '#14532d';
          ctx.beginPath();
          ctx.moveTo(x + 2 * uiScale, toRightY(bar.rightMin));
          ctx.lineTo(x + 2 * uiScale, toRightY(bar.rightMax));
          ctx.stroke();
        }
      }
      ctx.lineCap = 'butt';
    }

    drawSeries(leftColor, toLeftY, 'left');
    if (hasLeftExtra) {
      drawSeries(leftExtraColor, toLeftY, 'leftExtra');
    }

    if (overlayLine) {
      const color = overlayLine.color ?? '#fbbf24';
      const lx1 = toX(overlayLine.x1);
      const ly1 = toLeftY(overlayLine.y1);
      const lx2 = toX(overlayLine.x2);
      const ly2 = toLeftY(overlayLine.y2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * uiScale;
      ctx.setLineDash([7 * uiScale, 5 * uiScale]);
      ctx.beginPath();
      ctx.moveTo(lx1, ly1);
      ctx.lineTo(lx2, ly2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of [[lx1, ly1], [lx2, ly2]]) {
        ctx.beginPath();
        ctx.arc(x, y, 6 * uiScale, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2 * uiScale;
        ctx.stroke();
      }
    }

    ctx.font = legendFont;
    ctx.textBaseline = 'middle';
    if (hasLeftExtra && leftExtraLegend) {
      ctx.fillStyle = leftColor;
      ctx.textAlign = 'left';
      ctx.fillText(leftLegend, padL, pad.legendY);
      ctx.fillStyle = leftExtraColor;
      ctx.fillText(leftExtraLegend, padL, pad.legendY + Math.round(14 * uiScale));
    } else {
      ctx.fillStyle = leftColor;
      ctx.textAlign = 'left';
      ctx.fillText(leftLegend, padL, pad.legendY);
    }
    if (!hideRightAxis) {
      ctx.fillStyle = rightColor;
      ctx.textAlign = 'right';
      ctx.fillText(rightLegend, padL + plotW, pad.legendY);
    }

    if (!hideRightAxis) {
      drawSeries(rightColor, toRightY, 'right');
    }

    if (dragPoint) {
      const x = toX(dragPoint.dx);
      ctx.lineWidth = 2 * uiScale;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = leftColor;
      ctx.beginPath();
      ctx.arc(x, toLeftY(dragPoint.left), 6 * uiScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (!hideRightAxis) {
        ctx.fillStyle = rightColor;
        ctx.beginPath();
        ctx.arc(x, toRightY(dragPoint.right), 6 * uiScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(pad.axisTitleInset, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(156,163,175,0.85)';
    ctx.font = axisTitleFont;
    ctx.fillText(leftAxisTitle, 0, 0);
    ctx.restore();

    if (!hideRightAxis) {
      ctx.save();
      ctx.translate(cssW - pad.axisTitleInset, padT + plotH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(156,163,175,0.85)';
      ctx.font = axisTitleFont;
      ctx.fillText(rightAxisTitle, 0, 0);
      ctx.restore();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(156,163,175,0.85)';
    ctx.font = axisTitleFont;
    ctx.fillText(xAxisTitle, padL + plotW / 2, cssH - pad.xTitleBottom);
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
    leftExtraLegend,
    leftExtraColor,
    yAxisFromZero,
    showZeroLine,
    hideRightAxis,
    rangeBars,
    overlayLine,
    dragPoint,
  ]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  const dataPointFromMouse = useCallback((e: React.MouseEvent | MouseEvent): { x: number; y: number } | null => {
    const ranges = rangesRef.current;
    const canvas = canvasRef.current;
    if (!ranges || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const xRatio = (mx - ranges.padL) / ranges.plotW;
    const yRatio = (my - ranges.padT) / ranges.plotH;
    return {
      x: ranges.xMin + Math.max(0, Math.min(1, xRatio)) * (ranges.xMax - ranges.xMin),
      y: ranges.leftMax - Math.max(0, Math.min(1, yRatio)) * (ranges.leftMax - ranges.leftMin),
    };
  }, []);

  const pointScreenPosition = useCallback((
    point: DualAxisPoint,
    series: 'left' | 'right',
  ): { x: number; y: number } | null => {
    const ranges = rangesRef.current;
    if (!ranges) return null;
    const x = ranges.padL + ((point.dx - ranges.xMin) / (ranges.xMax - ranges.xMin)) * ranges.plotW;
    const value = series === 'left' ? point.left : point.right;
    const min = series === 'left' ? ranges.leftMin : ranges.rightMin;
    const max = series === 'left' ? ranges.leftMax : ranges.rightMax;
    const y = ranges.padT + ranges.plotH - ((value - min) / (max - min)) * ranges.plotH;
    return { x, y };
  }, []);

  const nearestDragCandidate = useCallback((
    sourceDx: number,
    series: 'left' | 'right',
    clientX: number,
    clientY: number,
  ): DualAxisPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas || !dragCandidates || dragCandidates.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const candidates = dragCandidates.filter((p) => Math.abs(p.dx - sourceDx) <= 1e-9);
    let best: DualAxisPoint | null = null;
    let bestDist = Infinity;
    for (const candidate of candidates) {
      const pos = pointScreenPosition(candidate, series);
      if (!pos) continue;
      const d = Math.hypot(mx - pos.x, my - pos.y);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    return best;
  }, [dragCandidates, pointScreenPosition]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (pointDragRef.current) return;
      if (dragHandleRef.current && overlayLine && onOverlayLineChange) {
        const p = dataPointFromMouse(e);
        if (!p) return;
        if (dragHandleRef.current === 1) {
          onOverlayLineChange({ ...overlayLine, x1: p.x, y1: Math.max(0, p.y) });
        } else {
          onOverlayLineChange({ ...overlayLine, x2: p.x, y2: Math.max(0, p.y) });
        }
        return;
      }
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
    [points, overlayLine, onOverlayLineChange, dataPointFromMouse],
  );

  const handleMouseLeave = useCallback(() => {
    if (!dragHandleRef.current && !pointDragRef.current) setHoverIdx(null);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const ranges = rangesRef.current;
    const canvas = canvasRef.current;
    if (!ranges || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (overlayLine && onOverlayLineChange) {
      const toX = (x: number) => ranges.padL + ((x - ranges.xMin) / (ranges.xMax - ranges.xMin)) * ranges.plotW;
      const toY = (y: number) =>
        ranges.padT + ranges.plotH - ((y - ranges.leftMin) / (ranges.leftMax - ranges.leftMin)) * ranges.plotH;
      const d1 = Math.hypot(mx - toX(overlayLine.x1), my - toY(overlayLine.y1));
      const d2 = Math.hypot(mx - toX(overlayLine.x2), my - toY(overlayLine.y2));
      const nearest = d1 <= d2 ? 1 : 2;
      if (Math.min(d1, d2) <= 18) {
        dragHandleRef.current = nearest;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    if (!onPointDragCommit || !dragCandidates || dragCandidates.length === 0) return;
    let bestStart: { point: DualAxisPoint; series: 'left' | 'right'; dist: number } | null = null;
    for (const point of points) {
      for (const series of ['left', 'right'] as const) {
        if (series === 'right' && hideRightAxis) continue;
        const pos = pointScreenPosition(point, series);
        if (!pos) continue;
        const dist = Math.hypot(mx - pos.x, my - pos.y);
        if (!bestStart || dist < bestStart.dist) {
          bestStart = { point, series, dist };
        }
      }
    }
    if (!bestStart || bestStart.dist > 16) return;
    const candidate = nearestDragCandidate(bestStart.point.dx, bestStart.series, e.clientX, e.clientY) ?? bestStart.point;
    pointDragRef.current = {
      pointerId: e.pointerId,
      sourceDx: bestStart.point.dx,
      series: bestStart.series,
      point: candidate,
    };
    setDragPoint(candidate);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [
    dragCandidates,
    hideRightAxis,
    nearestDragCandidate,
    onOverlayLineChange,
    onPointDragCommit,
    overlayLine,
    pointScreenPosition,
    points,
  ]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (pointDragRef.current) {
      const drag = pointDragRef.current;
      const candidate = nearestDragCandidate(drag.sourceDx, drag.series, e.clientX, e.clientY);
      if (candidate) {
        pointDragRef.current = { ...drag, point: candidate };
        setDragPoint(candidate);
      }
      return;
    }
    if (!dragHandleRef.current || !overlayLine || !onOverlayLineChange) return;
    const p = dataPointFromMouse(e.nativeEvent);
    if (!p) return;
    if (dragHandleRef.current === 1) {
      onOverlayLineChange({ ...overlayLine, x1: p.x, y1: Math.max(0, p.y) });
    } else {
      onOverlayLineChange({ ...overlayLine, x2: p.x, y2: Math.max(0, p.y) });
    }
  }, [nearestDragCandidate, overlayLine, onOverlayLineChange, dataPointFromMouse]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (pointDragRef.current) {
      const point = pointDragRef.current.point;
      if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
        canvasRef.current.releasePointerCapture(e.pointerId);
      }
      pointDragRef.current = null;
      setDragPoint(null);
      onPointDragCommit?.(point);
      return;
    }
    if (dragHandleRef.current && canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }
    dragHandleRef.current = null;
  }, [onPointDragCommit]);

  const hoverPoint = dragPoint ?? (hoverIdx !== null ? points[hoverIdx] : null);

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500 px-6 text-center leading-relaxed">
        {emptyMessage ?? 'No data to display.'}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[inherit] p-3 box-border">
      <canvas
        ref={canvasRef}
        className="w-full h-full min-h-[inherit] block"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {hoverPoint && renderTooltip && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none px-3 py-2 rounded bg-gray-900 border border-gray-600 text-xs shadow-lg tabular-nums space-y-0.5">
          {renderTooltip(hoverPoint)}
        </div>
      )}
    </div>
  );
}
