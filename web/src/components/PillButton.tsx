import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "solid" | "ghost";
};

export function PillButton({
  children,
  variant = "solid",
  className = "",
  type = "button",
  ...props
}: Props) {
  return (
    <button type={type} className={`pill-btn pill-btn-${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
