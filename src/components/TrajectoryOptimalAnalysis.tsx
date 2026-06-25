import { useMemo, useState } from 'react';
import { TrajGenParams, TrajGroup } from '../types';
import {
  buildOptimalSequencePoints,
  computeSequenceDerivatives,
  type TrajectoryMoe,
} from '../simulation';
import DualAxisDistanceChart, {
  DUAL_AXIS_LEFT_COLOR,
  DUAL_AXIS_RIGHT_COLOR,
  type DualAxisPoint,
} from './DualAxisDistanceChart';
import { CheckboxLabel } from './Checkbox';
import { panelHint, panelLabelInline, panelSubsectionTitle } from './panelStyles';

interface Props {
  groups: TrajGroup[];
  params: TrajGenParams;
  trajMoeById: Map<string, TrajectoryMoe>;
  bestMoeTrajIds: Set<string>;
  onParamsChange: (params: TrajGenParams) => void;
}

type SequenceShowMode = 'function' | 'derivative';

/** Minimum chart panel height (~2× typical flex-filled chart area). */
const CHART_PANEL_MIN_H = 'min-h-[36rem]';

function buildMoePoints(
  groups: TrajGroup[],
  trajMoeById: Map<string, TrajectoryMoe>,
  bestTrajIds: Set<string>,
): DualAxisPoint[] {
  const points: DualAxisPoint[] = [];
  for (const g of groups) {
    const best = g.trajectories.find((t) => bestTrajIds.has(t.id));
    if (!best) continue;
    const moe = trajMoeById.get(best.id);
    if (!moe) continue;
    points.push({ dx: g.dx, left: moe.speedMoe, right: moe.angleMoe });
  }
  points.sort((a, b) => a.dx - b.dx);
  return points;
}

function WeightField({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 shrink-0">
      <span className={`${panelLabelInline} text-gray-400 text-xs whitespace-nowrap`}>{label}</span>
      <input
        type="number"
        className="w-11 tabular-nums text-xs text-center px-1 py-0.5 h-6 rounded border border-gray-600 bg-gray-800 text-gray-100 focus:outline-none focus:border-blue-500"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, v));
        }}
      />
    </label>
  );
}

