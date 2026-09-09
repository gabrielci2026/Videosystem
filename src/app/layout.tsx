import type { Metadata } from "next";
import "./globals.css";
import "./functional.css";
import "./meeting.css";

export const metadata: Metadata = {
  title: "VideoSystem",
  description: "Comunicacion privada para equipos",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
