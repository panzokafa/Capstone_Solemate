// Pemetaan terpusat nama ikon ke komponen SVG Lucide React.
// Menghilangkan ketergantungan font ikon eksternal.
import {
  LayoutDashboard,
  Ticket,
  Calendar,
  CalendarRange,
  Tag,
  IdCard,
  ClipboardCheck,
  CirclePlus,
  Clock,
  LogOut,
  Ban,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";

export const PEMETAAN_IKON: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  confirmation_number: Ticket,
  event_note: Calendar,
  calendar_month: CalendarRange,
  style: Tag,
  badge: IdCard,
  fact_check: ClipboardCheck,
  add_circle: CirclePlus,
  schedule: Clock,
  logout: LogOut,
  block: Ban,
  menu: Menu,
  close: X,
};

export type NamaIkon = keyof typeof PEMETAAN_IKON;
