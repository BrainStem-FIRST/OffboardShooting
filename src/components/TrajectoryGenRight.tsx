import { useState, useEffect, useRef } from 'react';
import { GeneratedTrajectory, TrajGroup, TrajGenParams } from '../types';
import { Trash2, Download, Upload, RefreshCw, Copy, ChevronUp, ChevronDown, XCircle, X } from 'lucide-react';
import {
  simulateLanding, simulateImpactAngle, refineTrajectory, downloadTrajectoriesArchive,
  REFINE_MAX_ITER, REFINE_THRESHOLD_M,
} from '../simulation';
import {
  panelAside, panelSectionTitle, panelBtnPrimary,
  panelEmpty, panelHint, panelMeta, panelMono,
} from './panelStyles';

interface Props {
  groups: TrajGroup[];
  selectedGroupId: string | null;
  hoveredTrajId: string | null;
  onSelectGroup: (id: string) => void;
  onHoverTraj: (id: string | null) => void;
  onDeleteTraj: (groupId: string, trajId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onUpdateGroup: (groupId: string, trajs: GeneratedTrajectory[]) => void;
  onImportGroup: (group: TrajGroup) => void;
  onClearAll: () => void;
  params: TrajGenParams;
  width: number;
}

type SortKey = 'exitVelocity' | 'exitAngle' | 'impactAngle' | 'timeOfFlight' | 'landingError';

export default function TrajectoryGenRight({
  groups, selectedGroupId, hoveredTrajId,
  onSelectGroup, onHoverTraj,
  onDeleteTraj, onDeleteGroup, onUpdateGroup, onImportGroup, onClearAll,
  params, width
}: Props) {
  const group = groups.find(g => g.id === selectedGroupId) ?? groups[0] ?? null;
  const trajectories = group?.trajectories ?? [];
  const drag = group?.drag ?? params.dragCoefficient;
  const magnus = group?.magnus ?? params.magnusGain;

  const [sortKey, setSortKey] = useState<SortKey>('exitAngle');
  const [sortAsc, setSortAsc] = useState(true);
  const [activeCell, setActiveCell] = useState<{ id: string; field: 'exitVelocity' | 'exitAngle' } | null>(null);
  const [cellRaw, setCellRaw] = useState('');
  const cellRef = useRef<HTMLInputElement>(null);
  const activeCellRef = useRef(activeCell);
  const cellRawRef = useRef(cellRaw);
  const committingRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => { activeCellRef.current = activeCell; }, [activeCell]);
  useEffect(() => { cellRawRef.current = cellRaw; }, [cellRaw]);

  useEffect(() => {
    if (activeCell) {
      setTimeout(() => { cellRef.current?.focus(); cellRef.current?.select(); }, 0);
    }
  }, [activeCell?.id, activeCell?.field]);

  const hoveredTrajIdRef = useRef(hoveredTrajId);
  const trajectoriesRef = useRef(trajectories);
  const groupRef = useRef(group);
  const paramsRef = useRef(params);
  const dragRef = useRef(drag);
  const magnusRef = useRef(magnus);
  useEffect(() => { hoveredTrajIdRef.current = hoveredTrajId; }, [hoveredTrajId]);
  useEffect(() => { trajectoriesRef.current = trajectories; }, [trajectories]);
  useEffect(() => { groupRef.current = group; }, [group]);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  useEffect(() => { magnusRef.current = magnus; }, [magnus]);

