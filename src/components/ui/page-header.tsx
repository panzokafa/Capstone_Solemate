// Komponen PageHeader Solemate Design System.
// Menjamin konsistensi judul halaman, deskripsi, dan tombol aksi di seluruh aplikasi.
import * as React from "react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  badge,
  className = "",
}: PageHeaderProps) {
  return (
    <div
      className={`mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border-warm/70 ${className}`}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="font-outfit text-2xl sm:text-3xl font-extrabold text-text-main tracking-tight leading-tight">
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p className="font-jakarta text-sm text-text-muted max-w-2xl">
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
}

