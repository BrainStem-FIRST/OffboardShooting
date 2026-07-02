import { useState } from 'react';
import { TrajGenParams, TrajGroup } from '../types';
import type { TrajectoryMoe } from '../simulation';
import { panelTab } from './panelStyles';
import { CheckboxLabel } from './Checkbox';
import TrajectoryGenCanvas from './TrajectoryGenCanvas';
import TrajectoryOptimalAnalysis from './TrajectoryOptimalAnalysis';

type CenterTab = 'visualizer' | 'optimalAnalysis';

interface Props {
  params: TrajGenParams;
  groups: TrajGroup[];
  selectedGroupId: string | null;
  hoveredId: string | null;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
  showOptimalTrajectories: boolean;
  onShowOptimalTrajectoriesChange: (show: boolean) => void;
  trajMoeById: Map<string, TrajectoryMoe>;
  bestMoeTrajIds: Set<string>;
  onHoverTraj: (id: string | null) => void;
  onParamsChange: (params: TrajGenParams) => void;
}

const TABS: { id: CenterTab; label: string }[] = [
  { id: 'visualizer', label: 'Trajectory Visualizer' },
  { id: 'optimalAnalysis', label: 'Optimal Analysis' },
];

export default function TrajectoryGenCenter({
  params,
  groups,
  selectedGroupId,
  hoveredId,
  showAll,
  onShowAllChange,
  showOptimalTrajectories,
  onShowOptimalTrajectoriesChange,
  trajMoeById,
  bestMoeTrajIds,
  onHoverTraj,
  onParamsChange,
}: Props) {
  const [centerTab, setCenterTab] = useState<CenterTab>('visualizer');

  return (
    <main className="flex flex-1 min-w-0 min-h-0 bg-gray-950 flex-col">
      <div className="flex-shrink-0 flex border-b border-gray-700 bg-gray-900/50">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCenterTab(t.id)}
            className={panelTab(centerTab === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 min-w-0 relative flex flex-col">
        {centerTab === 'visualizer' && (
          <>
            <div className="flex-shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b border-gray-800 bg-gray-900/30">
              <CheckboxLabel
                checked={showAll}
                disabled={groups.length === 0}
                onChange={onShowAllChange}
                label="Show all"
                labelClassName="text-sm text-gray-400"
              />
              <CheckboxLabel
                checked={showOptimalTrajectories}
                disabled={groups.length === 0}
                onChange={onShowOptimalTrajectoriesChange}
                label="Show optimal trajectories"
                labelClassName="text-sm text-gray-400"
                color="green"
              />
            </div>
            <div className="flex-1 min-h-0 min-w-0 relative">
              <TrajectoryGenCanvas
                params={params}
                groups={groups}
                selectedGroupId={selectedGroupId}
                hoveredId={hoveredId}
                showAll={showAll}
                showOptimalTrajectories={showOptimalTrajectories}
                trajMoeById={trajMoeById}
                bestMoeTrajIds={bestMoeTrajIds}
                onHoverTraj={onHoverTraj}
              />
            </div>
          </>
        )}
        {centerTab === 'optimalAnalysis' && (
          <div className="flex-1 min-h-0 min-w-0 relative">
            <TrajectoryOptimalAnalysis
              groups={groups}
              params={params}
              trajMoeById={trajMoeById}
              bestMoeTrajIds={bestMoeTrajIds}
              onParamsChange={onParamsChange}
            />
          </div>
        )}
      </div>
    </main>
  );
}
