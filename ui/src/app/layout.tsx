import type { Metadata } from "next";
import "./globals.css";
import JarvisHUD from "@/components/JarvisHUD";

export const metadata: Metadata = {
  title: "Vigilance-OS | Autonomous Security Pipeline",
  description: "Decentralized whitehat security pipeline powered by Nosana GPU and ElizaOS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-theme="jarvis">
      <body className="min-h-full flex flex-col">
        <JarvisHUD />
        {children}
        <div className="scanlines"></div>
      </body>
    </html>
  );
}
