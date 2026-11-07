// Komponen FilterBar & FilterChip Solemate Design System.
// Menyediakan wadah filter periode, toggle prioritas, dan pencarian dengan target sentuh >= 44px.
import * as React from "react";

export interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
}

export function FilterBar({ children, className = "" }: FilterBarProps) {
  return (
    <section
      aria-label="Filter dan pencarian"
      className={`rounded-3xl border border-border-card bg-surface-card p-4 sm:p-5 shadow-xs flex flex-col gap-4 ${className}`}
    >
      {children}
    </section>
  );
}

export interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function FilterChip({
  active = false,
  className = "",
  children,
  type = "button",
  ...props
}: FilterChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl px-4 py-2 font-outfit text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none ${
        active
          ? "bg-primary text-white shadow-xs"
          : "bg-surface-subtle text-text-body border border-border-card hover:bg-surface-hover"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
