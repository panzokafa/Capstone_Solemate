// Komponen logo resmi Solemate Shoes Clean (dipakai di Login, Sidebar, Header mobile, dan Absensi).
import Image from "next/image";

export type UkuranLogoSolemate = "topbar" | "sidebar" | "halaman";

const KELAS_WADAH: Record<UkuranLogoSolemate, string> = {
  topbar: "h-12 w-12",
  sidebar: "h-16 w-16",
  halaman: "h-20 w-20",
};

export function LogoSolemate({
  ukuran = "sidebar",
  className = "",
}: {
  ukuran?: UkuranLogoSolemate;
  className?: string;
}) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-lg ${KELAS_WADAH[ukuran]} ${className}`}
    >
      <Image
        src="/logo-solemate.jpeg"
        alt="Solemate Shoes Clean"
        width={225}
        height={225}
        loading="eager"
        className="h-full w-full object-contain"
      />
    </div>
  );
}
