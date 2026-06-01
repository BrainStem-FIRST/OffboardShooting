import { useState, useEffect, useRef } from 'react';
import { GeneratedTrajectory, TrajGroup, TrajGenParams } from '../types';
import { Trash2, Download, Upload, Plus, RefreshCw, Copy, ChevronUp, ChevronDown, XCircle, X } from 'lucide-react';
import { simulateLanding, simulateImpactAngle, simulatePeakHeight, refineTrajectory } from '../simulation';

interface Props {
  groups: TrajGroup[];
  selectedGroupId: string | null;
  selectedTrajId: string | null;
  hoveredTrajId: string | null;
  onSelectGroup: (id: string) => void;
  onSelectTraj: (id: string) => void;
  onHoverTraj: (id: string | null) => void;
  onDeleteTraj: (groupId: string, trajId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onUpdateGroup: (groupId: string, trajs: GeneratedTrajectory[]) => void;
  onImportGroup: (group: TrajGroup) => void;
  params: TrajGenParams;
  width: number;
}

type SortKey = 'exitVelocity' | 'exitAngle' | 'impactAngle' | 'timeOfFlight' | 'landingError';
type ConstMode = 'velocity' | 'angle';

function FreeNumInput({ value, min, max, onChange, className }: {
  value: number; min?: number; max?: number;
  onChange: (v: number) => void; className?: string;
}) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);

  function commit(str: string) {
    const stripped = str.replace(/[^0-9.\-]/g, '');
    let n = parseFloat(stripped);
    if (isNaN(n)) n = min ?? 0;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setRaw(String(n));
    onChange(n);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { setFocused(false); commit(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={className}
    />
  );
}

export default function TrajectoryGenRight({
  groups, selectedGroupId, selectedTrajId, hoveredTrajId,
  onSelectGroup, onSelectTraj, onHoverTraj,
  onDeleteTraj, onDeleteGroup, onUpdateGroup, onImportGroup,
  params, width
}: Props) {
  const group = groups.find(g => g.id === selectedGroupId) ?? groups[0] ?? null;
  const trajectories = group?.trajectories ?? [];
  const drag = group?.drag ?? params.dragCoefficient;
  const magnus = group?.magnus ?? params.magnusGain;

  const [refineMaxIter, setRefineMaxIter] = useState(200);
  const [refineThreshold, setRefineThreshold] = useState(0.001);
  const [constMode, setConstMode] = useState<ConstMode>('velocity');
  const [refining, setRefining] = useState(false);
  const [manualVel, setManualVel] = useState(8);
  const [manualAngle, setManualAngle] = useState(45);
  const [downloadName, setDownloadName] = useState('trajectories');
  const [sortKey, setSortKey] = useState<SortKey>('exitAngle');
  const [sortAsc, setSortAsc] = useState(true);
  const [splitPct, setSplitPct] = useState(45);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
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

  // Stable refs for keybinds
  const selectedTrajIdRef = useRef(selectedTrajId);
  const trajectoriesRef = useRef(trajectories);
  const groupRef = useRef(group);
  const paramsRef = useRef(params);
  const dragRef = useRef(drag);
  const magnusRef = useRef(magnus);
  const refineMaxIterRef = useRef(refineMaxIter);
  const refineThresholdRef = useRef(refineThreshold);
  const constModeRef = useRef(constMode);
  useEffect(() => { selectedTrajIdRef.current = selectedTrajId; }, [selectedTrajId]);
  useEffect(() => { trajectoriesRef.current = trajectories; }, [trajectories]);
  useEffect(() => { groupRef.current = group; }, [group]);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  useEffect(() => { magnusRef.current = magnus; }, [magnus]);
  useEffect(() => { refineMaxIterRef.current = refineMaxIter; }, [refineMaxIter]);
  useEffect(() => { refineThresholdRef.current = refineThreshold; }, [refineThreshold]);
  useEffect(() => { constModeRef.current = constMode; }, [constMode]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const id = selectedTrajIdRef.current;
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
        };
        onUpdateGroup(g.id, [...trajectoriesRef.current, copy]);
      }
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        const traj = trajectoriesRef.current.find(t => t.id === id);
        if (!traj) return;
        const p = paramsRef.current;
        const d = dragRef.current;
        const m = magnusRef.current;
        const dx = g.dx;
        const dy = g.dy;
        const gParams = { ...p, dx, dy };
        const result = refineTrajectory(traj, gParams, d, m, refineMaxIterRef.current, refineThresholdRef.current, constModeRef.current);
        const t = result.trajectory;
        const impact = simulateImpactAngle(t.exitVelocity, t.exitAngle, d, m, dx);
        const withImpact = { ...t, impactAngle: impact !== null ? Math.round(impact * 100) / 100 : t.impactAngle };
        let refined: GeneratedTrajectory;
        if (!result.successfulBracket) {
          refined = withImpact;
        } else {
          const landing = simulateLanding(t.exitVelocity, t.exitAngle, d, m, dx, dy);
          const inGoal = landing !== null && Math.abs(landing.landingY - dy) <= p.goalWidth / 2;
          refined = { ...withImpact, successfulBracket: inGoal, accurate: result.accurate };
        }
        onUpdateGroup(g.id, trajectoriesRef.current.map(tr => tr.id === id ? refined : tr));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    const container = containerRef.current;
    if (!container) return;
    function onMove(ev: MouseEvent) {
      if (!draggingRef.current || !container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setSplitPct(Math.min(85, Math.max(15, pct)));
    }
    function onUp() {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

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
        const landing = simulateLanding(next.exitVelocity, next.exitAngle, drag, magnus, group.dx, group.dy);
        const impact = simulateImpactAngle(next.exitVelocity, next.exitAngle, drag, magnus, group.dx);
        return {
          ...next,
          timeOfFlight: landing ? landing.timeOfFlight : t.timeOfFlight,
          impactAngle: impact !== null ? Math.round(impact * 100) / 100 : t.impactAngle,
        };
      }));
    }
    committingRef.current = false;
  }

  const withLandingError = group ? trajectories.map(t => {
    const landing = simulateLanding(t.exitVelocity, t.exitAngle, drag, magnus, group.dx, group.dy);
    const landingError = landing !== null ? (landing.landingY - group.dy) * 1000 : null;
    return { ...t, landingError };
  }) : [];

  const sorted = [...withLandingError].sort((a, b) => {
    const aVal = sortKey === 'landingError' ? (a.landingError ?? Infinity) : a[sortKey];
    const bVal = sortKey === 'landingError' ? (b.landingError ?? Infinity) : b[sortKey];
    const diff = aVal - bVal;
    return sortAsc ? diff : -diff;
  });

  function handleRefine() {
    if (!group) return;
    setRefining(true);
    setTimeout(() => {
      const gParams = { ...params, dx: group.dx, dy: group.dy };
      const results = trajectories.map(t =>
        refineTrajectory(t, gParams, drag, magnus, refineMaxIter, refineThreshold, constMode)
      );
      const withValidity = results.map(r => {
        const t = r.trajectory;
        const impact = simulateImpactAngle(t.exitVelocity, t.exitAngle, drag, magnus, group.dx);
        const withImpact = { ...t, impactAngle: impact !== null ? Math.round(impact * 100) / 100 : t.impactAngle };
        if (!r.successfulBracket) return withImpact;
        const landing = simulateLanding(t.exitVelocity, t.exitAngle, drag, magnus, group.dx, group.dy);
        const inGoal = landing !== null && Math.abs(landing.landingY - group.dy) <= params.goalWidth / 2;
        return { ...withImpact, successfulBracket: inGoal, accurate: r.accurate };
      });
      const VEL_TOL = 0.05;
      const ANG_TOL = 0.25;
      const deduped = withValidity.filter((t, i) =>
        !withValidity.slice(0, i).some(
          other => Math.abs(other.exitVelocity - t.exitVelocity) <= VEL_TOL && Math.abs(other.exitAngle - t.exitAngle) <= ANG_TOL
        )
      );
      onUpdateGroup(group.id, deduped);
      setRefining(false);
    }, 0);
  }

  function handleAddManual() {
    if (!group) return;
    const landing = simulateLanding(manualVel, manualAngle, drag, magnus, group.dx, group.dy);
    const impact = simulateImpactAngle(manualVel, manualAngle, drag, magnus, group.dx);
    const newTraj: GeneratedTrajectory = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      exitVelocity: manualVel,
      exitAngle: manualAngle,
      impactAngle: impact !== null ? Math.round(impact * 100) / 100 : 0,
      timeOfFlight: landing ? landing.timeOfFlight : 0,
      landingX: group.dx,
    };
    onUpdateGroup(group.id, [...trajectories, newTraj]);
  }

  function handleCopy(id: string) {
    if (!group) return;
    const traj = trajectories.find(t => t.id === id);
    if (!traj) return;
    const copy: GeneratedTrajectory = {
      ...traj,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      successfulBracket: undefined,
      accurate: undefined,
    };
    onUpdateGroup(group.id, [...trajectories, copy]);
  }

  function handleRefineOne(id: string) {
    if (!group) return;
    const traj = trajectories.find(t => t.id === id);
    if (!traj) return;
    const gParams = { ...params, dx: group.dx, dy: group.dy };
    const result = refineTrajectory(traj, gParams, drag, magnus, refineMaxIter, refineThreshold, constMode);
    const t = result.trajectory;
    const impact = simulateImpactAngle(t.exitVelocity, t.exitAngle, drag, magnus, group.dx);
    const withImpact = { ...t, impactAngle: impact !== null ? Math.round(impact * 100) / 100 : t.impactAngle };
    let refined: GeneratedTrajectory;
    if (!result.successfulBracket) {
      refined = withImpact;
    } else {
      const landing = simulateLanding(t.exitVelocity, t.exitAngle, drag, magnus, group.dx, group.dy);
      const inGoal = landing !== null && Math.abs(landing.landingY - group.dy) <= params.goalWidth / 2;
      refined = { ...withImpact, successfulBracket: inGoal, accurate: result.accurate };
    }
    onUpdateGroup(group.id, trajectories.map(tr => tr.id === id ? refined : tr));
  }

  function handleDownload() {
    if (!group) return;
    const payload = {
      dx: group.dx,
      dy: group.dy,
      dragCoeff: group.drag,
      magnusCoeff: group.magnus,
      trajectories: trajectories.map(t => ({
        exitAngle: t.exitAngle,
        impactAngle: t.impactAngle,
        speed: t.exitVelocity,
        timeOfFlight: t.timeOfFlight,
        peakHeight: Math.round(simulatePeakHeight(t.exitVelocity, t.exitAngle, group.drag, group.magnus) * 1000) / 1000,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${downloadName || 'trajectories'} (${group.dx.toFixed(3)}, ${group.dy.toFixed(3)}).json`;
    a.click();
    URL.revokeObjectURL(url);
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

  const constModeOptions: { value: ConstMode; label: string }[] = [
    { value: 'velocity', label: 'Speed' },
    { value: 'angle', label: 'Angle' },
  ];

  // Tab label: (dx, dy) both to 3 dp
  function tabLabel(g: TrajGroup) {
    return `(${g.dx.toFixed(3)}, ${g.dy.toFixed(3)})`;
  }

  return (
    <aside ref={containerRef} className="flex flex-col bg-gray-900 border-l border-gray-700 h-full overflow-hidden" style={{ width }}>

      {/* Group tabs */}
      <div className="flex-shrink-0 border-b border-gray-700 overflow-x-auto">
        {groups.length === 0 ? (
          <div className="px-4 py-2 text-xs text-gray-600 italic">No trajectory groups yet</div>
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
                    className={`px-2.5 py-2 text-xs font-mono whitespace-nowrap transition-colors ${isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    {tabLabel(g)}
                    <span className={`ml-1.5 font-sans px-1 py-0.5 rounded text-xs ${isActive ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-800 text-gray-600'}`}>
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
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Trajectories</h2>
            <span className="text-xs font-mono bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full">
              {trajectories.length}
            </span>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-600">Drag</span>
              <span className="text-xs font-mono text-gray-400">{drag}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-600">Magnus</span>
              <span className="text-xs font-mono text-gray-400">{magnus}</span>
            </div>
          </div>
        </div>
      )}

      {/* Table header */}
      {group && (
        <div className="flex-shrink-0 flex items-center gap-1 px-3 py-2 bg-gray-800/50 text-xs font-medium text-gray-500 border-b border-gray-700/60 select-none">
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
      )}

      {/* Trajectory list */}
      {group ? (
        <div className="overflow-y-auto min-h-0" style={{ height: `calc(${splitPct}% - 56px)` }}>
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 text-xs text-center px-4">
              <p>No trajectories in this group.</p>
            </div>
          ) : (
            sorted.map(traj => {
              const isSelected = selectedTrajId === traj.id;
              const isHovered = hoveredTrajId === traj.id;
              const highlighted = isSelected || isHovered;
              const activeVel = activeCell?.id === traj.id && activeCell.field === 'exitVelocity';
              const activeAngle = activeCell?.id === traj.id && activeCell.field === 'exitAngle';

              const wasRefined = traj.successfulBracket !== undefined;
              const isInvalid = wasRefined && (traj.successfulBracket === false || traj.accurate === false);
              const invalidReason = !wasRefined ? null
                : traj.successfulBracket === false ? 'No bracketing interval found'
                : traj.accurate === false ? 'Landing error exceeds accuracy threshold'
                : null;

              return (
                <div
                  key={traj.id}
                  onClick={() => { if (!activeCell) onSelectTraj(traj.id); }}
                  onMouseEnter={() => onHoverTraj(traj.id)}
                  onMouseLeave={() => onHoverTraj(null)}
                  className={`relative flex items-center gap-1 px-3 py-2 cursor-pointer border-b transition-colors text-xs group ${
                    isInvalid
                      ? isSelected
                        ? 'bg-red-900/40 border-b-red-900/60 border-l-2 border-l-red-400'
                        : isHovered
                        ? 'bg-red-900/30 border-b-red-900/60 border-l-2 border-l-red-500/60'
                        : 'bg-red-950/20 border-b-red-900/40 hover:bg-red-900/25'
                      : isSelected
                      ? 'bg-yellow-900/30 border-b-gray-800 border-l-2 border-l-yellow-400'
                      : isHovered
                      ? 'bg-yellow-900/20 border-b-gray-800 border-l-2 border-l-yellow-500/60'
                      : 'border-b-gray-800 hover:bg-gray-800/50'
                  }`}
                >
                  {isInvalid && isHovered && invalidReason && (
                    <div className="absolute left-2 -top-7 z-50 px-2 py-1 rounded bg-gray-950 border border-red-800/60 text-red-300 text-xs whitespace-nowrap shadow-lg pointer-events-none">
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
                      className="flex-1 font-mono bg-transparent border-b border-blue-400 text-blue-200 focus:outline-none min-w-0 text-xs"
                    />
                  ) : (
                    <span
                      className={`flex-1 font-mono cursor-text select-none ${
                        isInvalid ? (highlighted ? 'text-red-300' : 'text-red-400') : (highlighted ? 'text-yellow-200' : 'text-white')
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
                      className="flex-1 font-mono bg-transparent border-b border-blue-400 text-blue-200 focus:outline-none min-w-0 text-xs"
                    />
                  ) : (
                    <span
                      className={`flex-1 font-mono cursor-text select-none ${
                        isInvalid ? (highlighted ? 'text-red-400' : 'text-red-500') : (highlighted ? 'text-yellow-300' : 'text-gray-300')
                      }`}
                      onDoubleClick={e => { e.stopPropagation(); openCell(traj.id, 'exitAngle', traj.exitAngle); }}
                    >
                      {traj.exitAngle.toFixed(2)}°
                    </span>
                  )}
                  <span className={`flex-1 font-mono ${
                    isInvalid ? (highlighted ? 'text-red-400' : 'text-red-500') : (highlighted ? 'text-yellow-300' : 'text-gray-300')
                  }`}>{traj.impactAngle.toFixed(2)}°</span>
                  <span className={`flex-1 font-mono ${
                    isInvalid ? (highlighted ? 'text-red-400' : 'text-red-600') : (highlighted ? 'text-yellow-400' : 'text-gray-400')
                  }`}>{traj.timeOfFlight.toFixed(3)}s</span>
                  <span className={`flex-1 font-mono ${
                    traj.landingError === null
                      ? 'text-gray-600'
                      : isInvalid
                      ? (highlighted ? 'text-red-400' : 'text-red-600')
                      : traj.landingError > 0
                      ? (highlighted ? 'text-orange-300' : 'text-orange-400')
                      : traj.landingError < 0
                      ? (highlighted ? 'text-sky-300' : 'text-sky-400')
                      : (highlighted ? 'text-green-300' : 'text-green-400')
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
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-xs text-center px-4">
          <p>Generate trajectories to get started.</p>
        </div>
      )}

      {group && (
        <>
          {/* Draggable divider */}
          <div
            onMouseDown={handleDividerMouseDown}
            className="flex-shrink-0 h-1.5 bg-gray-700 hover:bg-blue-500 active:bg-blue-400 cursor-row-resize transition-colors group relative"
            title="Drag to resize"
          >
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center gap-0.5 pointer-events-none">
              <span className="w-4 h-px bg-gray-500 group-hover:bg-blue-300 transition-colors" />
              <span className="w-4 h-px bg-gray-500 group-hover:bg-blue-300 transition-colors" />
            </div>
          </div>

          {/* Bottom controls */}
          <div className="flex-1 border-gray-700 p-4 space-y-4 overflow-y-auto min-h-0">

            {/* Refine */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Refine Trajectories</h3>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Keep Constant</label>
                <div className="flex rounded-md overflow-hidden border border-gray-700">
                  {constModeOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setConstMode(opt.value)}
                      className={`flex-1 text-xs py-1.5 transition-colors ${
                        constMode === opt.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Max Iterations</label>
                  <FreeNumInput value={refineMaxIter} min={1} step={50}
                    onChange={(v) => setRefineMaxIter(Math.max(1, Math.round(v)))}
                    className="w-full text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Threshold (m)</label>
                  <FreeNumInput value={refineThreshold} min={0.0001} step={0.0001}
                    onChange={(v) => setRefineThreshold(Math.max(0.0001, v))}
                    className="w-full text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <button
                onClick={handleRefine}
                disabled={refining || trajectories.length === 0}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  refining || trajectories.length === 0
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                <RefreshCw size={13} className={refining ? 'animate-spin' : ''} />
                {refining ? 'Refining...' : 'Refine Trajectories'}
              </button>
            </div>

            {/* Manual add */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Add Manually</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Speed (m/s)</label>
                  <FreeNumInput value={manualVel} step={0.1} min={0}
                    onChange={(v) => setManualVel(v)}
                    className="w-full text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Angle (deg)</label>
                  <FreeNumInput value={manualAngle} step={0.5}
                    onChange={(v) => setManualAngle(v)}
                    className="w-full text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <button
                onClick={handleAddManual}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              >
                <Plus size={13} />
                Add Trajectory
              </button>
            </div>

            {/* Manage */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Manage</h3>
              <button
                onClick={() => group && onUpdateGroup(group.id, trajectories.filter(t => t.accurate === true))}
                disabled={trajectories.length === 0}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  trajectories.length === 0
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-700 hover:bg-gray-600 text-white'
                }`}
              >
                <Trash2 size={13} />
                Delete Unsuccessful
              </button>
              <button
                onClick={() => group && onUpdateGroup(group.id, [])}
                disabled={trajectories.length === 0}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  trajectories.length === 0
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-red-900/60 hover:bg-red-800/70 text-red-300 hover:text-red-200'
                }`}
              >
                <XCircle size={13} />
                Clear All
              </button>
            </div>

            {/* Import / Export */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Import / Export</h3>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              <button
                onClick={() => { setImportError(null); importInputRef.current?.click(); }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-blue-700 hover:bg-blue-600 text-white transition-colors"
              >
                <Upload size={13} />
                Import JSON
              </button>
              {importError && (
                <p className="text-xs text-red-400">{importError}</p>
              )}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Export File Name</label>
                <input
                  type="text"
                  value={downloadName}
                  onChange={e => setDownloadName(e.target.value)}
                  className="w-full text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
                  placeholder="trajectories"
                />
              </div>
              <button
                onClick={handleDownload}
                disabled={trajectories.length === 0}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  trajectories.length === 0
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-green-700 hover:bg-green-600 text-white'
                }`}
              >
                <Download size={13} />
                Download Trajectories
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
