import { useState, useEffect, useRef } from 'react';
import { GeneratedTrajectory, TrajGroup, TrajGenParams } from '../types';
import { Trash2, Download, Upload, RefreshCw, Copy, ChevronUp, ChevronDown, XCircle, X, FolderOpen, Save } from 'lucide-react';
import { ImportFolderButton } from './ImportFolderButton';
import {
  simulateLanding, simulateImpactAngle, refineTrajectory, downloadTrajectoriesArchive,
  REFINE_MAX_ITER, REFINE_THRESHOLD_M, RAW_TRAJECTORY_ERROR_TOLERANCE, type TrajectoryMoe, type MoeRecalcProgress,
} from '../simulation';
import {
  panelAside, panelSectionTitle, panelBtnPrimary,
  panelEmpty, panelHint, panelMeta, panelMono, panelSubsectionTitle, panelInput,
} from './panelStyles';
import { ProgressBar } from './ProgressBar';
import { CheckboxLabel } from './Checkbox';
import { isUnsuccessfulTrajectory } from '../utils/trajGenStatus';
import { parseTrajGroupFromText, loadTrajGroupsFromDirectory, saveTrajGroupsToDirectory } from '../utils/trajGenIO';

interface Props {
  groups: TrajGroup[];
  selectedGroupId: string | null;
  hoveredTrajId: string | null;
  trajMoeById: Map<string, TrajectoryMoe>;
  bestMoeTrajIds: Set<string>;
  onSelectGroup: (id: string) => void;
  onHoverTraj: (id: string | null) => void;
  onDeleteTraj: (groupId: string, trajId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onUpdateGroup: (groupId: string, trajs: GeneratedTrajectory[]) => void;
  onImportGroups: (groups: TrajGroup[], mode: 'replace' | 'append') => void;
  onClearAll: () => void;
  onDeleteUnsuccessful: () => void;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
  showBiggestMoe: boolean;
  onShowBiggestMoeChange: (showBiggestMoe: boolean) => void;
  params: TrajGenParams;
  onParamsChange: (params: TrajGenParams) => void;
  onRecalculateMoe: (errorTolerance: number) => void;
  moeRecalculating: boolean;
  moeRecalcProgress: MoeRecalcProgress | null;
  width: number;
}

function ErrorToleranceInput({
  value,
  onChange,
  onRecalculate,
  recalcDisabled,
  recalculating,
  recalcProgress,
}: {
  value: number;
  onChange: (v: number) => void;
  onRecalculate: (errorTolerance: number) => void;
  recalcDisabled: boolean;
  recalculating: boolean;
  recalcProgress: MoeRecalcProgress | null;
}) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);

  function commit(str: string) {
    const stripped = str.replace(/[^0-9.\-]/g, '');
    let n = parseFloat(stripped);
    if (isNaN(n)) n = 0.05;
    n = Math.max(0.05, n);
    setRaw(String(n));
    onChange(n);
    return n;
  }

  function handleRecalculate() {
    const n = commit(raw);
    onRecalculate(n);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className={panelSubsectionTitle}>Error Tolerance</label>
        <span className={panelMeta}>m</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={(e) => { setFocused(false); commit(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className={`${panelInput} flex-1 min-w-0`}
        />
        <button
          type="button"
          onClick={handleRecalculate}
          disabled={recalcDisabled || recalculating}
          className={`flex-shrink-0 px-2.5 py-1.5 text-sm rounded border transition-colors ${
            recalcDisabled || recalculating
              ? 'border-gray-700 bg-gray-800 text-gray-500 cursor-not-allowed'
              : 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-white'
          }`}
        >
          {recalculating ? 'Recalculating…' : 'Recalculate'}
        </button>
      </div>
      {recalculating && (
        <ProgressBar
          className="pt-1"
          progress={recalcProgress?.progress ?? 0}
          fillClassName="bg-green-500"
          detail={
            recalcProgress
              ? `Trajectory ${recalcProgress.current.toLocaleString()} / ${recalcProgress.total.toLocaleString()}`
              : 'Starting…'
          }
        />
      )}
    </div>
  );
}

type SortKey = 'exitVelocity' | 'exitAngle' | 'impactAngle' | 'timeOfFlight' | 'landingError';

export default function TrajectoryGenRight({
  groups, selectedGroupId, hoveredTrajId, trajMoeById, bestMoeTrajIds,
  onSelectGroup, onHoverTraj,
  onDeleteTraj, onDeleteGroup, onUpdateGroup, onImportGroups, onClearAll, onDeleteUnsuccessful,
  showAll, onShowAllChange, showBiggestMoe, onShowBiggestMoeChange,
  params, onParamsChange, onRecalculateMoe, moeRecalculating, moeRecalcProgress, width
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
  const importBusyRef = useRef(false);
  const saveBusyRef = useRef(false);
  const trajWriteDirRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importStatus, setImportStatus] = useState<{ ok: boolean | null; text: string } | null>(null);
  const [folderImportPrompt, setFolderImportPrompt] = useState<TrajGroup[] | null>(null);

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
  ): GeneratedTrajectory {
    const t = result.trajectory;
    const impact = simulateImpactAngle(t.exitVelocity, t.exitAngle, dragRef.current, magnusRef.current, dx);
    const withImpact = { ...t, impactAngle: impact !== null ? Math.round(impact * 100) / 100 : t.impactAngle };
    if (!result.successfulBracket) return withImpact;
    const landing = simulateLanding(t.exitVelocity, t.exitAngle, dragRef.current, magnusRef.current, dy);
    const inGoal = landing !== null && Math.abs(landing.landingX - dx) <= RAW_TRAJECTORY_ERROR_TOLERANCE / 2;
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
        const refined = applyRefineResult(traj, result, g.dx, g.dy);
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
    const refined = applyRefineResult(traj, result, group.dx, group.dy);
    onUpdateGroup(group.id, trajectories.map(tr => tr.id === id ? refined : tr));
  }

  function handleDownload() {
    downloadTrajectoriesArchive(groups, params);
  }

  function handleSaveAllClick() {
    if (saveBusyRef.current || importBusyRef.current) return;
    if (totalTrajectoryCount === 0) return;

    if (!trajWriteDirRef.current) {
      setImportStatus({
        ok: false,
        text: 'Import a trajectory folder first — Save All writes to the folder you imported from.',
      });
      return;
    }

    saveBusyRef.current = true;
    setSaving(true);
    setImportStatus(null);

    void (async () => {
      try {
        const result = await saveTrajGroupsToDirectory(
          trajWriteDirRef.current!,
          groups,
          params.errorTolerance,
          (current, total) => {
            setImportStatus({ ok: null, text: `Saving trajectories ${current}/${total}…` });
          },
        );
        if (!result.ok) {
          setImportStatus({ ok: false, text: result.message });
          return;
        }
        setImportStatus({
          ok: true,
          text: `Saved ${result.count} trajectory file(s) to imported folder (replaced existing).`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setImportStatus({ ok: false, text: `Could not save trajectories: ${msg}` });
      } finally {
        saveBusyRef.current = false;
        setSaving(false);
      }
    })();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportStatus(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const group = parseTrajGroupFromText(ev.target?.result as string);
      if (!group) {
        setImportStatus({ ok: false, text: 'Invalid JSON or missing required fields (dragCoeff, magnusCoeff, dx, dy, trajectories).' });
        return;
      }
      onImportGroups([group], 'append');
      setImportStatus({ ok: true, text: `Imported 1 group (${group.dx.toFixed(3)}, ${group.dy.toFixed(3)}).` });
    };
    reader.onerror = () => setImportStatus({ ok: false, text: 'Failed to read file.' });
    reader.readAsText(file);
  }

  function applyFolderImport(groups: TrajGroup[], mode: 'replace' | 'append') {
    onImportGroups(groups, mode);
    setFolderImportPrompt(null);
    setImportStatus({
      ok: true,
      text: mode === 'replace'
        ? `Imported ${groups.length} group(s), replaced current trajectories. Save All will update this folder.`
        : `Imported ${groups.length} group(s), added to current trajectories. Save All will update this folder.`,
    });
  }

  async function handleImportTrajFolder(dir: FileSystemDirectoryHandle) {
    setImportStatus({ ok: null, text: 'Loading trajectory files…' });
    const loadResult = await loadTrajGroupsFromDirectory(dir);
    if (!loadResult.ok) {
      setImportStatus({ ok: false, text: loadResult.message });
      return;
    }

    trajWriteDirRef.current = loadResult.writeDir;

    if (totalTrajectoryCount > 0) {
      setFolderImportPrompt(loadResult.groups);
      if (loadResult.warnings.length > 0) {
        setImportStatus({ ok: null, text: loadResult.warnings.join(' ') });
      }
      return;
    }

    applyFolderImport(loadResult.groups, 'replace');
    if (loadResult.warnings.length > 0) {
      setImportStatus((prev) => ({
        ok: true,
        text: `${prev?.text ?? `Imported ${loadResult.groups.length} group(s). Save All will update this folder.`} ${loadResult.warnings.join(' ')}`.trim(),
      }));
    } else {
      setImportStatus({
        ok: true,
        text: `Imported ${loadResult.groups.length} group(s). Save All will update this folder.`,
      });
    }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return null;
    return sortAsc ? <ChevronUp size={10} className="inline ml-0.5" /> : <ChevronDown size={10} className="inline ml-0.5" />;
  }

  function tabLabel(g: TrajGroup) {
    return `(${g.dx.toFixed(3)}, ${g.dy.toFixed(3)})`;
  }

  const totalTrajectoryCount = groups.reduce((sum, g) => sum + g.trajectories.length, 0);
  const unsuccessfulCount = groups.reduce(
    (sum, g) => sum + g.trajectories.filter(isUnsuccessfulTrajectory).length,
    0
  );

  return (
    <aside className={`${panelAside} border-l border-gray-700`} style={{ width }}>

      {folderImportPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-600 rounded-lg p-4 max-w-sm w-full space-y-3 shadow-xl">
            <h3 className="text-sm font-semibold text-white">Import trajectory folder?</h3>
            <p className={`${panelHint} text-gray-400`}>
              Found {folderImportPrompt.length} group{folderImportPrompt.length !== 1 ? 's' : ''} in the selected folder.
              You already have trajectories loaded.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => applyFolderImport(folderImportPrompt, 'replace')}
                className={`w-full ${panelBtnPrimary} bg-blue-700 hover:bg-blue-600 text-white`}
              >
                Replace current trajectories
              </button>
              <button
                type="button"
                onClick={() => applyFolderImport(folderImportPrompt, 'append')}
                className={`w-full ${panelBtnPrimary} bg-gray-700 hover:bg-gray-600 text-white`}
              >
                Add to current trajectories
              </button>
              <button
                type="button"
                onClick={() => setFolderImportPrompt(null)}
                className={`w-full ${panelBtnPrimary} bg-gray-800 hover:bg-gray-700 text-gray-300`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Title + show all */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h2 className={panelSectionTitle}>Trajectories</h2>
          <span className={`text-sm ${panelMono} bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full`}>
            {totalTrajectoryCount}
          </span>
        </div>
        <div className="space-y-1.5">
          <CheckboxLabel
            checked={showAll}
            disabled={groups.length === 0}
            onChange={onShowAllChange}
            label="Show all"
            labelClassName="text-sm text-gray-400"
          />
          <CheckboxLabel
            checked={showBiggestMoe}
            disabled={groups.length === 0}
            onChange={onShowBiggestMoeChange}
            label="Show biggest MOE"
            labelClassName="text-sm text-gray-400"
            color="green"
          />
        </div>
      </div>

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

      {/* Selected group meta */}
      {group && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-gray-700 flex gap-4">
          <div className="flex items-center gap-1.5">
            <span className={panelMeta}>Drag</span>
            <span className={`text-sm ${panelMono} text-gray-400`}>{drag}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={panelMeta}>Magnus</span>
            <span className={`text-sm ${panelMono} text-gray-400`}>{magnus}</span>
          </div>
          <span className={`ml-auto text-sm ${panelMono} text-gray-500`}>
            {trajectories.length} in tab
          </span>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0">
      {group ? (
        <>
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
              const isMaxMoe = bestMoeTrajIds.has(traj.id);
              const moe = trajMoeById.get(traj.id);
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
                      : isMaxMoe
                      ? isHovered
                        ? 'bg-green-900/40 border-b-gray-800 border-l-2 border-l-green-300'
                        : 'bg-green-950/30 border-b-gray-800 border-l-2 border-l-green-500'
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
                      {moe && (
                        <span className={`text-xs ${isMaxMoe ? 'text-green-400' : 'text-gray-500'}`}>
                          {' '}±{moe.speedMoe.toFixed(3)}
                        </span>
                      )}
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
                      {moe && (
                        <span className={`text-xs ${isMaxMoe ? 'text-green-400' : 'text-gray-500'}`}>
                          {' '}±{moe.angleMoe.toFixed(2)}°
                        </span>
                      )}
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
        </>
      ) : (
        <div className={`flex-1 flex items-center justify-center text-gray-600 ${panelEmpty} px-4 min-h-0`}>
          <p>Generate trajectories to get started.</p>
        </div>
      )}

      {/* Bottom controls — always visible */}
      <div className="flex-shrink-0 p-4 space-y-4 border-t border-gray-700">
            <div className="space-y-2">
              <h3 className={panelSectionTitle}>Optimal trajectory</h3>
              <ErrorToleranceInput
                value={params.errorTolerance}
                onChange={(v) => onParamsChange({ ...params, errorTolerance: v })}
                onRecalculate={onRecalculateMoe}
                recalcDisabled={groups.length === 0}
                recalculating={moeRecalculating}
                recalcProgress={moeRecalcProgress}
              />
            </div>

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
              <button
                onClick={onDeleteUnsuccessful}
                disabled={unsuccessfulCount === 0}
                className={`w-full ${panelBtnPrimary} ${
                  unsuccessfulCount === 0
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-700 hover:bg-gray-600 text-white'
                }`}
              >
                <Trash2 size={14} />
                Delete Unsuccessful
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
                onClick={() => { setImportStatus(null); importInputRef.current?.click(); }}
                disabled={importing || saving}
                className={`w-full ${panelBtnPrimary} bg-blue-700 hover:bg-blue-600 text-white disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed`}
              >
                <Upload size={14} />
                Import Single JSON
              </button>
              <ImportFolderButton
                label="Import Folder"
                icon={FolderOpen}
                disabled={saving}
                busyRef={importBusyRef}
                onImportingChange={setImporting}
                className={`w-full ${panelBtnPrimary} bg-blue-700 hover:bg-blue-600 text-white disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed`}
                unsupportedMessage="Import Folder requires Chrome or Edge. Your browser does not support folder selection."
                onBeforeImport={() => {
                  setImportStatus(null);
                  return true;
                }}
                onBusy={() => setImportStatus({ ok: null, text: 'Import already in progress.' })}
                onCancel={() => setImportStatus({ ok: null, text: 'Import cancelled.' })}
                onError={(text) => setImportStatus({ ok: false, text })}
                onFolderSelected={handleImportTrajFolder}
              />
              {importStatus && (
                <p className={`text-sm ${importStatus.ok === true ? 'text-green-400' : importStatus.ok === false ? 'text-red-400' : 'text-gray-400'}`}>
                  {importStatus.text}
                </p>
              )}
              <button
                type="button"
                onClick={handleDownload}
                disabled={totalTrajectoryCount === 0 || saving}
                className={`w-full ${panelBtnPrimary} ${
                  totalTrajectoryCount === 0 || saving
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-green-700 hover:bg-green-600 text-white'
                }`}
              >
                <Download size={14} />
                Download All Trajectories
              </button>
              <button
                type="button"
                onClick={handleSaveAllClick}
                disabled={totalTrajectoryCount === 0 || importing || saving}
                className={`w-full ${panelBtnPrimary} ${
                  totalTrajectoryCount === 0 || importing || saving
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-700 hover:bg-blue-600 text-white'
                }`}
              >
                <Save size={14} />
                {saving ? 'Saving…' : 'Save All Trajectories'}
              </button>
            </div>
          </div>
      </div>
    </aside>
  );
}
