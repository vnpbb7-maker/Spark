"use client";

import { useState } from "react";
import SparkCanvas from "@/components/SparkCanvas";
import SixSteps from "@/components/SixSteps";
import LiveLog from "@/components/LiveLog";

/* ── Data ── */

const PLATFORMS = [
  { name: "X",         icon: "𝕏",  color: "#1d9bf0" },
  { name: "Reddit",    icon: "🤖", color: "#ff4500" },
  { name: "LinkedIn",  icon: "in", color: "#0a66c2" },
  { name: "TikTok",    icon: "♪",  color: "#ff0050" },
  { name: "Instagram", icon: "◈",  color: "#e1306c" },
  { name: "Facebook",  icon: "f",  color: "#1877f2" },
];

const PLANS = [
  {
    name: "Starter",
    price: "$99",
    period: "/月",
    tagline: "まず試したい方へ",
    featured: false,
    features: [
      "ターゲット発見のみ",
      "コメント生成（手動投稿）",
      "月50ターゲット",
      "X / Reddit のみ",
    ],
    cta: "無料で試す",
  },
  {
    name: "Growth",
    price: "$299",
    period: "/月",
    tagline: "🔥 一番人気",
    featured: true,
    features: [
      "自動コメント投稿（全6プラットフォーム）",
      "半自動→全自動切り替え",
      "Realtimeダッシュボード",
      "AIインサイトレポート",
      "月200ターゲット",
      "Bot検知回避（人間風タイピング）",
    ],
    cta: "Growth を始める",
  },
  {
    name: "Agency",
    price: "$999",
    period: "/月",
    tagline: "代理店・大規模向け",
    featured: false,
    features: [
      "Growth全機能",
      "複数クライアント管理",
      "ホワイトラベルUI",
      "API直接アクセス",
      "無制限ターゲット",
    ],
    cta: "お問い合わせ",
  },
];

