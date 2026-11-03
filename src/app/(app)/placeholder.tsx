// Placeholder halaman sampai fiturnya dibangun di fase berikutnya.
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";

export function Placeholder({ judul, catatan }: { judul: string; catatan?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={judul}
        description={
          catatan ?? "Halaman sementara. Fitur ini dibangun pada fase berikutnya sesuai PRD."
        }
      />
      <Card>
        <CardContent className="pt-6">
          <p className="font-jakarta text-sm text-text-muted">
            Halaman ini sudah terlindungi pemeriksaan peran dan autentikasi di server.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
