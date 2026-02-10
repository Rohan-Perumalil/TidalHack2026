import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Polar Intro",
  description: "Globe-to-winter transition with penguin hero",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
