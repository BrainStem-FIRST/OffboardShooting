import { useRef, useState, useEffect, useMemo } from 'react';
import { Eye, EyeOff, Zap, X } from 'lucide-react';
import { LaunchParams, TrajectoryPoint, Meterstick } from '../types';
import { fitDragMagnusAsync, GRAVITY_MS2, SIM_DT, DEFAULT_FIT_GRID_CONFIG, DEFAULT_FIT_TARGET_PARAMS, FitProgress, FitRankEntry, FitTargetParams, computeFitTotalEvals, computeTrajectoryFitCost } from '../simulation';
import { countPlottedPoints } from '../utils/trajectorySegments';
import {
  panelAside, panelContent, panelSectionTitle, panelSubsectionTitle, panelLabelInline, panelBody, panelHint,
  panelInputNumeric, panelBtnPrimary,
} from './panelStyles';

interface TrajectoryFitEntry {
  id: string;
  videoId: string;
  points: TrajectoryPoint[];
  launchParams: LaunchParams;
  pixelsPerMeter: number;
  framerate: number;
}

interface Props {
  launchParams: LaunchParams;
  activeTrajectoryId: string | null;
  activeTrajectoryName: string | null;
  showSimulation: boolean;
  trajectory: TrajectoryPoint[];
  allTrajectories: TrajectoryFitEntry[];
  allVideosTrajectories: TrajectoryFitEntry[];
  meterstick: Meterstick;
  framerate: number;
  onLaunchParamsChange: (p: LaunchParams) => void;
  onLaunchParamsChangeForTrajectory: (trajectoryId: string, p: LaunchParams) => void;
  onLaunchParamsChangeForVideo: (videoId: string, trajectoryId: string, p: LaunchParams) => void;
  onToggleShow: () => void;
  width: number;
}


interface SliderRowProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}

