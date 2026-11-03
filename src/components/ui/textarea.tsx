// Komponen Textarea Solemate Design System.
// Memiliki label, pesan galat, teks bantuan, dan focus ring.
import * as React from "react";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, id, className = "", required, rows = 3, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id || generatedId;
    const errorId = `${textareaId}-error`;
    const helperId = `${textareaId}-helper`;

    return (
      <div className="flex flex-col gap-1.5 w-full text-left">
        {label && (
          <label
            htmlFor={textareaId}
            className="font-outfit text-xs font-semibold text-text-muted uppercase tracking-wider select-none"
          >
            {label}
            {required && <span className="text-danger ml-1">*</span>}
          </label>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? errorId : helperText ? helperId : undefined
          }
          className={`w-full px-4 py-2.5 rounded-xl bg-surface-subtle text-text-body font-jakarta text-sm border transition-colors outline-none placeholder:text-text-muted/60 ${
            error
              ? "border-danger focus:border-danger focus:ring-2 focus:ring-danger/20"
              : "border-border-card focus:border-primary focus:ring-2 focus:ring-primary/20"
          } disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
          {...props}
        />

        {error && (
          <p id={errorId} className="font-jakarta text-xs text-danger font-medium mt-0.5">
            {error}
          </p>
        )}

        {!error && helperText && (
          <p id={helperId} className="font-jakarta text-xs text-text-muted mt-0.5">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

