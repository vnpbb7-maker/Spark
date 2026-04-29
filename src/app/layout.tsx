import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SPARK — AI Growth Engine | 最初の100人を獲得する",
  description:
    "URLを入れるだけ。AIがターゲットを発見し、コメントで自動接触し、最初の100人のβユーザーを獲得します。",
  keywords: "AI, growth hacking, user acquisition, SaaS, beta users, automated outreach",
  openGraph: {
    title: "SPARK — AI Growth Engine",
    description: "あなたのプロダクトに最初の火をつける。URLを入れるだけで最初の100人を獲得。",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
