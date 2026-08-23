import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import "./NumericInput.css";

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
  /** Plain-language explanation under the field (ELI5). */
  help?: ReactNode;
  type?: HTMLInputElement["type"];
};

export function TextInput({
  label,
  help,
  className = "",
  id,
  type = "text",
  ...props
}: TextInputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  const helpId = help ? `${inputId}-help` : undefined;

  return (
    <label className={`numeric-input ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="numeric-input-label">{label}</span> : null}
      <input id={inputId} type={type} aria-describedby={helpId} {...props} />
      {help ? (
        <span id={helpId} className="numeric-input-help">
          {help}
        </span>
      ) : null}
    </label>
  );
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  help?: ReactNode;
};

export function TextArea({ label, help, className = "", id, rows = 3, ...props }: TextAreaProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  const helpId = help ? `${inputId}-help` : undefined;

  return (
    <label className={`numeric-input ${className}`.trim()} htmlFor={inputId}>
      <span className="numeric-input-label">{label}</span>
      <textarea id={inputId} rows={rows} aria-describedby={helpId} {...props} />
      {help ? (
        <span id={helpId} className="numeric-input-help">
          {help}
        </span>
      ) : null}
    </label>
  );
}
