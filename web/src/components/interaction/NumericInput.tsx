import type { InputHTMLAttributes, ReactNode } from "react";
import "./NumericInput.css";

type NumericInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  /** Plain-language explanation under the field (ELI5). */
  help?: ReactNode;
};

export function NumericInput({
  label,
  help,
  className = "",
  id,
  ...props
}: NumericInputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  const helpId = help ? `${inputId}-help` : undefined;

  return (
    <label className={`numeric-input ${className}`.trim()} htmlFor={inputId}>
      <span className="numeric-input-label">{label}</span>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        aria-describedby={helpId}
        {...props}
      />
      {help ? (
        <span id={helpId} className="numeric-input-help">
          {help}
        </span>
      ) : null}
    </label>
  );
}