  function applyRefineResult(
    traj: GeneratedTrajectory,
    result: ReturnType<typeof refineTrajectory>,
    dx: number,
    dy: number,
    errorTolerance: number
  ): GeneratedTrajectory {
    const t = result.trajectory;
    const impact = simulateImpactAngle(t.exitVelocity, t.exitAngle, dragRef.current, magnusRef.current, dx);
    const withImpact = { ...t, impactAngle: impact !== null ? Math.round(impact * 100) / 100 : t.impactAngle };
    if (!result.successfulBracket) return withImpact;
    const landing = simulateLanding(t.exitVelocity, t.exitAngle, dragRef.current, magnusRef.current, dy);
    const inGoal = landing !== null && Math.abs(landing.landingX - dx) <= errorTolerance / 2;
    return { ...withImpact, successfulBracket: inGoal, accurate: result.accurate && inGoal };
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const id = hoveredTrajIdRef.current;
      const g = groupRef.current;
      if (!id || !g) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        const traj = trajectoriesRef.current.find(t => t.id === id);
        if (!traj) return;
        const copy: GeneratedTrajectory = {
          ...traj,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          successfulBracket: undefined,
          accurate: undefined,
          refineFailure: undefined,
        };
        onUpdateGroup(g.id, [...trajectoriesRef.current, copy]);
      }
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        const traj = trajectoriesRef.current.find(t => t.id === id);
        if (!traj) return;
        const p = paramsRef.current;
        const gParams = { ...p, dx: g.dx, dy: g.dy };
        const result = refineTrajectory(traj, gParams, dragRef.current, magnusRef.current, REFINE_MAX_ITER, REFINE_THRESHOLD_M, 'angle');
        const refined = applyRefineResult(traj, result, g.dx, g.dy, p.errorTolerance);
        onUpdateGroup(g.id, trajectoriesRef.current.map(tr => tr.id === id ? refined : tr));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onUpdateGroup]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  function openCell(id: string, field: 'exitVelocity' | 'exitAngle', currentVal: number) {
    setActiveCell({ id, field });
    setCellRaw(String(currentVal));
  }

  function commitCell() {
    if (committingRef.current) return;
    const cell = activeCellRef.current;
    if (!cell || !group) return;
    committingRef.current = true;
    setActiveCell(null);
    const raw = cellRawRef.current;
    const n = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
    if (!isNaN(n)) {
      onUpdateGroup(group.id, trajectories.map(t => {
        if (t.id !== cell.id) return t;
        const next = { ...t, [cell.field]: n };
        const landing = simulateLanding(next.exitVelocity, next.exitAngle, drag, magnus, group.dy);
        const impact = simulateImpactAngle(next.exitVelocity, next.exitAngle, drag, magnus, group.dx);
        return {
          ...next,
          landingX: group.dx,
          timeOfFlight: landing ? landing.timeOfFlight : t.timeOfFlight,
          impactAngle: impact !== null ? Math.round(impact * 100) / 100 : t.impactAngle,
        };
      }));
    }
    committingRef.current = false;
  }

  const withLandingError = group ? trajectories.map(t => {
    const landing = simulateLanding(t.exitVelocity, t.exitAngle, drag, magnus, group.dy);
    const landingError = landing !== null ? (landing.landingX - group.dx) * 1000 : null;
    return { ...t, landingError };
  }) : [];

  const sorted = [...withLandingError].sort((a, b) => {
    const aVal = sortKey === 'landingError' ? (a.landingError ?? Infinity) : a[sortKey];
    const bVal = sortKey === 'landingError' ? (b.landingError ?? Infinity) : b[sortKey];
    const diff = aVal - bVal;
    return sortAsc ? diff : -diff;
  });

  function handleCopy(id: string) {
    if (!group) return;
    const traj = trajectories.find(t => t.id === id);
    if (!traj) return;
    const copy: GeneratedTrajectory = {
      ...traj,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      successfulBracket: undefined,
      accurate: undefined,
      refineFailure: undefined,
    };
    onUpdateGroup(group.id, [...trajectories, copy]);
  }

  function handleRefineOne(id: string) {
    if (!group) return;
    const traj = trajectories.find(t => t.id === id);
    if (!traj) return;
    const gParams = { ...params, dx: group.dx, dy: group.dy };
    const result = refineTrajectory(traj, gParams, drag, magnus, REFINE_MAX_ITER, REFINE_THRESHOLD_M, 'angle');
    const refined = applyRefineResult(traj, result, group.dx, group.dy, params.errorTolerance);
    onUpdateGroup(group.id, trajectories.map(tr => tr.id === id ? refined : tr));
  }

  function handleDownload() {
    downloadTrajectoriesArchive(groups, params);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const importedDrag = typeof json.dragCoeff === 'number' ? json.dragCoeff : null;
        const importedMagnus = typeof json.magnusCoeff === 'number' ? json.magnusCoeff : null;
        const importedDx = typeof json.dx === 'number' ? json.dx : null;
        const importedDy = typeof json.dy === 'number' ? json.dy : null;
        if (importedDrag === null || importedMagnus === null || importedDx === null || importedDy === null) {
          setImportError('Missing required fields: dragCoeff, magnusCoeff, dx, dy');
          return;
        }
        if (!Array.isArray(json.trajectories)) {
          setImportError('Missing trajectories array');
          return;
        }
        const trajs: GeneratedTrajectory[] = (json.trajectories as Record<string, number>[]).map((t, i) => ({
          id: `import-${Date.now()}-${i}`,
          exitVelocity: t.speed ?? 0,
          exitAngle: t.exitAngle ?? 0,
          impactAngle: t.impactAngle ?? 0,
          timeOfFlight: t.timeOfFlight ?? 0,
          landingX: importedDx,
        }));
        const newGroup: TrajGroup = {
          id: `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          dx: importedDx,
          dy: importedDy,
          drag: importedDrag,
          magnus: importedMagnus,
          trajectories: trajs,
        };
        onImportGroup(newGroup);
      } catch {
        setImportError('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return null;
    return sortAsc ? <ChevronUp size={10} className="inline ml-0.5" /> : <ChevronDown size={10} className="inline ml-0.5" />;
  }

  function tabLabel(g: TrajGroup) {
    return `(${g.dx.toFixed(3)}, ${g.dy.toFixed(3)})`;
  }

  const totalTrajectoryCount = groups.reduce((sum, g) => sum + g.trajectories.length, 0);

  return (
    <aside className={`${panelAside} border-l border-gray-700`} style={{ width }}>

      {/* Group tabs */}
      <div className="flex-shrink-0 border-b border-gray-700 overflow-x-auto">
        {groups.length === 0 ? (
          <div className={`px-4 py-2 ${panelHint} italic`}>No trajectory groups yet</div>
        ) : (
          <div className="flex min-w-max">
            {groups.map(g => {
              const isActive = g.id === (group?.id ?? null);
              return (
                <div
                  key={g.id}
                  className={`flex items-center gap-1 border-r border-gray-700 group/tab ${isActive ? 'bg-gray-800' : 'bg-gray-900 hover:bg-gray-800/60'}`}
                >
                  <button
                    onClick={() => onSelectGroup(g.id)}
                    className={`px-2.5 py-2 text-sm ${panelMono} whitespace-nowrap transition-colors ${isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    {tabLabel(g)}
                    <span className={`ml-1.5 font-sans px-1.5 py-0.5 rounded text-xs ${isActive ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-800 text-gray-600'}`}>
                      {g.trajectories.length}
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteGroup(g.id); }}
                    title="Delete group"
                    className="mr-1.5 w-4 h-4 flex items-center justify-center text-gray-700 hover:text-red-400 opacity-0 group-hover/tab:opacity-100 transition-all rounded"
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Group header */}
      {group && (
        <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <h2 className={panelSectionTitle}>Trajectories</h2>
            <span className={`text-sm ${panelMono} bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full`}>
              {trajectories.length}
            </span>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <span className={panelMeta}>Drag</span>
              <span className={`text-sm ${panelMono} text-gray-400`}>{drag}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={panelMeta}>Magnus</span>
              <span className={`text-sm ${panelMono} text-gray-400`}>{magnus}</span>
            </div>
          </div>
        </div>
      )}

      {group ? (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Table header */}
          <div className={`flex-shrink-0 flex items-center gap-1 px-3 py-2 bg-gray-800/50 text-sm font-medium text-gray-500 border-b border-gray-700/60 select-none`}>
            <button className="flex-1 text-left hover:text-gray-300 transition-colors" onClick={() => handleSort('exitVelocity')}>
              Spd <SortIcon k="exitVelocity" />
            </button>
            <button className="flex-1 text-left hover:text-gray-300 transition-colors" onClick={() => handleSort('exitAngle')}>
              Exit <SortIcon k="exitAngle" />
            </button>
            <button className="flex-1 text-left hover:text-gray-300 transition-colors" onClick={() => handleSort('impactAngle')}>
              Impact <SortIcon k="impactAngle" />
            </button>
            <button className="flex-1 text-left hover:text-gray-300 transition-colors" onClick={() => handleSort('timeOfFlight')}>
              ToF <SortIcon k="timeOfFlight" />
            </button>
            <button className="flex-1 text-left hover:text-gray-300 transition-colors" onClick={() => handleSort('landingError')}>
              Err <SortIcon k="landingError" />
            </button>
            <div className="w-16" />
          </div>

          {/* Trajectory list — fills remaining panel height above bottom controls */}
          <div className="overflow-y-auto flex-1 min-h-0">
            {sorted.length === 0 ? (
              <div className={`flex flex-col items-center justify-center h-full text-gray-600 ${panelEmpty} px-4`}>
                <p>No trajectories in this group.</p>
              </div>
            ) : (
              sorted.map(traj => {
              const isHovered = hoveredTrajId === traj.id;
              const activeVel = activeCell?.id === traj.id && activeCell.field === 'exitVelocity';
              const activeAngle = activeCell?.id === traj.id && activeCell.field === 'exitAngle';

              const wasRefined = traj.successfulBracket !== undefined;
              const isInvalid = wasRefined && (traj.successfulBracket === false || traj.accurate === false);
              const invalidReason = !wasRefined ? null
                : traj.refineFailure === 'target_height' ? 'Failed to reach target height'
                : traj.refineFailure === 'bracket' ? 'No bracketing interval found'
                : traj.accurate === false ? 'Landing error exceeds accuracy threshold'
                : traj.successfulBracket === false ? 'No bracketing interval found'
                : null;

              return (
                <div
                  key={traj.id}
                  onMouseEnter={() => onHoverTraj(traj.id)}
                  onMouseLeave={() => onHoverTraj(null)}
                  className={`relative flex items-center gap-1 px-3 py-2 border-b transition-colors text-sm group ${
                    isInvalid
                      ? isHovered
                        ? 'bg-red-900/35 border-b-red-900/60 border-l-2 border-l-red-400'
                        : 'bg-red-950/20 border-b-red-900/40 hover:bg-red-900/25'
                      : isHovered
                      ? 'bg-blue-900/40 border-b-gray-800 border-l-2 border-l-blue-400'
                      : 'border-b-gray-800 hover:bg-gray-800/50'
                  }`}
                >
                  {isInvalid && isHovered && invalidReason && (
                    <div className="absolute left-2 -top-7 z-50 px-2 py-1 rounded bg-gray-950 border border-red-800/60 text-red-300 text-sm whitespace-nowrap shadow-lg pointer-events-none">
                      {invalidReason}
                    </div>
                  )}
                  {activeVel ? (
                    <input
                      ref={cellRef}
                      type="text"
                      inputMode="decimal"
                      value={cellRaw}
                      onChange={e => setCellRaw(e.target.value)}
                      onBlur={commitCell}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitCell(); }
                        if (e.key === 'Escape') { e.preventDefault(); setActiveCell(null); }
                      }}
                      className={`flex-1 ${panelMono} bg-transparent border-b border-blue-400 text-blue-200 focus:outline-none min-w-0 text-sm`}
                    />
                  ) : (
                    <span
                      className={`flex-1 font-mono cursor-text select-none ${
                        isInvalid ? (isHovered ? 'text-red-300' : 'text-red-400') : (isHovered ? 'text-blue-200' : 'text-white')
                      }`}
                      onDoubleClick={e => { e.stopPropagation(); openCell(traj.id, 'exitVelocity', traj.exitVelocity); }}
                    >
                      {traj.exitVelocity.toFixed(3)}
                    </span>
                  )}
                  {activeAngle ? (
                    <input
                      ref={activeVel ? undefined : cellRef}
                      type="text"
                      inputMode="decimal"
                      value={cellRaw}
                      onChange={e => setCellRaw(e.target.value)}
                      onBlur={commitCell}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitCell(); }
                        if (e.key === 'Escape') { e.preventDefault(); setActiveCell(null); }
                      }}
                      className={`flex-1 ${panelMono} bg-transparent border-b border-blue-400 text-blue-200 focus:outline-none min-w-0 text-sm`}
                    />
                  ) : (
                    <span
                      className={`flex-1 font-mono cursor-text select-none ${
                        isInvalid ? (isHovered ? 'text-red-300' : 'text-red-500') : (isHovered ? 'text-blue-200' : 'text-gray-300')
                      }`}
                      onDoubleClick={e => { e.stopPropagation(); openCell(traj.id, 'exitAngle', traj.exitAngle); }}
                    >
                      {traj.exitAngle.toFixed(2)}°
                    </span>
                  )}
                  <span className={`flex-1 font-mono ${
                    isInvalid ? (isHovered ? 'text-red-300' : 'text-red-500') : (isHovered ? 'text-blue-200' : 'text-gray-300')
                  }`}>{traj.impactAngle.toFixed(2)}°</span>
                  <span className={`flex-1 font-mono ${
                    isInvalid ? (isHovered ? 'text-red-300' : 'text-red-600') : (isHovered ? 'text-blue-300' : 'text-gray-400')
                  }`}>{traj.timeOfFlight.toFixed(3)}s</span>
                  <span className={`flex-1 font-mono ${
                    traj.landingError === null
                      ? 'text-gray-600'
                      : isInvalid
                      ? (isHovered ? 'text-red-300' : 'text-red-600')
                      : traj.landingError > 0
                      ? (isHovered ? 'text-orange-300' : 'text-orange-400')
                      : traj.landingError < 0
                      ? (isHovered ? 'text-sky-300' : 'text-sky-400')
                      : (isHovered ? 'text-green-300' : 'text-green-400')
                  }`}>
                    {traj.landingError === null ? '—' : `${traj.landingError > 0 ? '+' : ''}${traj.landingError.toFixed(2)}mm`}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      title="Copy (Ctrl+C)"
                      onClick={(e) => { e.stopPropagation(); handleCopy(traj.id); }}
                      className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-blue-400 transition-colors rounded"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      title="Refine this trajectory (Ctrl+Z)"
                      onClick={(e) => { e.stopPropagation(); handleRefineOne(traj.id); }}
                      className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-amber-400 transition-colors rounded"
                    >
                      <RefreshCw size={11} />
                    </button>
                    <button
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); if (group) onDeleteTraj(group.id, traj.id); }}
                      className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors rounded"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
          </div>

          {/* Bottom controls — natural height only, scrolls if panel is very short */}
          <div className="flex-shrink-0 p-4 space-y-4 border-t border-gray-700">
            {/* Manage */}
            <div className="space-y-2">
              <h3 className={panelSectionTitle}>Manage</h3>
              <button
                onClick={onClearAll}
                disabled={groups.length === 0}
                className={`w-full ${panelBtnPrimary} ${
                  groups.length === 0
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-red-900/60 hover:bg-red-800/70 text-red-300 hover:text-red-200'
                }`}
              >
                <XCircle size={14} />
                Clear All
              </button>
            </div>

            {/* Import / Export */}
            <div className="space-y-2">
              <h3 className={panelSectionTitle}>Import / Export</h3>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              <button
                onClick={() => { setImportError(null); importInputRef.current?.click(); }}
                className={`w-full ${panelBtnPrimary} bg-blue-700 hover:bg-blue-600 text-white`}
              >
                <Upload size={14} />
                Import JSON
              </button>
              {importError && (
                <p className="text-sm text-red-400">{importError}</p>
              )}
              <button
                type="button"
                onClick={handleDownload}
                disabled={totalTrajectoryCount === 0}
                className={`w-full ${panelBtnPrimary} ${
                  totalTrajectoryCount === 0
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-green-700 hover:bg-green-600 text-white'
                }`}
              >
                <Download size={14} />
                Download All Trajectories
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={`flex-1 flex items-center justify-center text-gray-600 ${panelEmpty} px-4`}>
          <p>Generate trajectories to get started.</p>
        </div>
      )}
    </aside>
  );
}
