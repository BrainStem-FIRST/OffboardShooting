export interface SegmentedToggleOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: SegmentedToggleOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

export default function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  className = '',
}: Props<T>) {
  return (
    <div className={`inline-flex rounded-md border border-gray-700 bg-gray-900 p-0.5 ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`h-7 px-3 text-xs font-medium rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
