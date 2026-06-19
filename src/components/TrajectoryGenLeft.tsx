import { useState, useEffect, useRef, useCallback } from 'react';
import { TrajGenParams } from '../types';
import { Play, Loader } from 'lucide-react';

interface Props {
  params: TrajGenParams;
  onChange: (p: TrajGenParams) => void;
  onGenerate: () => void;
  generating: boolean;
  width: number;
}

interface RangeRowProps {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  valMin: number;
  valMax: number;
  onChangeMin: (v: number) => void;
  onChangeMax: (v: number) => void;
}

function RangeInput({ label, value, step, min, max, onCommit }: {
  label: string; value: number; step: number; min: number; max: number;
  onCommit: (v: number) => void;
}) {
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
    onCommit(n);
  }

  return (
    <div className="flex-1">
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { setFocused(false); commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}

function snap(v: number, min: number, step: number) {
  return Math.round((v - min) / step) * step + min;
}

function RangeRow({ label, unit, min, max, step, valMin, valMax, onChangeMin, onChangeMax }: RangeRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'min' | 'max' | null>(null);

  const valueFromX = useCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return snap(min + ratio * (max - min), min, step);
  }, [min, max, step]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const v = valueFromX(e.clientX);
    const minPct = (valMin - min) / (max - min);
    const maxPct = (valMax - min) / (max - min);
    const pct = (v - min) / (max - min);

    let which: 'min' | 'max';
    if (pct <= minPct) {
      which = 'min';
    } else if (pct >= maxPct) {
      which = 'max';
    } else {
      which = Math.abs(pct - minPct) <= Math.abs(pct - maxPct) ? 'min' : 'max';
    }

    dragging.current = which;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (which === 'min') onChangeMin(Math.min(v, valMax - step));
    else onChangeMax(Math.max(v, valMin + step));
  }, [valueFromX, valMin, valMax, min, max, step, onChangeMin, onChangeMax]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const v = valueFromX(e.clientX);
    if (dragging.current === 'min') onChangeMin(Math.min(v, valMax - step));
    else onChangeMax(Math.max(v, valMin + step));
  }, [valueFromX, valMin, valMax, step, onChangeMin, onChangeMax]);

  const handlePointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  const clampPct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const minPct = clampPct(valMin);
  const maxPct = clampPct(valMax);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-300">{label}</label>
        <span className="text-xs text-gray-500">{unit}</span>
      </div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      <div
        ref={trackRef}
        className="relative h-6 flex items-center cursor-pointer select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Track background */}
        <div className="absolute w-full h-1.5 bg-gray-700 rounded-full" />
        {/* Active range */}
        <div
          className="absolute h-1.5 bg-blue-600 rounded-full"
          style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
        />
        {/* Min thumb */}
        <div
          className="absolute w-3.5 h-3.5 bg-blue-400 border-2 border-blue-300 rounded-full shadow"
          style={{ left: `${minPct}%`, transform: `translateX(-${minPct}%)` }}
        />
        {/* Max thumb */}
        <div
          className="absolute w-3.5 h-3.5 bg-blue-400 border-2 border-blue-300 rounded-full shadow"
          style={{ left: `${maxPct}%`, transform: `translateX(-${maxPct}%)` }}
        />
      </div>
      <div className="flex gap-2">
        <RangeInput label="Min" value={valMin} step={step} min={min} max={valMax - step}
          onCommit={(v) => onChangeMin(Math.min(v, valMax - step))} />
        <RangeInput label="Max" value={valMax} step={step} min={valMin + step} max={max}
          onCommit={(v) => onChangeMax(Math.max(v, valMin + step))} />
      </div>
    </div>
  );
}

