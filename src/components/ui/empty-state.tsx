// Komponen EmptyState Solemate Design System untuk keadaan data/filter kosong.
import * as React from "react";
import { Ikon, type NamaIkon } from "@/components/ikon";
import { Card, CardContent } from "./card";

export interface EmptyStateProps {
  icon?: NamaIkon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-subtle text-primary">
          <Ikon name={icon} size={28} className="h-7 w-7 shrink-0" aria-hidden="true" />
        </div>
        <h2 className="font-outfit text-lg font-bold text-text-main">{title}</h2>
        {description && (
          <p className="max-w-md font-jakarta text-sm text-text-muted leading-relaxed">
            {description}
          </p>
        )}
        {action && <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div>}
      </CardContent>
    </Card>
  );
}
