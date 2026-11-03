// Komponen Button Solemate Design System.
// Memiliki tap target minimal 44px (tablet kasir) dan focus ring yang jelas.
import * as React from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className = "",
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      type = "button",
      ...props
    },
    ref
  ) => {
    // Basis: font Outfit, transition halus, focus ring kontras, tap target >= 44px
    const baseStyle =
      "inline-flex items-center justify-center font-outfit font-semibold transition-all select-none " +
      "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none " +
      "disabled:opacity-50 disabled:pointer-events-none cursor-pointer active:scale-[0.98]";

    const variantStyles: Record<ButtonVariant, string> = {
      primary:
        "bg-primary text-white shadow-xs hover:bg-primary-hover active:bg-primary-dark",
      secondary:
        "bg-surface-card text-primary border border-border-card hover:bg-surface-hover active:bg-surface-subtle",
      danger:
        "bg-danger text-white shadow-xs hover:bg-danger-hover active:bg-danger",
      ghost:
        "bg-transparent text-text-muted hover:bg-surface-hover hover:text-primary",
    };

    const sizeStyles: Record<ButtonSize, string> = {
      sm: "min-h-[44px] px-3.5 py-2 text-xs rounded-xl gap-2",
      md: "min-h-[44px] px-5 py-2.5 text-sm rounded-2xl gap-2.5",
      lg: "min-h-[48px] px-7 py-3.5 text-base rounded-full gap-3",
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={`${baseStyle} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

