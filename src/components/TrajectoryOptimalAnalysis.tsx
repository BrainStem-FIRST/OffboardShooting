import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { TrajGenParams, TrajGroup } from '../types';
import {
  buildOptimalSequencePoints,
  computeSequenceDerivatives,
  isTrajectoryInArc,
  velocityBufferForTrajectory,
  type TrajectoryMoe,
} from '../simulation';
import DualAxisDistanceChart, {
  DUAL_AXIS_LEFT_COLOR,
  DUAL_AXIS_LEFT_EXTRA_COLOR,
  DUAL_AXIS_RIGHT_COLOR,
  type DualAxisPoint,
  type DualAxisRangeBar,
} from './DualAxisDistanceChart';
import { panelHint, panelLabelInline, panelSubsectionTitle } from './panelStyles';
import SegmentedToggle from './SegmentedToggle';

interface Props {
  groups: TrajGroup[];
  params: TrajGenParams;
  trajMoeById: Map<string, TrajectoryMoe>;
  optimalLowArcTrajIds: Set<string>;
  optimalHighArcTrajIds: Set<string>;
  onParamsChange: (params: TrajGenParams) => void;
  onSaveOptimalTrajectories: () => void;
  onSetManualOptimalTrajectory: (groupId: string, trajId: string, arc: ArcShowMode) => void;
}

type SequenceShowMode = 'function' | 'derivative';
type ArcShowMode = 'low' | 'high';

const CHART_PANEL_MIN_H = 'min-h-[36rem]';

function buildMoePoints(
  groups: TrajGroup[],
  trajMoeById: Map<string, TrajectoryMoe>,
  bestTrajIds: Set<string>,
): DualAxisPoint[] {
  const points: DualAxisPoint[] = [];
  for (const group of groups) {
    const best = group.trajectories.find((traj) => bestTrajIds.has(traj.id));
    if (!best) continue;
    const moe = trajMoeById.get(best.id);
    if (!moe) continue;
    points.push({
      dx: group.dx,
      left: moe.speedMoe,
      right: Math.min(moe.angleMoeMinus, moe.angleMoePlus),
    });
  }
  return points.sort((a, b) => a.dx - b.dx);
}

function arcTrajectories(group: TrajGroup, arc: ArcShowMode) {
  return group.trajectories.filter((traj) => isTrajectoryInArc(group, traj, arc));
}

function buildFunctionRangeBars(groups: TrajGroup[], arc: ArcShowMode): DualAxisRangeBar[] {
  return groups.flatMap((group) => {
    const trajs = arcTrajectories(group, arc);
    if (trajs.length === 0) return [];
    return [{
      dx: group.dx,
      leftMin: Math.min(...trajs.map((traj) => traj.exitVelocity)),
      leftMax: Math.max(...trajs.map((traj) => traj.exitVelocity)),
      rightMin: Math.min(...trajs.map((traj) => traj.exitAngle)),
      rightMax: Math.max(...trajs.map((traj) => traj.exitAngle)),
    }];
  }).sort((a, b) => a.dx - b.dx);
}

function buildFunctionDragCandidates(groups: TrajGroup[], arc: ArcShowMode): DualAxisPoint[] {
  return groups.flatMap((group) =>
    arcTrajectories(group, arc).map((traj) => ({
      dx: group.dx,
      left: traj.exitVelocity,
      right: traj.exitAngle,
      groupId: group.id,
      trajId: traj.id,
      velocityBuffer: velocityBufferForTrajectory(group, traj),
    })),
  );
}