export default function TrajectoryOptimalAnalysis({
  groups,
  params,
  trajMoeById,
  bestMoeTrajIds,
  onParamsChange,
}: Props) {
  const [sequenceMode, setSequenceMode] = useState<SequenceShowMode>('function');

  const set = (key: keyof TrajGenParams, value: number) => {
    onParamsChange({ ...params, [key]: value });
  };

  const moePoints = useMemo(
    () => buildMoePoints(groups, trajMoeById, bestMoeTrajIds),
    [groups, trajMoeById, bestMoeTrajIds],
  );

  const optimalSequence = useMemo(
    () => buildOptimalSequencePoints(groups, bestMoeTrajIds),
    [groups, bestMoeTrajIds],
  );

  const functionPoints = useMemo(
    (): DualAxisPoint[] =>
      optimalSequence.map((p) => ({ dx: p.dx, left: p.exitSpeed, right: p.exitAngle })),
    [optimalSequence],
  );

  const derivPoints = useMemo(
    (): DualAxisPoint[] =>
      computeSequenceDerivatives(optimalSequence).map((p) => ({
        dx: p.dx,
        left: p.dSpeedDx,
        right: p.dAngleDx,
      })),
    [optimalSequence],
  );

  const sequencePoints = sequenceMode === 'function' ? functionPoints : derivPoints;

  if (moePoints.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500 px-6 text-center leading-relaxed">
        Generate trajectories to see MOE and derivative analysis for the optimal path at each goal distance.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
      <div className="px-5 pt-3 pb-3 border-b border-gray-800 space-y-2">
        <h3 className={panelSubsectionTitle}>Optimal path weights</h3>
        <p className={`${panelHint} text-gray-500 text-xs`}>
          Higher MOE weight favors robustness; higher derivative weights favor smoother exit speed/angle vs distance (1st and 2nd derivatives).
        </p>
        <div className="flex flex-nowrap items-center gap-x-4 gap-y-2 overflow-x-auto pb-0.5">
          <WeightField
            label="MOE"
            value={params.optimalMoeWeight}
            step={0.1}
            min={0}
            onChange={(v) => set('optimalMoeWeight', v)}
          />
          <WeightField
            label="Speed 1st"
            value={params.optimalSpeedDerivWeight}
            step={0.05}
            min={0}
            onChange={(v) => set('optimalSpeedDerivWeight', v)}
          />
          <WeightField
            label="Angle 1st"
            value={params.optimalAngleDerivWeight}
            step={0.05}
            min={0}
            onChange={(v) => set('optimalAngleDerivWeight', v)}
          />
          <WeightField
            label="Speed 2nd"
            value={params.optimalSpeedSecondDerivWeight}
            step={0.05}
            min={0}
            onChange={(v) => set('optimalSpeedSecondDerivWeight', v)}
          />
          <WeightField
            label="Angle 2nd"
            value={params.optimalAngleSecondDerivWeight}
            step={0.05}
            min={0}
            onChange={(v) => set('optimalAngleSecondDerivWeight', v)}
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row">
        <div className={`flex-1 min-w-0 flex flex-col border-b lg:border-b-0 lg:border-r border-gray-800 ${CHART_PANEL_MIN_H}`}>
          <div className="flex-shrink-0 px-4 pt-2 text-xs font-medium text-gray-400">MOE vs distance</div>
          <div className="h-[32rem]">
            <DualAxisDistanceChart
              points={moePoints}
              yAxisFromZero
              leftLegend="Exit speed MOE (m/s)"
              rightLegend="Exit angle MOE (°)"
              leftAxisTitle="Speed MOE (m/s)"
              rightAxisTitle="Angle MOE (°)"
              emptyMessage="No optimal trajectories with MOE data."
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
          </div>
        </div>

        <div className={`flex-1 min-w-0 flex flex-col ${CHART_PANEL_MIN_H}`}>
          <div className="flex-shrink-0 px-4 pt-2 space-y-1.5">
            <div className="text-xs font-medium text-gray-400">Exit speed &amp; angle vs distance</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <CheckboxLabel
                checked={sequenceMode === 'function'}
                onChange={(checked) => { if (checked) setSequenceMode('function'); }}
                label="Show function"
                labelClassName="text-xs text-gray-400"
              />
              <CheckboxLabel
                checked={sequenceMode === 'derivative'}
                onChange={(checked) => { if (checked) setSequenceMode('derivative'); }}
                label="Show derivative"
                labelClassName="text-xs text-gray-400"
                color="green"
              />
            </div>
          </div>
          <div className="h-[32rem]">
            {sequenceMode === 'function' ? (
              <DualAxisDistanceChart
                points={sequencePoints}
                leftLegend="Exit speed (m/s)"
                rightLegend="Exit angle (°)"
                leftAxisTitle="Speed (m/s)"
                rightAxisTitle="Angle (°)"
                emptyMessage="No optimal trajectories to plot."
                renderTooltip={(p) => (
                  <>
                    <div className="text-gray-400 text-center mb-1">dx = {p.dx.toFixed(2)} m</div>
                    <div className="text-gray-300">
                      Exit speed{' '}
                      <span className="font-mono" style={{ color: DUAL_AXIS_LEFT_COLOR }}>
                        {p.left.toFixed(3)} m/s
                      </span>
                    </div>
                    <div className="text-gray-300">
                      Exit angle{' '}
                      <span className="font-mono" style={{ color: DUAL_AXIS_RIGHT_COLOR }}>
                        {p.right.toFixed(2)}°
                      </span>
                    </div>
                  </>
                )}
              />
            ) : (
              <DualAxisDistanceChart
                points={sequencePoints}
                showZeroLine
                leftLegend="d(exit speed)/d(distance)"
                rightLegend="d(exit angle)/d(distance)"
                leftAxisTitle="(m/s)/m"
                rightAxisTitle="°/m"
                emptyMessage="Need optimal trajectories at two or more goal distances for derivatives."
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
