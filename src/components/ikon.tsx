// Komponen SVG Ikon Solemate berbasis Lucide React.
// Menghindari rendering nama ikon sebagai teks jika font eksternal gagal.
import type { LucideProps } from "lucide-react";
import { PEMETAAN_IKON, type NamaIkon } from "@/config/icons";

export { PEMETAAN_IKON, type NamaIkon };

export interface IkonProps extends LucideProps {
  name: NamaIkon | string;
}

export function Ikon({ name, ...props }: IkonProps) {
  const Komponen = PEMETAAN_IKON[name];
  if (!Komponen) {
    return null;
  }
  return <Komponen {...props} />;
}

