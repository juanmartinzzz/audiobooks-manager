import { useMemo, useState, type ReactNode } from "react";
import "./PillSelect.css";

export type PillOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

type PillSelectBase = {
  label?: string;
  options: PillOption[];
  /** Visible count before “Show more”. Default 4. */
  limit?: number;
  disabled?: boolean;
  className?: string;
};

type SinglePillSelectProps = PillSelectBase & {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
};

type MultiPillSelectProps = PillSelectBase & {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
};

export type PillSelectProps = SinglePillSelectProps | MultiPillSelectProps;

function isSelected(
  multiple: boolean | undefined,
  value: string | string[],
  optionValue: string,
): boolean {
  if (multiple) {
    return (value as string[]).includes(optionValue);
  }
  return value === optionValue;
}

export function PillSelect(props: PillSelectProps) {
  const { label, options, limit = 4, disabled = false, className = "", multiple, value, onChange } =
    props;

  const [expanded, setExpanded] = useState(false);

  const selectedValues = useMemo(() => {
    if (multiple) return value as string[];
    return value ? [value as string] : [];
  }, [multiple, value]);

  const visibleOptions = useMemo(() => {
    if (expanded || options.length <= limit) return options;

    const head = options.slice(0, limit);
    const headValues = new Set(head.map((o) => o.value));
    const missingSelected = options.filter(
      (o) => selectedValues.includes(o.value) && !headValues.has(o.value),
    );

    if (missingSelected.length === 0) return head;

    // Keep selected pills visible while collapsed.
    const merged = [...missingSelected, ...head];
    const seen = new Set<string>();
    const deduped: PillOption[] = [];
    for (const option of merged) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      deduped.push(option);
      if (deduped.length >= limit + missingSelected.length) break;
    }
    return deduped;
  }, [expanded, options, limit, selectedValues]);

  const hiddenCount = Math.max(0, options.length - visibleOptions.length);
  const canToggle = options.length > limit;

  function handleSelect(optionValue: string) {
    if (disabled) return;
    if (multiple) {
      const current = value as string[];
      const next = current.includes(optionValue)
        ? current.filter((v) => v !== optionValue)
        : [...current, optionValue];
      (onChange as MultiPillSelectProps["onChange"])(next);
      return;
    }
    (onChange as SinglePillSelectProps["onChange"])(optionValue);
  }

  return (
    <div className={`pill-select ${className}`.trim()}>
      {label ? <span className="pill-select-label">{label}</span> : null}
      <div className="pill-select-list" role={multiple ? "group" : "radiogroup"} aria-label={label}>
        {visibleOptions.map((option) => {
          const selected = isSelected(multiple, value, option.value);
          return (
            <button
              key={option.value}
              type="button"
              role={multiple ? "checkbox" : "radio"}
              aria-checked={selected}
              disabled={disabled}
              className={`pill-select-option${selected ? " is-selected" : ""}`}
              onClick={() => handleSelect(option.value)}
            >
              {option.icon ? (
                <span className="pill-select-option-icon" aria-hidden>
                  {option.icon}
                </span>
              ) : null}
              {option.label}
            </button>
          );
        })}
        {canToggle ? (
          <button
            type="button"
            className="pill-select-more"
            disabled={disabled}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : `Show more (${hiddenCount || options.length - limit})`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
