import type { Metadata } from "next";
import { Inter, Noto_Sans_Devanagari, Noto_Sans_Kannada, Noto_Sans_Tamil } from "next/font/google";
import { Providers } from "@/components/app/providers";
import { BRAND } from "@/config/brand";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const tamil = Noto_Sans_Tamil({ variable: "--font-tamil", subsets: ["tamil"] });
const kannada = Noto_Sans_Kannada({ variable: "--font-kannada", subsets: ["kannada"] });
const devanagari = Noto_Sans_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"] });

export const metadata: Metadata = { title: { default: BRAND.name, template: `%s · ${BRAND.name}` }, description: BRAND.tagline };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${tamil.variable} ${kannada.variable} ${devanagari.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