export default function LandingPage() {
  const [url, setUrl] = useState("");

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* ── Background Spark Particles (fixed, full-page) ── */}
      <SparkCanvas />

      {/* ═══════════════════ NAV ═══════════════════ */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-border backdrop-blur-xl bg-bg/85">
        <div className="mx-auto max-w-[1200px] h-16 px-6 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2 font-heading font-bold text-[22px]">
            <span className="text-orange text-2xl">⚡</span>
            <span>SPARK</span>
          </div>

          {/* CTA */}
          <a
            href="#pricing"
            className="group relative bg-orange text-white px-6 py-2.5 rounded-xl text-sm font-semibold no-underline
                       shadow-[0_0_20px_rgba(255,107,53,0.35)]
                       hover:shadow-[0_0_30px_rgba(255,107,53,0.55)]
                       hover:-translate-y-0.5
                       transition-all duration-200"
          >
            無料で始める
          </a>
        </div>
      </nav>

      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-28 pb-20 overflow-hidden grid-lines">
        {/* Radial glow */}
        <div className="absolute inset-0 z-0 hero-radial pointer-events-none" />

        {/* Floating accent orbs */}
        <div className="absolute top-1/4 left-[10%] w-72 h-72 rounded-full bg-orange/5 blur-[100px] animate-float pointer-events-none" />
        <div className="absolute bottom-1/4 right-[10%] w-96 h-96 rounded-full bg-purple/5 blur-[120px] animate-float pointer-events-none [animation-delay:3s]" />

        <div className="relative z-10 max-w-[800px]">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 bg-orange/10 border border-orange/30 rounded-full
                        px-4 py-1.5 text-[13px] text-orange font-semibold tracking-wide mb-10
                        animate-fade-in-up"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-orange inline-block" style={{ animation: "pulse-dot 2s infinite" }} />
            AI Growth Engine — Beta
          </div>

          {/* Heading */}
          <h1
            className="font-heading font-bold leading-[1.08] tracking-tight mb-7
                        text-[clamp(2.5rem,7vw,5rem)]
                        animate-fade-in-up [animation-delay:0.15s]"
          >
            あなたのプロダクトに
            <br />
            <span className="text-orange text-glow-orange">最初の火をつける。</span>
          </h1>

          {/* Sub */}
          <p
            className="text-muted text-[clamp(1rem,2.5vw,1.2rem)] leading-relaxed max-w-[560px]
                        mx-auto mb-12
                        animate-fade-in-up [animation-delay:0.3s]"
          >
            URLを入れるだけ。AIが最初の100人を連れてくる。
          </p>

          {/* URL Input */}
          <div
            className="flex gap-0 max-w-[560px] mx-auto mb-4 bg-surface border border-orange/30
                        rounded-2xl p-1.5
                        shadow-[0_0_40px_rgba(255,107,53,0.15)]
                        focus-within:shadow-[0_0_60px_rgba(255,107,53,0.25)]
                        focus-within:border-orange/50
                        transition-all duration-300
                        animate-fade-in-up [animation-delay:0.45s]"
          >
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourproduct.com"
              className="flex-1 bg-transparent border-none outline-none text-text text-[15px]
                         px-4 py-3 font-body placeholder:text-hint"
            />
            <button
              className="bg-orange text-white border-none rounded-xl px-6 py-3 text-[15px]
                         font-bold font-heading cursor-pointer whitespace-nowrap
                         hover:scale-[1.03] hover:shadow-[0_0_24px_rgba(255,107,53,0.5)]
                         active:scale-[0.98]
                         transition-all duration-200"
            >
              火をつける →
            </button>
          </div>
          <p className="text-[13px] text-hint animate-fade-in-up [animation-delay:0.6s]">
            無料で試せます · クレジットカード不要
          </p>
        </div>
      </section>

      {/* ═══════════════════ PLATFORMS ═══════════════════ */}
      <section className="relative border-t border-b border-border bg-surface py-7 px-6" style={{ zIndex: 1 }}>
        <div className="max-w-[1000px] mx-auto flex items-center justify-center gap-3 flex-wrap">
          <span className="text-hint text-[13px] mr-2">対応プラットフォーム</span>
          {PLATFORMS.map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-2 bg-white/[0.04] border border-border2 rounded-lg
                         px-4 py-2 text-[13px] font-medium
                         hover:bg-white/[0.07] hover:border-white/20
                         transition-all duration-200 cursor-default"
            >
              <span className="font-bold text-[15px]" style={{ color: p.color }}>{p.icon}</span>
              <span className="text-muted">{p.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════ 6 STEPS ═══════════════════ */}
      <SixSteps />

      {/* ═══════════════════ LIVE LOG ═══════════════════ */}
      <LiveLog />

      {/* ═══════════════════ PRICING ═══════════════════ */}
      <section id="pricing" className="relative py-24 px-6" style={{ zIndex: 1 }}>
        <div className="max-w-[1100px] mx-auto">
          {/* Header */}
          <div className="text-center mb-16">
            <h2 className="font-heading font-bold text-[clamp(1.8rem,4vw,2.8rem)] mb-4">
              シンプルな料金プラン
            </h2>
            <p className="text-muted text-base">
              スタートアップから代理店まで、規模に合わせて選べます
            </p>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`
                  relative rounded-2xl p-8 overflow-hidden
                  transition-all duration-300 cursor-default
                  ${plan.featured
                    ? "bg-orange/[0.08] border border-orange/40 scale-[1.04] shadow-[0_0_60px_rgba(255,107,53,0.2),0_20px_60px_rgba(0,0,0,0.4)]"
                    : plan.name === "Agency"
                      ? "bg-purple/[0.06] border border-purple/30 hover:scale-[1.02] hover:border-purple/50"
                      : "bg-white/[0.04] border border-white/10 hover:scale-[1.02] hover:border-white/20"
                  }
                `}
              >
                {/* Featured top bar */}
                {plan.featured && (
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-orange to-yellow" />
                )}

                {/* Tag */}
                <div className="mb-6">
                  <span
                    className={`text-xs font-bold tracking-wider uppercase ${
                      plan.featured ? "text-orange" : "text-muted"
                    }`}
                  >
                    {plan.tagline}
                  </span>
                  <div className="font-heading font-bold text-[22px] mt-2">{plan.name}</div>
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-1 mb-7">
                  <span className="font-heading font-bold text-5xl">{plan.price}</span>
                  <span className="text-muted text-[15px]">{plan.period}</span>
                </div>

                {/* Features */}
                <ul className="list-none mb-8 flex flex-col gap-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-muted">
                      <span className="text-green font-bold shrink-0 mt-0.5">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA Button */}
                <button
                  className={`
                    w-full rounded-xl py-3.5 text-[15px] font-bold font-heading cursor-pointer
                    transition-all duration-200
                    hover:-translate-y-0.5
                    ${plan.featured
                      ? "bg-orange text-white border-none shadow-[0_0_20px_rgba(255,107,53,0.4)] hover:shadow-[0_0_30px_rgba(255,107,53,0.6)]"
                      : "bg-white/[0.08] text-text border border-white/15 hover:bg-white/[0.12]"
                    }
                  `}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ FOOTER ═══════════════════ */}
      <footer className="relative border-t border-border py-8 px-6 text-hint text-[13px]" style={{ zIndex: 1 }}>
        <div className="max-w-[1200px] mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-1.5 font-heading font-bold text-base text-text">
            <span className="text-orange">⚡</span> SPARK
          </div>
          <p>© 2025 SPARK. AI Growth Engine.</p>
        </div>
      </footer>
    </div>
  );
}
