// Komponen Skeleton Solemate Design System untuk indikator pemuatan data.
import * as React from "react";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className = "", ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-2xl bg-surface-subtle ${className}`}
      {...props}
    />
  );
}
