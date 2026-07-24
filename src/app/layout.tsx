import type { Metadata } from "next";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "树洞 · 听你慢慢说",
  description: "一个低压力、可随时打断的实时语音树洞。不保存音频。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
