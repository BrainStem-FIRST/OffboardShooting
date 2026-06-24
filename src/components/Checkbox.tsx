import { panelCheckboxBlue, panelCheckboxGreen, panelLabelInline } from './panelStyles';

export type CheckboxColor = 'blue' | 'green';

const checkboxColorClass: Record<CheckboxColor, string> = {
  blue: panelCheckboxBlue,
  green: panelCheckboxGreen,
};

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: CheckboxColor;
  className?: string;
  id?: string;
}

export function Checkbox({
  checked,
  onChange,
  disabled = false,
  color = 'blue',
  className = '',
  id,
}: CheckboxProps) {
  return (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className={`${checkboxColorClass[color]} ${className}`.trim()}
    />
  );
}

export interface CheckboxLabelProps extends CheckboxProps {
  label: React.ReactNode;
  labelClassName?: string;
  wrapperClassName?: string;
  title?: string;
}

export function CheckboxLabel({
  label,
  labelClassName = panelLabelInline,
  wrapperClassName = '',
  disabled = false,
  title,
  ...checkboxProps
}: CheckboxLabelProps) {
  return (
    <label
      title={title}
      className={`flex items-center gap-2 select-none ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${wrapperClassName}`.trim()}
    >
      <Checkbox disabled={disabled} {...checkboxProps} />
      <span className={labelClassName}>{label}</span>
    </label>
  );
}
