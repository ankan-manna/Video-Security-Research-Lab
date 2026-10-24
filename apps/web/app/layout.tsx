import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Security Research Lab",
  description:
    "Standalone security research lab for analyzing video URLs, HTTP metadata, and streaming formats.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-lab-bg font-mono text-sm text-lab-accent antialiased">
        {children}
      </body>
    </html>
  );
}
