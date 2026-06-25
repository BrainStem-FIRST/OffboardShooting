import { useState } from 'react';
import { TrajGenParams, TrajGroup } from '../types';
import type { TrajectoryMoe } from '../simulation';
import { panelTab } from './panelStyles';
import TrajectoryGenCanvas from './TrajectoryGenCanvas';
import TrajectoryOptimalAnalysis from './TrajectoryOptimalAnalysis';

type CenterTab = 'visualizer' | 'optimalAnalysis';

interface Props {
  params: TrajGenParams;
  groups: TrajGroup[];
  selectedGroupId: string | null;
  hoveredId: string | null;
  showAll: boolean;
  showBiggestMoe: boolean;
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
  showBiggestMoe,
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
      <div className="flex-1 min-h-0 min-w-0 relative">
        {centerTab === 'visualizer' && (
          <TrajectoryGenCanvas
            params={params}
            groups={groups}
            selectedGroupId={selectedGroupId}
            hoveredId={hoveredId}
            showAll={showAll}
            showBiggestMoe={showBiggestMoe}
            trajMoeById={trajMoeById}
            bestMoeTrajIds={bestMoeTrajIds}
            onHoverTraj={onHoverTraj}
          />
        )}
        {centerTab === 'optimalAnalysis' && (
          <TrajectoryOptimalAnalysis
            groups={groups}
            params={params}
            trajMoeById={trajMoeById}
            bestMoeTrajIds={bestMoeTrajIds}
            onParamsChange={onParamsChange}
          />
        )}
      </div>
    </main>
  );
}
