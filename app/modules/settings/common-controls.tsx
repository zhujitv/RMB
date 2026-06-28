import { UiSwitch } from "../../components";

export function BooleanSelect({ label, value, disabled, onChange }: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <UiSwitch
      label={label}
      checked={Boolean(value)}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
