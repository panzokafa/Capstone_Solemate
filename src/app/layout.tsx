import type { Metadata } from "next";
import { Outfit, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Solemate Shoes Clean",
  description: "Sistem manajemen laundry sepatu Solemate",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${outfit.variable} ${jakarta.variable} h-full antialiased`}>
      <head>
        {/* Material Symbols untuk ikon sidebar.
            Aturan no-page-custom-font khusus Pages Router; di App Router root layout
            inilah tempat yang benar menaruh <link>. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=optional"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
