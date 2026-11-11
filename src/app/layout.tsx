import type { Metadata, Viewport } from "next";
import { Fraunces, Geist } from "next/font/google";
import "./globals.css";

const display = Fraunces({ variable: "--font-display", subsets: ["latin"], axes: ["SOFT", "WONK"] });
const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Stockpot",
  description: "Raid your own kitchen before you go shopping.",
};

export const viewport: Viewport = { themeColor: "#f6efe3", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
