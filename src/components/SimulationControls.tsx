import { useRef, useState, useEffect } from 'react';
import { Eye, EyeOff, Zap, X } from 'lucide-react';
import { SimulationParams, TrajectoryPoint, Meterstick } from '../types';
import { fitDragMagnusAsync } from '../simulation';
import {
  panelAside, panelContent, panelSectionTitle, panelLabelInline, panelBody, panelHint,
  panelInputNumeric, panelBtnPrimary,
} from './panelStyles';

interface Props {
  params: SimulationParams;
  showSimulation: boolean;
  trajectory: TrajectoryPoint[];
  meterstick: Meterstick;
  framerate: number;
  onChange: (p: SimulationParams) => void;
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
  onChange: (v: number) => void;
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
        <label className={panelLabelInline}>{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            value={raw}
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
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 accent-blue-500 cursor-pointer"
      />
    </div>
  );
}

export default function SimulationControls({
  params,
  showSimulation,
  trajectory,
  meterstick,
  framerate,
  onChange,
  onToggleShow,
  width,
}: Props) {
  const [fitStatus, setFitStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle');
  const [fitRmse, setFitRmse] = useState<number | null>(null);
  const [fitProgress, setFitProgress] = useState(0);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  function setParam(key: keyof SimulationParams, val: number) {
    onChange({ ...params, [key]: val });
  }

  const canFit =
    trajectory.length >= 3 &&
    meterstick.length > 0 &&
    framerate > 0 &&
    params.exitVelocity > 0;

  async function handleFit() {
    if (!canFit) return;
    const signal = { cancelled: false };
    cancelRef.current = signal;
    setFitStatus('running');
    setFitProgress(0);
    setFitRmse(null);

    const result = await fitDragMagnusAsync(
      trajectory,
      meterstick.length,
      framerate,
      params.exitVelocity,
      params.exitAngle,
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

        <div className="space-y-5">
          <SliderRow
            label="Exit Velocity"
            unit="m/s"
            value={params.exitVelocity}
            min={0}
            max={30}
            step={0.1}
            onChange={(v) => setParam('exitVelocity', v)}
          />
          <SliderRow
            label="Exit Angle"
            unit="deg"
            value={params.exitAngle}
            min={-90}
            max={90}
            step={0.5}
            onChange={(v) => setParam('exitAngle', v)}
          />
          <SliderRow
            label="Drag Coefficient"
            unit="b"
            value={params.dragCoefficient}
            min={0}
            max={1}
            step={0.001}
            onChange={(v) => setParam('dragCoefficient', v)}
          />
          <SliderRow
            label="Magnus Coefficient"
            unit="k"
            value={params.magnusGain}
            min={0}
            max={2}
            step={0.001}
            onChange={(v) => setParam('magnusGain', v)}
          />
        </div>

        <div className="mt-5 space-y-2">
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

          {fitStatus === 'running' && (
            <div className="space-y-1">
              <div className="relative h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all duration-100"
                  style={{ width: `${Math.round(fitProgress * 100)}%` }}
                />
              </div>
              <p className={`${panelHint} text-center tabular-nums`}>
                {Math.round(fitProgress * 100)}% complete
              </p>
            </div>
          )}

          {fitStatus !== 'running' && !canFit && (
            <p className={`${panelHint} text-center`}>
              {trajectory.length < 3
                ? `Need ${3 - trajectory.length} more plotted point${3 - trajectory.length === 1 ? '' : 's'}`
                : meterstick.length <= 0
                ? 'Calibrate the meterstick scale first'
                : framerate <= 0
                ? 'Set a valid framerate first'
                : 'Set the exit velocity (m/s) first'}
            </p>
          )}
          {fitStatus === 'ok' && fitRmse !== null && (
            <p className="text-sm text-green-400 text-center">
              Fit complete · RMSE {(fitRmse * 100).toFixed(1)} cm
            </p>
          )}
          {fitStatus === 'fail' && (
            <p className="text-sm text-red-400 text-center">
              Could not fit — check scale and velocity
            </p>
          )}
        </div>
      </div>

      <div className="pt-4 border-t border-gray-700 space-y-2">
        <h3 className={panelSectionTitle}>Physics</h3>
        <p className={panelBody}>
          g = 9.81 m/s²<br />
          F<sub>drag</sub> = b · v²<br />
          dt = 5 ms timestep
        </p>
        <p className={panelBody}>
          Launch point is the first plotted point. Drag the yellow meterstick on the video to calibrate the 1-meter scale.
        </p>
      </div>
      </div>
    </aside>
  );
}
