// Komponen Badge Solemate Design System.
// Menampilkan status pesanan, status bayar, dan label pill dengan teks yang selalu terbaca.
import * as React from "react";
import {
  KONFIGURASI_STATUS_PESANAN,
  KONFIGURASI_STATUS_BAYAR,
  type StatusPesanan,
  type StatusBayar,
} from "@/config/status";

export type BadgeVariant =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "pesanan"
  | "bayar";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  statusPesanan?: StatusPesanan;
  statusBayar?: StatusBayar;
}

export function Badge({
  children,
  className = "",
  variant = "default",
  statusPesanan,
  statusBayar,
  ...props
}: BadgeProps) {
  const baseStyle =
    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-outfit text-xs font-bold uppercase tracking-wider border select-none leading-none";

  // Varian khusus status pesanan (menggunakan pemetaan terpusat)
  if (variant === "pesanan" || statusPesanan) {
    const config = statusPesanan ? KONFIGURASI_STATUS_PESANAN[statusPesanan] : null;
    const style = config?.className ?? "bg-surface-subtle text-text-muted border-border-card";
    const label = children ?? config?.label ?? statusPesanan;

    return (
      <span className={`${baseStyle} ${style} ${className}`} {...props}>
        {label}
      </span>
    );
  }

  // Varian khusus status bayar (menggunakan pemetaan terpusat)
  if (variant === "bayar" || statusBayar) {
    const config = statusBayar ? KONFIGURASI_STATUS_BAYAR[statusBayar] : null;
    const style = config?.className ?? "bg-surface-subtle text-text-muted border-border-card";
    const label = children ?? config?.label ?? statusBayar;

    return (
      <span className={`${baseStyle} ${style} ${className}`} {...props}>
        {label}
      </span>
    );
  }

  const variantStyles: Record<Exclude<BadgeVariant, "pesanan" | "bayar">, string> = {
    default: "bg-surface-subtle text-text-muted border-border-card",
    primary: "bg-primary-light text-primary-dark border-primary/20",
    success: "bg-status-sudah-diambil-bg text-status-sudah-diambil-text border-status-sudah-diambil-border",
    warning: "bg-status-siap-diambil-bg text-status-siap-diambil-text border-status-siap-diambil-border",
    danger: "bg-status-dibatalkan-bg text-status-dibatalkan-text border-status-dibatalkan-border",
  };

  return (
    <span
      className={`${baseStyle} ${variantStyles[variant as keyof typeof variantStyles] ?? variantStyles.default} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
