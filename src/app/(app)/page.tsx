// Dashboard — owner dan kasir (FR-30).
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Placeholder } from "./placeholder";

export default async function DashboardPage() {
  const sesi = await requireAuth();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Halo, ${sesi.nama}`}
        description="Outlet Bojongsoang · Buka 09.00 – 21.00 WIB"
        badge={
          <Badge variant="primary">
            {sesi.peran === "owner" ? "Owner View" : "Kasir View"}
          </Badge>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Ringkasan Operasional</CardTitle>
          <CardDescription>
            Selamat datang di sistem manajemen operasional laundry sepatu Solemate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Placeholder
            judul="Dashboard Operasional"
            catatan="Kartu metrik hari ini, tren pesanan, dan tiket terbaru akan aktif pada Fase 7."
          />
        </CardContent>
      </Card>
    </div>
  );
}
