import { useRef, useState, useEffect } from 'react';
import { Eye, EyeOff, Crosshair, Target, Zap, X } from 'lucide-react';
import { SimulationParams, TrajectoryPoint, Meterstick } from '../types';
import { fitTrajectoryAsync } from '../simulation';

interface Props {
  params: SimulationParams;
  hasExitPos: boolean;
  showSimulation: boolean;
  trajectory: TrajectoryPoint[];
  meterstick: Meterstick;
  onChange: (p: SimulationParams) => void;
  onToggleShow: () => void;
  pickingExitPos: boolean;
  onStartPickExitPos: () => void;
  width: number;
}

interface SliderRowProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function IntInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);

  function commit(str: string) {
    const n = parseInt(str.replace(/[^0-9\-]/g, ''), 10);
    const result = isNaN(n) ? value : n;
    setRaw(String(result));
    onChange(result);
  }

  return (
    <div className="flex-1">
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { setFocused(false); commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full text-xs bg-gray-800 border border-gray-600 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}

function SliderRow({ label, unit, value, min, max, step, onChange }: SliderRowProps) {
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-gray-300 flex-shrink-0">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => { setFocused(false); commit(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-20 text-xs text-right bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-white focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-500 w-8">{unit}</span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 accent-blue-500 cursor-pointer"
      />
    </div>
  );
}

export default function SimulationControls({
  params,
  hasExitPos,
  showSimulation,
  trajectory,
  meterstick,
  onChange,
  onToggleShow,
  pickingExitPos,
  onStartPickExitPos,
  width,
}: Props) {
  const [fitStatus, setFitStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle');
  const [fitRmse, setFitRmse] = useState<number | null>(null);
  const [fitProgress, setFitProgress] = useState(0);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  function set(key: keyof SimulationParams, val: number) {
    onChange({ ...params, [key]: val });
  }

  const canFit = trajectory.length >= 3 && hasExitPos && meterstick.length > 0;

  async function handleFit() {
    if (!canFit) return;
    const signal = { cancelled: false };
    cancelRef.current = signal;
    setFitStatus('running');
    setFitProgress(0);
    setFitRmse(null);

    const result = await fitTrajectoryAsync(
      trajectory,
      params.exitX,
      params.exitY,
      meterstick.length,
      (p) => setFitProgress(p),
      signal
    );

    if (signal.cancelled) return;

    if (!result) {
      setFitStatus('fail');
      return;
    }
    onChange({
      ...params,
      exitVelocity: result.exitVelocity,
      exitAngle: result.exitAngle,
      dragCoefficient: result.dragCoefficient,
      magnusGain: result.magnusGain,
    });
    setFitRmse(result.rmse);
    setFitProgress(1);
    setFitStatus('ok');
  }

  function handleCancel() {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    setFitStatus('idle');
    setFitProgress(0);
  }

  return (
    <aside className="flex flex-col bg-gray-900 border-l border-gray-700 p-4 space-y-5 overflow-y-auto h-full" style={{ width }}>
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
          Simulation
        </h2>

        <button
          onClick={onToggleShow}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors mb-5 ${
            showSimulation
              ? 'bg-green-600 hover:bg-green-500 text-white'
              : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
          }`}
        >
          {showSimulation ? <Eye size={15} /> : <EyeOff size={15} />}
          {showSimulation ? 'Hide Simulation' : 'Show Simulation'}
        </button>

        <div className="space-y-5">
          <SliderRow
            label="Exit Velocity"
            unit="m/s"
            value={params.exitVelocity}
            min={0}
            max={30}
            step={0.1}
            onChange={(v) => set('exitVelocity', v)}
          />
          <SliderRow
            label="Exit Angle"
            unit="deg"
            value={params.exitAngle}
            min={-90}
            max={90}
            step={0.5}
            onChange={(v) => set('exitAngle', v)}
          />
          <SliderRow
            label="Drag Coefficient"
            unit="b"
            value={params.dragCoefficient}
            min={0}
            max={1}
            step={0.001}
            onChange={(v) => set('dragCoefficient', v)}
          />
          <SliderRow
            label="Magnus Coefficient"
            unit="k"
            value={params.magnusGain}
            min={0}
            max={2}
            step={0.001}
            onChange={(v) => set('magnusGain', v)}
          />
        </div>

        {/* Fit button */}
        <div className="mt-5 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={handleFit}
              disabled={!canFit || fitStatus === 'running'}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                canFit && fitStatus !== 'running'
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Zap size={15} className={fitStatus === 'running' ? 'animate-pulse' : ''} />
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

          {fitStatus === 'running' && (
            <div className="space-y-1">
              <div className="relative h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all duration-100"
                  style={{ width: `${Math.round(fitProgress * 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 text-center tabular-nums">
                {Math.round(fitProgress * 100)}% complete
              </p>
            </div>
          )}

          {fitStatus !== 'running' && !canFit && (
            <p className="text-xs text-gray-600 text-center leading-snug">
              {trajectory.length < 3
                ? `Need ${3 - trajectory.length} more plotted point${3 - trajectory.length === 1 ? '' : 's'}`
                : 'Set a launch point first'}
            </p>
          )}
          {fitStatus === 'ok' && fitRmse !== null && (
            <p className="text-xs text-green-400 text-center">
              Fit complete · RMSE {(fitRmse * 100).toFixed(1)} cm
            </p>
          )}
          {fitStatus === 'fail' && (
            <p className="text-xs text-red-400 text-center">
              Could not fit — check launch point and scale
            </p>
          )}
        </div>
      </div>

      {/* Exit position */}
      <div className="pt-4 border-t border-gray-700 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Launch Point
          </h3>
          <Target
            size={15}
            className={hasExitPos ? 'text-green-400' : 'text-gray-600'}
          />
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Click "Pick on Video" then click the frame where the ball exits the robot.
        </p>
        <button
          onClick={onStartPickExitPos}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
            pickingExitPos
              ? 'bg-green-600 text-white hover:bg-green-500'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
          }`}
        >
          <Crosshair size={13} />
          {pickingExitPos ? 'Click on Video...' : 'Pick on Video'}
        </button>
        <div className="flex gap-2">
          <IntInput label="X (px)" value={Math.round(params.exitX)} onChange={(n) => set('exitX', n)} />
          <IntInput label="Y (px)" value={Math.round(params.exitY)} onChange={(n) => set('exitY', n)} />
        </div>
      </div>

      {/* Physics info */}
      <div className="pt-4 border-t border-gray-700 space-y-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Physics</h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          g = 9.81 m/s²<br />
          F<sub>drag</sub> = b · v²<br />
          dt = 5 ms timestep
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Drag the yellow meterstick on the video to calibrate the 1-meter scale.
        </p>
      </div>
    </aside>
  );
}
