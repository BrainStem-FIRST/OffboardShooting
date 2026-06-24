import { useMemo } from 'react';
import { TrajGroup } from '../types';
import type { TrajectoryMoe } from '../simulation';
import DualAxisDistanceChart, {
  DUAL_AXIS_LEFT_COLOR,
  DUAL_AXIS_RIGHT_COLOR,
  type DualAxisPoint,
} from './DualAxisDistanceChart';

interface Props {
  groups: TrajGroup[];
  trajMoeById: Map<string, TrajectoryMoe>;
  bestMoeTrajIds: Set<string>;
}

function buildMoePoints(
  groups: TrajGroup[],
  trajMoeById: Map<string, TrajectoryMoe>,
  bestMoeTrajIds: Set<string>,
): DualAxisPoint[] {
  const points: DualAxisPoint[] = [];
  for (const g of groups) {
    const best = g.trajectories.find((t) => bestMoeTrajIds.has(t.id));
    if (!best) continue;
    const moe = trajMoeById.get(best.id);
    if (!moe) continue;
    points.push({ dx: g.dx, left: moe.speedMoe, right: moe.angleMoe });
  }
  points.sort((a, b) => a.dx - b.dx);
  return points;
}

export default function TrajectoryMoeAnalysis({ groups, trajMoeById, bestMoeTrajIds }: Props) {
  const points = useMemo(
    () => buildMoePoints(groups, trajMoeById, bestMoeTrajIds),
    [groups, trajMoeById, bestMoeTrajIds],
  );

  return (
    <DualAxisDistanceChart
      points={points}
      yAxisFromZero
      leftLegend="Exit speed MOE (m/s)"
      rightLegend="Exit angle MOE (°)"
      leftAxisTitle="Speed MOE (m/s)"
      rightAxisTitle="Angle MOE (°)"
      emptyMessage="Generate trajectories to see exit speed and angle MOE for the most optimal shot at each goal distance."
      renderTooltip={(p) => (
        <>
          <div className="text-gray-400 text-center mb-1">dx = {p.dx.toFixed(2)} m</div>
          <div className="text-gray-300">
            Speed MOE{' '}
            <span className="font-mono" style={{ color: DUAL_AXIS_LEFT_COLOR }}>
              {p.left.toFixed(3)} m/s
            </span>
          </div>
          <div className="text-gray-300">
            Angle MOE{' '}
            <span className="font-mono" style={{ color: DUAL_AXIS_RIGHT_COLOR }}>
              {p.right.toFixed(2)}°
            </span>
          </div>
        </>
      )}
    />
  );
}