function NumInput({ label, unit, value, step, min, max, onChange }: {
  label: string; unit?: string; value: number; step: number; min?: number; max?: number;
  onChange: (v: number) => void;
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
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-400">{label}</label>
        {unit && <span className="text-xs text-gray-600">{unit}</span>}
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={raw}
        step={step}
        onChange={(e) => setRaw(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { setFocused(false); commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full text-xs bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}

export default function TrajectoryGenLeft({ params, onChange, onGenerate, generating, width }: Props) {
  function set<K extends keyof TrajGenParams>(key: K, val: TrajGenParams[K]) {
    onChange({ ...params, [key]: val });
  }

  // Compute distance values that will be generated
  const dxValues: number[] = [];
  {
    let dx = params.dxMin;
    while (dx <= params.dxMax + 1e-9) {
      dxValues.push(Math.round(dx * 1e6) / 1e6);
      dx = Math.round((dx + params.dxStep) * 1e6) / 1e6;
    }
  }

  return (
    <aside className="flex flex-col bg-gray-900 border-r border-gray-700 h-full overflow-y-auto" style={{ width }}>
      <div className="p-4 space-y-5">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Scene Setup</h2>

        {/* Scene Setup */}
        <div className="space-y-3">
          {/* Distance to goal range slider */}
          <RangeRow
            label="Distance to Goal"
            unit="m"
            min={0} max={30} step={0.1}
            valMin={params.dxMin} valMax={params.dxMax}
            onChangeMin={(v) => onChange({ ...params, dxMin: v })}
            onChangeMax={(v) => onChange({ ...params, dxMax: v })}
          />
          <NumInput label="Distance Step" unit="m" value={params.dxStep} step={0.1} min={0.1}
            onChange={(v) => onChange({ ...params, dxStep: Math.max(0.1, v) })} />
          {dxValues.length > 0 && (
            <p className="text-xs text-gray-600">
              {dxValues.length === 1
                ? `1 distance: ${dxValues[0].toFixed(2)} m`
                : `${dxValues.length} distances: ${dxValues[0].toFixed(2)} → ${dxValues[dxValues.length - 1].toFixed(2)} m`}
            </p>
          )}
          <NumInput label="Height Offset (dy)" unit="m" value={params.dy} step={0.1}
            onChange={(v) => set('dy', v)} />
          <NumInput label="Goal Width" unit="m" value={params.goalWidth} step={0.05} min={0.05}
            onChange={(v) => set('goalWidth', Math.max(0.05, v))} />
          <NumInput label="Drag Coefficient" value={params.dragCoefficient} step={0.001} min={0}
            onChange={(v) => set('dragCoefficient', Math.max(0, v))} />
          <NumInput label="Magnus Coefficient" value={params.magnusGain} step={0.001}
            onChange={(v) => set('magnusGain', v)} />
        </div>

        <div className="border-t border-gray-700" />

        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Search Parameters</h2>

        {/* Exit Angle Range */}
        <RangeRow
          label="Exit Angle Range"
          unit="deg"
          min={0} max={90} step={0.5}
          valMin={params.exitAngleMin} valMax={params.exitAngleMax}
          onChangeMin={(v) => set('exitAngleMin', v)}
          onChangeMax={(v) => set('exitAngleMax', v)}
        />

        {/* Impact Angle Range */}
        <RangeRow
          label="Impact Angle Range"
          unit="deg"
          min={35} max={90} step={0.5}
          valMin={params.impactAngleMin} valMax={params.impactAngleMax}
          onChangeMin={(v) => set('impactAngleMin', v)}
          onChangeMax={(v) => set('impactAngleMax', v)}
        />

        {/* Velocity Range */}
        <RangeRow
          label="Exit Velocity Range"
          unit="m/s"
          min={0} max={25} step={0.1}
          valMin={params.velocityMin} valMax={params.velocityMax}
          onChangeMin={(v) => set('velocityMin', v)}
          onChangeMax={(v) => set('velocityMax', v)}
        />

        {/* Step Sizes */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Step Sizes</h3>
          <NumInput label="Angle Step" unit="deg" value={params.angleStep} step={0.1} min={0.1}
            onChange={(v) => set('angleStep', Math.max(0.1, v))} />
          <NumInput label="Velocity Step" unit="m/s" value={params.velocityStep} step={0.01} min={0.01}
            onChange={(v) => set('velocityStep', Math.max(0.01, v))} />
        </div>

        {/* Generate Button */}
        <button
          onClick={onGenerate}
          disabled={generating}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-lg transition-colors ${
            generating
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {generating ? <Loader size={15} className="animate-spin" /> : <Play size={15} />}
          {generating ? 'Generating & Refining...' : 'Generate Trajectories'}
        </button>

        {/* Estimated count hint */}
        <p className="text-xs text-gray-600 text-center">
          {Math.round((params.exitAngleMax - params.exitAngleMin) / params.angleStep + 1) *
           Math.round((params.velocityMax - params.velocityMin) / params.velocityStep + 1)} combinations × {dxValues.length} distance{dxValues.length !== 1 ? 's' : ''}
        </p>
      </div>
    </aside>
  );
}