function SliderRow({ label, unit, value, min, max, step, disabled, onChange }: SliderRowProps) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);

  function commit(str: string) {
    const stripped = str.replace(/[^0-9.\-]/g, '');
    let n = parseFloat(stripped);
    if (isNaN(n)) n = min;
    n = Math.max(min, Math.min(max, n));
    setRaw(String(n));
    onChange(n);
  }

  return (
    <div className={`space-y-1.5 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <label className={panelLabelInline}>{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            value={raw}
            disabled={disabled}
            onChange={(e) => setRaw(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => { setFocused(false); commit(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className={panelInputNumeric}
          />
          <span className={`${panelHint} w-8`}>{unit}</span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 accent-blue-500 cursor-pointer disabled:cursor-not-allowed"
      />
    </div>
  );
}

interface FitParamRowProps {
  label: string;
  checked: boolean;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onToggle: () => void;
  onRangeChange: (min: number, max: number) => void;
}

function FitParamRow({
  label, checked, min, max, step, disabled, onToggle, onRangeChange,
}: FitParamRowProps) {
  const [rawMin, setRawMin] = useState(String(min));
  const [rawMax, setRawMax] = useState(String(max));
  const [focusedMin, setFocusedMin] = useState(false);
  const [focusedMax, setFocusedMax] = useState(false);
  const inactive = !checked || disabled;

  useEffect(() => {
    if (!focusedMin) setRawMin(String(min));
  }, [min, focusedMin]);

  useEffect(() => {
    if (!focusedMax) setRawMax(String(max));
  }, [max, focusedMax]);

  function commitMin(str: string) {
    let n = parseFloat(str.replace(/[^0-9.\-]/g, ''));
    if (isNaN(n)) n = min;
    let lo = n;
    let hi = max;
    if (lo > hi) [lo, hi] = [hi, lo];
    setRawMin(String(lo));
    setRawMax(String(hi));
    onRangeChange(lo, hi);
  }

  function commitMax(str: string) {
    let n = parseFloat(str.replace(/[^0-9.\-]/g, ''));
    if (isNaN(n)) n = max;
    let lo = min;
    let hi = n;
    if (lo > hi) [lo, hi] = [hi, lo];
    setRawMin(String(lo));
    setRawMax(String(hi));
    onRangeChange(lo, hi);
  }

  return (
    <div className={`flex items-center gap-2 ${inactive ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="accent-blue-500 shrink-0"
      />
      <span className={`${panelHint} shrink-0 w-[4.5rem] text-gray-300`}>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={rawMin}
        step={step}
        disabled={inactive}
        onChange={(e) => setRawMin(e.target.value)}
        onFocus={() => setFocusedMin(true)}
        onBlur={(e) => { setFocusedMin(false); commitMin(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={`${panelInputNumeric} flex-1 min-w-0 disabled:cursor-not-allowed`}
      />
      <span className={`${panelHint} shrink-0`}>–</span>
      <input
        type="text"
        inputMode="decimal"
        value={rawMax}
        step={step}
        disabled={inactive}
        onChange={(e) => setRawMax(e.target.value)}
        onFocus={() => setFocusedMax(true)}
        onBlur={(e) => { setFocusedMax(false); commitMax(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={`${panelInputNumeric} flex-1 min-w-0 disabled:cursor-not-allowed`}
      />
    </div>
  );
}

interface FitParamRanges {
  velocityMin: number;
  velocityMax: number;
  angleMin: number;
  angleMax: number;
  dragMin: number;
  dragMax: number;
  magnusMin: number;
  magnusMax: number;
  magnusPowerMin: number;
  magnusPowerMax: number;
}

const DEFAULT_FIT_RANGES: FitParamRanges = {
  velocityMin: DEFAULT_FIT_GRID_CONFIG.velocityMin,
  velocityMax: DEFAULT_FIT_GRID_CONFIG.velocityMax,
  angleMin: DEFAULT_FIT_GRID_CONFIG.angleMin,
  angleMax: DEFAULT_FIT_GRID_CONFIG.angleMax,
  dragMin: DEFAULT_FIT_GRID_CONFIG.dragMin,
  dragMax: DEFAULT_FIT_GRID_CONFIG.dragMax,
  magnusMin: DEFAULT_FIT_GRID_CONFIG.magnusMin,
  magnusMax: DEFAULT_FIT_GRID_CONFIG.magnusMax,
  magnusPowerMin: DEFAULT_FIT_GRID_CONFIG.magnusPowerMin,
  magnusPowerMax: DEFAULT_FIT_GRID_CONFIG.magnusPowerMax,
};

export default function SimulationControls({
  launchParams,
  activeTrajectoryId,
  activeTrajectoryName,
  showSimulation,
  trajectory,
  allTrajectories,
  allVideosTrajectories,
  meterstick,
  framerate,
  onLaunchParamsChange,
  onLaunchParamsChangeForTrajectory,
  onLaunchParamsChangeForVideo,
  onToggleShow,
  width,
}: Props) {
  const [fitStatus, setFitStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle');
  const [topFits, setTopFits] = useState<FitRankEntry[]>([]);
  const [fitProgress, setFitProgress] = useState(0);
  const [fitProgressDetail, setFitProgressDetail] = useState<FitProgress | null>(null);
  const [fitNumSplits, setFitNumSplits] = useState(DEFAULT_FIT_GRID_CONFIG.numSplits);
  const [fitNumRecursions, setFitNumRecursions] = useState(DEFAULT_FIT_GRID_CONFIG.numRecursions);
  const [fitTargets, setFitTargets] = useState<FitTargetParams>({ ...DEFAULT_FIT_TARGET_PARAMS });
  const [fitRanges, setFitRanges] = useState<FitParamRanges>({ ...DEFAULT_FIT_RANGES });
  const [fitWholeVideo, setFitWholeVideo] = useState(false);
  const [fitAllVideos, setFitAllVideos] = useState(false);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const fittableTrajectories = allTrajectories.filter(
    (t) => countPlottedPoints(t.points) >= 3 && t.pixelsPerMeter > 0 && t.framerate > 0
  );
  const fittableAllVideosTrajectories = allVideosTrajectories.filter(
    (t) => countPlottedPoints(t.points) >= 3 && t.pixelsPerMeter > 0 && t.framerate > 0
  );
  const fitDimensions = (
    (fitTargets.fitExitVelocity ? 1 : 0) +
    (fitTargets.fitExitAngle ? 1 : 0) +
    (fitTargets.fitDrag ? 1 : 0) +
    (fitTargets.fitMagnus ? 1 : 0) +
    (fitTargets.fitMagnusPower ? 1 : 0)
  );
  const fitTrajectoryCount = fitAllVideos
    ? fittableAllVideosTrajectories.length
    : fitWholeVideo
      ? fittableTrajectories.length
      : 1;
  const fitTotalEvals = computeFitTotalEvals(
    fitNumSplits,
    fitNumRecursions,
    fitTargets,
    fitTrajectoryCount
  );
  const videosAvailable = allVideosTrajectories.length > 0;

  const trajectoryCosts = useMemo(() => {
    if (meterstick.length <= 0 || framerate <= 0) {
      return { visible: null as number | null, average: null as number | null };
    }

    const visible =
      countPlottedPoints(trajectory) >= 3 && launchParams.exitVelocity > 0
        ? computeTrajectoryFitCost(
            trajectory,
            launchParams,
            meterstick.length,
            framerate
          )?.meanDistance ?? null
        : null;

    const perTraj = fittableTrajectories
      .map((entry) => {
        const params = entry.id === activeTrajectoryId ? launchParams : entry.launchParams;
        if (params.exitVelocity <= 0) return null;
        return computeTrajectoryFitCost(
          entry.points,
          params,
          meterstick.length,
          framerate
        )?.meanDistance ?? null;
      })
      .filter((c): c is number => c !== null && Number.isFinite(c));

    const average =
      perTraj.length > 0 ? perTraj.reduce((sum, c) => sum + c, 0) / perTraj.length : null;

    return { visible, average };
  }, [
    trajectory,
    launchParams,
    activeTrajectoryId,
    fittableTrajectories,
    meterstick.length,
    framerate,
  ]);

  function formatMeanError(meters: number | null): string {
    if (meters === null || !Number.isFinite(meters)) return '—';
    return `${(meters * 100).toFixed(1)} cm`;
  }

  function setFitRange(partial: Partial<FitParamRanges>) {
    setFitRanges((prev) => ({ ...prev, ...partial }));
  }

  function toggleFitTarget(key: keyof FitTargetParams) {
    setFitTargets((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function setLaunch(key: keyof LaunchParams, val: number) {
    onLaunchParamsChange({ ...launchParams, [key]: val });
  }

  const hasTrajectory = activeTrajectoryId !== null;
  const plottedCount = countPlottedPoints(trajectory);
  const fitTargetEntries = fitAllVideos
    ? fittableAllVideosTrajectories
    : fitWholeVideo
      ? fittableTrajectories
      : [];
  const hasFitTarget = fitAllVideos
    ? fittableAllVideosTrajectories.length > 0
    : fitWholeVideo
      ? fittableTrajectories.length > 0
      : hasTrajectory && plottedCount >= 3;
  const canFit =
    hasFitTarget &&
    fitDimensions > 0 &&
    (fitAllVideos
      ? fittableAllVideosTrajectories.length > 0
      : meterstick.length > 0 && framerate > 0) &&
    (fitTargets.fitExitVelocity ||
      (fitAllVideos || fitWholeVideo
        ? fitTargetEntries.every((t) => t.launchParams.exitVelocity > 0)
        : launchParams.exitVelocity > 0));

  async function handleFit() {
    if (!canFit) return;
    const signal = { cancelled: false };
    cancelRef.current = signal;
    setFitStatus('running');
    setFitProgress(0);
    setFitProgressDetail(null);
    setTopFits([]);

    const activeEntry = allTrajectories.find((t) => t.id === activeTrajectoryId);

    let orderedEntries: TrajectoryFitEntry[];
    if (fitAllVideos) {
      orderedEntries = fittableAllVideosTrajectories;
      if (
        activeEntry &&
        countPlottedPoints(activeEntry.points) >= 3 &&
        activeEntry.pixelsPerMeter > 0 &&
        activeEntry.framerate > 0
      ) {
        orderedEntries = [
          activeEntry,
          ...fittableAllVideosTrajectories.filter(
            (t) => !(t.id === activeEntry.id && t.videoId === activeEntry.videoId)
          ),
        ];
      }
    } else if (fitWholeVideo) {
      orderedEntries = [
        ...(activeEntry && countPlottedPoints(activeEntry.points) >= 3 ? [activeEntry] : []),
        ...fittableTrajectories.filter((t) => t.id !== activeTrajectoryId),
      ];
    } else {
      orderedEntries =
        activeEntry && countPlottedPoints(activeEntry.points) >= 3 ? [activeEntry] : [];
    }

    const fitInputs = orderedEntries.map((t) => ({
      points: t.points,
      exitVelocity: t.launchParams.exitVelocity,
      exitAngle: t.launchParams.exitAngle,
      dragCoefficient: t.launchParams.dragCoefficient,
      magnusGain: t.launchParams.magnusGain,
      magnusPower: t.launchParams.magnusPower ?? 2,
      pixelsPerMeter: t.pixelsPerMeter,
      framerate: t.framerate,
    }));

    const result = await fitDragMagnusAsync(
      fitInputs,
      (p) => {
        setFitProgress(p.progress);
        setFitProgressDetail(p);
      },
      signal,
      {
        ...DEFAULT_FIT_GRID_CONFIG,
        ...fitRanges,
        numSplits: fitNumSplits,
        numRecursions: fitNumRecursions,
        fitTargets,
        fitWholeVideo: fitAllVideos || fitWholeVideo,
        fitAllVideos,
      }
    );

    if (signal.cancelled) return;

    if (!result) {
      setTopFits([]);
      setFitStatus('fail');
      return;
    }
    const updates: Partial<LaunchParams> = {};
    if (fitTargets.fitExitVelocity) updates.exitVelocity = result.exitVelocity;
    if (fitTargets.fitExitAngle) updates.exitAngle = result.exitAngle;
    if (fitTargets.fitDrag) updates.dragCoefficient = result.dragCoefficient;
    if (fitTargets.fitMagnus) updates.magnusGain = result.magnusGain;
    if (fitTargets.fitMagnusPower) updates.magnusPower = result.magnusPower;

    if (fitAllVideos) {
      for (const entry of orderedEntries) {
        onLaunchParamsChangeForVideo(entry.videoId, entry.id, {
          ...entry.launchParams,
          ...updates,
        });
      }
    } else if (fitWholeVideo) {
      for (const entry of orderedEntries) {
        onLaunchParamsChangeForTrajectory(entry.id, { ...entry.launchParams, ...updates });
      }
    } else if (activeEntry) {
      onLaunchParamsChange({ ...launchParams, ...updates });
    }
    setTopFits(result.topFits);
    setFitProgress(1);
    setFitProgressDetail(null);
    setFitStatus('ok');
  }

  function handleCancel() {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    setFitStatus('idle');
    setFitProgress(0);
    setFitProgressDetail(null);
    setTopFits([]);
  }

  return (
    <aside className={`${panelAside} border-l border-gray-700`} style={{ width }}>
      <div className={panelContent}>
      <div>
        <h2 className={`${panelSectionTitle} mb-4`}>
          Simulation
        </h2>

        <button
          onClick={onToggleShow}
          className={`w-full ${panelBtnPrimary} mb-5 ${
            showSimulation
              ? 'bg-green-600 hover:bg-green-500 text-white'
              : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
          }`}
        >
          {showSimulation ? <Eye size={16} /> : <EyeOff size={16} />}
          {showSimulation ? 'Hide Simulation' : 'Show Simulation'}
        </button>

        <div className="mb-5 space-y-4">
          {activeTrajectoryName && (
            <p className={panelHint}>
              Saved per trajectory · editing{' '}
              <span className="text-gray-300">{activeTrajectoryName}</span>
            </p>
          )}
          <div>
            <h3 className={`${panelSubsectionTitle} mb-3`}>Launch conditions</h3>
            <div className="space-y-5">
              <SliderRow
                label="Exit Velocity"
                unit="m/s"
                value={launchParams.exitVelocity}
                min={0}
                max={30}
                step={0.1}
                disabled={!hasTrajectory}
                onChange={(v) => setLaunch('exitVelocity', v)}
              />
              <SliderRow
                label="Exit Angle"
                unit="deg"
                value={launchParams.exitAngle}
                min={-90}
                max={90}
                step={0.5}
                disabled={!hasTrajectory}
                onChange={(v) => setLaunch('exitAngle', v)}
              />
            </div>
            {!hasTrajectory && (
              <p className={`${panelHint} mt-3 text-center`}>
                Select or plot a trajectory to set launch conditions
              </p>
            )}
          </div>

          <div className="pt-4 border-t border-gray-700 space-y-5">
            <h3 className={panelSubsectionTitle}>Physics model</h3>

            <SliderRow
              label="Drag Coefficient"
              unit="b"
              value={launchParams.dragCoefficient}
              min={0}
              max={0.2}
              step={0.01}
              disabled={!hasTrajectory}
              onChange={(v) => setLaunch('dragCoefficient', v)}
            />
            <SliderRow
              label="Magnus Coefficient"
              unit="k"
              value={launchParams.magnusGain}
              min={-0.5}
              max={0.5}
              step={0.01}
              disabled={!hasTrajectory}
              onChange={(v) => setLaunch('magnusGain', v)}
            />
            <SliderRow
              label="Magnus Power"
              unit="x"
              value={launchParams.magnusPower ?? 2}
              min={1}
              max={3}
              step={0.1}
              disabled={!hasTrajectory}
              onChange={(v) => setLaunch('magnusPower', v)}
            />

            <div className="space-y-2">
              <div className="space-y-2">
                <label className={`${panelHint} block`}>Fit parameters</label>
                <FitParamRow
                  label="Exit vel"
                  checked={fitTargets.fitExitVelocity}
                  min={fitRanges.velocityMin}
                  max={fitRanges.velocityMax}
                  step={0.1}
                  disabled={!hasTrajectory || fitStatus === 'running'}
                  onToggle={() => toggleFitTarget('fitExitVelocity')}
                  onRangeChange={(lo, hi) => setFitRange({ velocityMin: lo, velocityMax: hi })}
                />
                <FitParamRow
                  label="Exit ang"
                  checked={fitTargets.fitExitAngle}
                  min={fitRanges.angleMin}
                  max={fitRanges.angleMax}
                  step={0.5}
                  disabled={!hasTrajectory || fitStatus === 'running'}
                  onToggle={() => toggleFitTarget('fitExitAngle')}
                  onRangeChange={(lo, hi) => setFitRange({ angleMin: lo, angleMax: hi })}
                />
                <FitParamRow
                  label="Drag"
                  checked={fitTargets.fitDrag}
                  min={fitRanges.dragMin}
                  max={fitRanges.dragMax}
                  step={0.01}
                  disabled={!hasTrajectory || fitStatus === 'running'}
                  onToggle={() => toggleFitTarget('fitDrag')}
                  onRangeChange={(lo, hi) => setFitRange({ dragMin: lo, dragMax: hi })}
                />
                <FitParamRow
                  label="Magnus"
                  checked={fitTargets.fitMagnus}
                  min={fitRanges.magnusMin}
                  max={fitRanges.magnusMax}
                  step={0.01}
                  disabled={!hasTrajectory || fitStatus === 'running'}
                  onToggle={() => toggleFitTarget('fitMagnus')}
                  onRangeChange={(lo, hi) => setFitRange({ magnusMin: lo, magnusMax: hi })}
                />
                <FitParamRow
                  label="Mag power"
                  checked={fitTargets.fitMagnusPower}
                  min={fitRanges.magnusPowerMin}
                  max={fitRanges.magnusPowerMax}
                  step={0.1}
                  disabled={!hasTrajectory || fitStatus === 'running'}
                  onToggle={() => toggleFitTarget('fitMagnusPower')}
                  onRangeChange={(lo, hi) => setFitRange({ magnusPowerMin: lo, magnusPowerMax: hi })}
                />
              </div>

              <label className={`flex items-center gap-2 cursor-pointer ${!hasTrajectory ? 'opacity-50' : ''}`}>
                <input
                  type="checkbox"
                  checked={fitWholeVideo}
                  disabled={!hasTrajectory || fitStatus === 'running' || fitAllVideos}
                  onChange={() => setFitWholeVideo((v) => !v)}
                  className="accent-blue-500"
                />
                <span className={`${panelHint} text-gray-300`}>
                  Fit whole video{fittableTrajectories.length > 0 ? ` (${fittableTrajectories.length})` : ''}
                </span>
              </label>

              <label className={`flex items-center gap-2 cursor-pointer ${videosAvailable ? '' : 'opacity-50'}`}>
                <input
                  type="checkbox"
                  checked={fitAllVideos}
                  disabled={fitStatus === 'running' || !videosAvailable}
                  onChange={() => setFitAllVideos((v) => !v)}
                  className="accent-blue-500"
                />
                <span className={`${panelHint} text-gray-300`}>
                  Fit all videos{fittableAllVideosTrajectories.length > 0 ? ` (${fittableAllVideosTrajectories.length})` : ''}
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className={panelHint}>Grid splits</label>
                  <input
                    type="number"
                    min={2}
                    max={100}
                    step={1}
                    value={fitNumSplits}
                    disabled={!hasTrajectory || fitStatus === 'running'}
                    onChange={(e) => setFitNumSplits(Math.max(2, Math.min(100, parseInt(e.target.value, 10) || 2)))}
                    className={panelInputNumeric}
                  />
                </div>
                <div className="space-y-1">
                  <label className={panelHint}>Recursions</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={fitNumRecursions}
                    disabled={!hasTrajectory || fitStatus === 'running'}
                    onChange={(e) => setFitNumRecursions(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
                    className={panelInputNumeric}
                  />
                </div>
              </div>

              <p className={`${panelHint} text-center tabular-nums`}>
                {fitDimensions === 0
                  ? 'Select at least one parameter to fit'
                  : `${fitTotalEvals.toLocaleString()} simulation${fitTotalEvals === 1 ? '' : 's'} required`}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={handleFit}
                  disabled={!canFit || fitStatus === 'running'}
                  className={`flex-1 ${panelBtnPrimary} ${
                    canFit && fitStatus !== 'running'
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <Zap size={16} className={fitStatus === 'running' ? 'animate-pulse' : ''} />
                  {fitStatus === 'running' ? 'Fitting...' : 'Fit to Trajectory'}
                </button>
                {fitStatus === 'running' && (
                  <button
                    onClick={handleCancel}
                    className="flex items-center justify-center px-3 py-2.5 rounded-lg bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white transition-colors"
                    title="Cancel fitting"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              <div className="space-y-0.5 tabular-nums">
                <p className={`${panelHint} flex justify-between gap-2`}>
                  <span>Visible avg error</span>
                  <span className="text-gray-300">{formatMeanError(trajectoryCosts.visible)}</span>
                </p>
                <p className={`${panelHint} flex justify-between gap-2`}>
                  <span>Avg error (all)</span>
                  <span className="text-gray-300">{formatMeanError(trajectoryCosts.average)}</span>
                </p>
              </div>

              {topFits.length > 0 && (
                <div className="space-y-1">
                  <p className={panelHint}>Top {topFits.length} fits</p>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-700">
                    <table className="w-full text-[11px] tabular-nums">
                      <thead className="sticky top-0 bg-gray-900 text-gray-400">
                        <tr>
                          <th className="px-1.5 py-1 text-left font-normal">#</th>
                          <th className="px-1.5 py-1 text-right font-normal">Vis err</th>
                          <th className="px-1.5 py-1 text-right font-normal">Vel</th>
                          <th className="px-1.5 py-1 text-right font-normal">Ang</th>
                          <th className="px-1.5 py-1 text-right font-normal">Drag</th>
                          <th className="px-1.5 py-1 text-right font-normal">Magn</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-300">
                        {topFits.map((fit) => (
                          <tr key={fit.rank} className="border-t border-gray-800">
                            <td className="px-1.5 py-1 text-left text-gray-400">{fit.rank}</td>
                            <td className="px-1.5 py-1 text-right">{formatMeanError(fit.visibleMeanDistance)}</td>
                            <td className="px-1.5 py-1 text-right">{fit.exitVelocity}</td>
                            <td className="px-1.5 py-1 text-right">{fit.exitAngle}</td>
                            <td className="px-1.5 py-1 text-right">{fit.dragCoefficient}</td>
                            <td className="px-1.5 py-1 text-right">{fit.magnusGain}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {fitStatus === 'running' && (
                <div className="space-y-1">
                  <div className="relative h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all duration-100"
                      style={{ width: `${Math.round(fitProgress * 100)}%` }}
                    />
                  </div>
                  <p className={`${panelHint} text-center tabular-nums`}>
                    {fitProgressDetail
                      ? `Recursion ${fitProgressDetail.recursion}/${fitProgressDetail.numRecursions} · Grid ${fitProgressDetail.iteration}/${fitProgressDetail.gridSize} · ${fitProgressDetail.totalEvals.toLocaleString()} total`
                      : 'Starting…'}
                  </p>
                  <p className={`${panelHint} text-center tabular-nums`}>
                    {Math.round(fitProgress * 100)}% complete
                  </p>
                </div>
              )}

              {fitStatus !== 'running' && !canFit && (
                <p className={`${panelHint} text-center`}>
                  {!hasTrajectory
                    ? 'Select a trajectory first'
                    : fitAllVideos && fittableAllVideosTrajectories.length === 0
                    ? 'Need at least one trajectory with 3+ points across all videos'
                    : fitWholeVideo && fittableTrajectories.length === 0
                    ? 'Need at least one trajectory with 3+ points in this video'
                    : !fitWholeVideo && !fitAllVideos && plottedCount < 3
                    ? `Need ${3 - plottedCount} more plotted point${3 - plottedCount === 1 ? '' : 's'}`
                    : meterstick.length <= 0
                    ? 'Calibrate the meterstick scale first'
                    : framerate <= 0
                    ? 'Set a valid framerate first'
                    : fitDimensions === 0
                    ? 'Select at least one parameter to fit'
                    : 'Set the exit velocity (m/s) first'}
                </p>
              )}
              {fitStatus === 'fail' && (
                <p className="text-sm text-red-400 text-center">
                  Could not fit — check scale and velocity
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-gray-700 space-y-2">
        <h3 className={panelSectionTitle}>Physics</h3>
        <p className={panelBody}>
          g = {GRAVITY_MS2} m/s²<br />
          F<sub>drag</sub> = b · v²<br />
          F<sub>magnus</sub> = k · v<sup>x</sup><br />
          dt = {SIM_DT * 1000} ms timestep
        </p>
        <p className={panelBody}>
          Launch point is the first plotted point. Drag the yellow meterstick on the video to calibrate the 1-meter scale.
        </p>
      </div>
      </div>
    </aside>
  );
}
