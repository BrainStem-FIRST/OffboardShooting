import { useMemo } from 'react';
import { TrajGroup } from '../types';
import DualAxisDistanceChart, {
  DUAL_AXIS_LEFT_COLOR,
  DUAL_AXIS_RIGHT_COLOR,
  type DualAxisPoint,
} from './DualAxisDistanceChart';

interface Props {
  groups: TrajGroup[];
  bestMoeTrajIds: Set<string>;
}

interface OptimalPoint {
  dx: number;
  exitSpeed: number;
  exitAngle: number;
}

function buildOptimalPoints(groups: TrajGroup[], bestMoeTrajIds: Set<string>): OptimalPoint[] {
  const points: OptimalPoint[] = [];
  for (const g of groups) {
    const best = g.trajectories.find((t) => bestMoeTrajIds.has(t.id));
    if (!best) continue;
    points.push({ dx: g.dx, exitSpeed: best.exitVelocity, exitAngle: best.exitAngle });
  }
  points.sort((a, b) => a.dx - b.dx);
  return points;
}

function computeDerivatives(points: OptimalPoint[]): DualAxisPoint[] {
  if (points.length < 2) return [];
  const derivs: DualAxisPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    let dSpeedDx: number;
    let dAngleDx: number;
    if (i === 0) {
      const h = points[1].dx - points[0].dx;
      dSpeedDx = h !== 0 ? (points[1].exitSpeed - points[0].exitSpeed) / h : 0;
      dAngleDx = h !== 0 ? (points[1].exitAngle - points[0].exitAngle) / h : 0;
    } else if (i === points.length - 1) {
      const h = points[i].dx - points[i - 1].dx;
      dSpeedDx = h !== 0 ? (points[i].exitSpeed - points[i - 1].exitSpeed) / h : 0;
      dAngleDx = h !== 0 ? (points[i].exitAngle - points[i - 1].exitAngle) / h : 0;
    } else {
      const h = points[i + 1].dx - points[i - 1].dx;
      dSpeedDx = h !== 0 ? (points[i + 1].exitSpeed - points[i - 1].exitSpeed) / h : 0;
      dAngleDx = h !== 0 ? (points[i + 1].exitAngle - points[i - 1].exitAngle) / h : 0;
    }
    derivs.push({ dx: points[i].dx, left: dSpeedDx, right: dAngleDx });
  }
  return derivs;
}

export default function TrajectoryDerivativeAnalysis({ groups, bestMoeTrajIds }: Props) {
  const optimalCount = useMemo(
    () => buildOptimalPoints(groups, bestMoeTrajIds).length,
    [groups, bestMoeTrajIds],
  );

  const points = useMemo(() => {
    const optimal = buildOptimalPoints(groups, bestMoeTrajIds);
    return computeDerivatives(optimal);
  }, [groups, bestMoeTrajIds]);

  if (optimalCount === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500 px-6 text-center leading-relaxed">
        Generate trajectories to see how exit speed and angle change with goal distance.
      </div>
    );
  }

  return (
    <DualAxisDistanceChart
      points={points}
      showZeroLine
      leftLegend="d(exit speed)/d(distance)"
      rightLegend="d(exit angle)/d(distance)"
      leftAxisTitle="(m/s)/m"
      rightAxisTitle="°/m"
      emptyMessage="Generate trajectories at two or more goal distances to plot rate-of-change derivatives."
      renderTooltip={(p) => (
        <>
          <div className="text-gray-400 text-center mb-1">dx = {p.dx.toFixed(2)} m</div>
          <div className="text-gray-300">
            d(speed)/d(distance){' '}
            <span className="font-mono" style={{ color: DUAL_AXIS_LEFT_COLOR }}>
              {p.left.toFixed(4)} (m/s)/m
            </span>
          </div>
          <div className="text-gray-300">
            d(angle)/d(distance){' '}
            <span className="font-mono" style={{ color: DUAL_AXIS_RIGHT_COLOR }}>
              {p.right.toFixed(4)} °/m
            </span>
          </div>
        </>
      )}
    />
  );
}
