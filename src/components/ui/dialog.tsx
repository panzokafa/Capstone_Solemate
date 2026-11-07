"use client";

// Komponen Dialog Solemate Design System, memakai elemen <dialog> bawaan browser (showModal).
// Browser mengurus focus trap, tombol Esc, dan lapisan latar. Klik di luar kotak menutup dialog.
// Isi dirender hanya saat terbuka, jadi state form di dalamnya selalu bersih tiap dibuka.
import * as React from "react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Dialog({ open, onClose, title, description, children, footer }: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const judulId = React.useId();

  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={judulId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-border-card bg-surface-card p-0 text-text-body shadow-xl backdrop:bg-primary-dark/50"
    >
      {open && (
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1">
            <h2 id={judulId} className="font-outfit text-xl font-bold text-text-main">
              {title}
            </h2>
            {description && (
              <p className="font-jakarta text-sm text-text-muted">{description}</p>
            )}
          </div>
          {children}
          {footer && <div className="flex flex-wrap justify-end gap-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