function buildMoeRangeBars(
  groups: TrajGroup[],
  trajMoeById: Map<string, TrajectoryMoe>,
  arc: ArcShowMode,
): DualAxisRangeBar[] {
  return groups.flatMap((group) => {
    const values = arcTrajectories(group, arc)
      .map((traj) => trajMoeById.get(traj.id))
      .filter((moe): moe is TrajectoryMoe => Boolean(moe))
      .map((moe) => ({
        speedMoe: moe.speedMoe,
        angleMoe: Math.min(moe.angleMoeMinus, moe.angleMoePlus),
      }));
    if (values.length === 0) return [];
    return [{
      dx: group.dx,
      leftMin: Math.min(...values.map((value) => value.speedMoe)),
      leftMax: Math.max(...values.map((value) => value.speedMoe)),
      rightMin: Math.min(...values.map((value) => value.angleMoe)),
      rightMax: Math.max(...values.map((value) => value.angleMoe)),
    }];
  }).sort((a, b) => a.dx - b.dx);
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

function SectionHeader({
  title,
  expanded,
  onToggle,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-5 py-3 text-left border-b border-gray-800 bg-gray-900/40 hover:bg-gray-900/70"
    >
      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      <span className={panelSubsectionTitle}>{title}</span>
    </button>
  );
}

export default function TrajectoryOptimalAnalysis({
  groups,
  params,
  trajMoeById,
  optimalLowArcTrajIds,
  optimalHighArcTrajIds,
  onParamsChange,
  onSaveOptimalTrajectories,
  onSetManualOptimalTrajectory,
}: Props) {
  const [sequenceMode, setSequenceMode] = useState<SequenceShowMode>('function');
  const [arcMode, setArcMode] = useState<ArcShowMode>('low');
  const [tuningExpanded, setTuningExpanded] = useState(true);
  const [analysisExpanded, setAnalysisExpanded] = useState(true);

  const set = (key: keyof TrajGenParams, value: number) => {
    onParamsChange({ ...params, [key]: value });
  };

  const moePoints = useMemo(
    () => buildMoePoints(groups, trajMoeById, arcMode === 'low' ? optimalLowArcTrajIds : optimalHighArcTrajIds),
    [groups, trajMoeById, optimalLowArcTrajIds, optimalHighArcTrajIds, arcMode],
  );

  const lowArcSequence = useMemo(
    () => buildOptimalSequencePoints(groups, optimalLowArcTrajIds),
    [groups, optimalLowArcTrajIds],
  );

  const highArcSequence = useMemo(
    () => buildOptimalSequencePoints(groups, optimalHighArcTrajIds),
    [groups, optimalHighArcTrajIds],
  );

  const optimalSequence = arcMode === 'low' ? lowArcSequence : highArcSequence;

  const functionPoints = useMemo(
    (): DualAxisPoint[] =>
      optimalSequence.map((p) => ({
        dx: p.dx,
        left: p.exitSpeed,
        right: p.exitAngle,
        groupId: p.groupId,
        trajId: p.trajId,
        velocityBuffer: p.velocityBuffer,
      })),
    [optimalSequence],
  );

  const functionDragCandidates = useMemo(
    () => buildFunctionDragCandidates(groups, arcMode),
    [groups, arcMode],
  );

  const functionRangeBars = useMemo(
    () => buildFunctionRangeBars(groups, arcMode),
    [groups, arcMode],
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

  const velocityBufferPoints = useMemo(
    (): DualAxisPoint[] => {
      const byDx = new Map<number, DualAxisPoint>();
      for (const p of lowArcSequence) {
        byDx.set(p.dx, { dx: p.dx, left: p.velocityBuffer, right: 0 });
      }
      for (const p of highArcSequence) {
        const existing = byDx.get(p.dx);
        if (existing) existing.leftExtra = p.velocityBuffer;
        else byDx.set(p.dx, { dx: p.dx, left: p.velocityBuffer, leftExtra: p.velocityBuffer, right: 0 });
      }
      return [...byDx.values()].sort((a, b) => a.dx - b.dx);
    },
    [lowArcSequence, highArcSequence],
  );

  const sequencePoints = sequenceMode === 'function' ? functionPoints : derivPoints;

  const moeRangeBars = useMemo(
    () => buildMoeRangeBars(groups, trajMoeById, arcMode),
    [groups, trajMoeById, arcMode],
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
      <SectionHeader
        title="Optimal tuning"
        expanded={tuningExpanded}
        onToggle={() => setTuningExpanded((v) => !v)}
      />
      {tuningExpanded && (
        <section className="border-b border-gray-800">
          <div className="px-5 pt-3 pb-3 space-y-2">
            <p className={`${panelHint} text-gray-500 text-xs`}>
              Higher MOE weight favors robustness; higher derivative weights favor smoother exit speed/angle vs distance.
            </p>
            <div className="flex flex-nowrap items-center gap-x-4 gap-y-2 overflow-x-auto pb-0.5">
              <WeightField label="MOE" value={params.optimalMoeWeight} step={0.1} min={0} onChange={(v) => set('optimalMoeWeight', v)} />
              <WeightField label="Speed 1st" value={params.optimalSpeedDerivWeight} step={0.05} min={0} onChange={(v) => set('optimalSpeedDerivWeight', v)} />
              <WeightField label="Angle 1st" value={params.optimalAngleDerivWeight} step={0.05} min={0} onChange={(v) => set('optimalAngleDerivWeight', v)} />
              <WeightField label="Speed 2nd" value={params.optimalSpeedSecondDerivWeight} step={0.05} min={0} onChange={(v) => set('optimalSpeedSecondDerivWeight', v)} />
              <WeightField label="Angle 2nd" value={params.optimalAngleSecondDerivWeight} step={0.05} min={0} onChange={(v) => set('optimalAngleSecondDerivWeight', v)} />
            </div>
          </div>
          <div className={`flex flex-col ${CHART_PANEL_MIN_H}`}>
            <div className="flex-shrink-0 px-4 pt-2 text-xs font-medium text-gray-400">Velocity buffer vs distance</div>
            <div className="h-[32rem]">
              <DualAxisDistanceChart
                points={velocityBufferPoints}
                yAxisFromZero
                hideRightAxis
                leftLegend="Low arc buffer (m/s)"
                leftExtraLegend="High arc buffer (m/s)"
                leftExtraColor={DUAL_AXIS_LEFT_EXTRA_COLOR}
                rightLegend=""
                leftAxisTitle="Velocity buffer (m/s)"
                rightAxisTitle=""
                overlayLine={{
                  x1: params.optimalVelocityBufferLineX1,
                  y1: params.optimalVelocityBufferLineY1,
                  x2: params.optimalVelocityBufferLineX2,
                  y2: params.optimalVelocityBufferLineY2,
                }}
                onOverlayLineChange={(line) => {
                  onParamsChange({
                    ...params,
                    optimalVelocityBufferLineX1: Number(line.x1.toFixed(3)),
                    optimalVelocityBufferLineY1: Number(line.y1.toFixed(3)),
                    optimalVelocityBufferLineX2: Number(line.x2.toFixed(3)),
                    optimalVelocityBufferLineY2: Number(line.y2.toFixed(3)),
                  });
                }}
                emptyMessage="No optimal trajectories to plot."
                renderTooltip={(p) => (
                  <>
                    <div className="text-gray-400 text-center mb-1">dx = {p.dx.toFixed(3)} m</div>
                    <div className="text-gray-300">
                      Low arc buffer <span className="font-mono" style={{ color: DUAL_AXIS_LEFT_COLOR }}>{p.left.toFixed(3)} m/s</span>
                    </div>
                    {p.leftExtra !== undefined && (
                      <div className="text-gray-300">
                        High arc buffer <span className="font-mono" style={{ color: DUAL_AXIS_LEFT_EXTRA_COLOR }}>{p.leftExtra.toFixed(3)} m/s</span>
                      </div>
                    )}
                  </>
                )}
              />
            </div>
          </div>
          <div className="flex justify-end px-5 pb-4">
            <button
              type="button"
              onClick={onSaveOptimalTrajectories}
              className="h-8 px-4 rounded bg-blue-700 text-sm font-medium text-white hover:bg-blue-600"
            >
              Save
            </button>
          </div>
        </section>
      )}

      <SectionHeader
        title="Optimal analysis"
        expanded={analysisExpanded}
        onToggle={() => setAnalysisExpanded((v) => !v)}
      />
      {analysisExpanded && (
        <section className="flex flex-col">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-gray-800">
            <SegmentedToggle
              value={arcMode}
              options={[
                { value: 'low', label: 'Low arc' },
                { value: 'high', label: 'High arc' },
              ]}
              onChange={setArcMode}
            />
          </div>
          <div className={`flex-1 min-w-0 flex flex-col border-b border-gray-800 ${CHART_PANEL_MIN_H}`}>
            <div className="flex-shrink-0 px-4 pt-2 space-y-1.5">
              <div className="text-xs font-medium text-gray-400">Exit speed &amp; angle vs distance</div>
              <SegmentedToggle
                value={sequenceMode}
                options={[
                  { value: 'function', label: 'Show function' },
                  { value: 'derivative', label: 'Show derivative' },
                ]}
                onChange={setSequenceMode}
              />
            </div>
            <div className="h-[32rem]">
              {sequenceMode === 'function' ? (
                <DualAxisDistanceChart
                  points={sequencePoints}
                  leftLegend="Exit speed (m/s)"
                  rightLegend="Exit angle (deg)"
                  leftAxisTitle="Speed (m/s)"
                  rangeBars={functionRangeBars}
                  rightAxisTitle="Angle (deg)"
                  emptyMessage="No optimal trajectories to plot."
                  dragCandidates={functionDragCandidates}
                  onPointDragCommit={(p) => {
                    if (!p.groupId || !p.trajId) return;
                    onSetManualOptimalTrajectory(p.groupId, p.trajId, arcMode);
                  }}
                  renderTooltip={(p) => (
                    <>
                      <div className="text-gray-400 text-center mb-1">dx = {p.dx.toFixed(3)} m</div>
                      <div className="text-gray-300">Exit speed <span className="font-mono" style={{ color: DUAL_AXIS_LEFT_COLOR }}>{p.left.toFixed(3)} m/s</span></div>
                      <div className="text-gray-300">Exit angle <span className="font-mono" style={{ color: DUAL_AXIS_RIGHT_COLOR }}>{p.right.toFixed(2)} deg</span></div>
                      {p.velocityBuffer !== undefined && (
                        <div className="text-gray-300">Vel buffer <span className="font-mono">{p.velocityBuffer.toFixed(3)} m/s</span></div>
                      )}
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
                  rightAxisTitle="deg/m"
                  emptyMessage="Need optimal trajectories at two or more goal distances for derivatives."
                  renderTooltip={(p) => (
                    <>
                      <div className="text-gray-400 text-center mb-1">dx = {p.dx.toFixed(3)} m</div>
                      <div className="text-gray-300">d(speed)/d(distance) <span className="font-mono" style={{ color: DUAL_AXIS_LEFT_COLOR }}>{p.left.toFixed(4)} (m/s)/m</span></div>
                      <div className="text-gray-300">d(angle)/d(distance) <span className="font-mono" style={{ color: DUAL_AXIS_RIGHT_COLOR }}>{p.right.toFixed(4)} deg/m</span></div>
                    </>
                  )}
                />
              )}
            </div>
          </div>
          <div className={`flex-1 min-w-0 flex flex-col ${CHART_PANEL_MIN_H}`}>
            <div className="flex-shrink-0 px-4 pt-2 text-xs font-medium text-gray-400">MOE vs distance</div>
            <div className="h-[32rem]">
              <DualAxisDistanceChart
                points={moePoints}
                yAxisFromZero
                leftLegend="Speed MOE (m/s)"
                rangeBars={moeRangeBars}
                rightLegend="Exit angle MOE min (deg)"
                leftAxisTitle="Speed MOE (m/s)"
                rightAxisTitle="Angle MOE (deg)"
                emptyMessage="No optimal trajectories with MOE data."
                renderTooltip={(p) => (
                  <>
                    <div className="text-gray-400 text-center mb-1">dx = {p.dx.toFixed(3)} m</div>
                    <div className="text-gray-300">Speed MOE <span className="font-mono" style={{ color: DUAL_AXIS_LEFT_COLOR }}>{p.left.toFixed(3)} m/s</span></div>
                    <div className="text-gray-300">Angle MOE (min) <span className="font-mono" style={{ color: DUAL_AXIS_RIGHT_COLOR }}>{p.right.toFixed(2)} deg</span></div>
                  </>
                )}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
