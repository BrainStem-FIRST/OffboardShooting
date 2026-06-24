import { panelHint } from './panelStyles';

interface ProgressBarProps {
  /** Progress value from 0 to 1. */
  progress: number;
  /** Detail line shown below the bar. */
  detail?: string;
  /** Tailwind fill color class (default: bg-blue-500). */
  fillClassName?: string;
  /** Show "% complete" line (default: true). */
  showPercent?: boolean;
  className?: string;
}

export function ProgressBar({
  progress,
  detail,
  fillClassName = 'bg-blue-500',
  showPercent = true,
  className = '',
}: ProgressBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <div className={`space-y-1 ${className}`.trim()}>
      <div className="relative h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-100 ${fillClassName}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {detail != null && (
        <p className={`${panelHint} text-center tabular-nums`}>{detail}</p>
      )}
      {showPercent && (
        <p className={`${panelHint} text-center tabular-nums`}>{pct}% complete</p>
      )}
    </div>
  );
}
