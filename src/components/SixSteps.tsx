"use client";

const STEPS = [
  {
    num: "01",
    title: "プロダクト分析",
    desc: "URLか説明文を入れるだけ。AIが本質的価値・ペルソナ・競合差分を自動抽出。",
  },
  {
    num: "02",
    title: "ターゲット発見",
    desc: "X・Reddit・LinkedIn・TikTok・Instagram・Facebookをリアルタイムスキャン。今まさに困っている人だけを特定。",
  },
  {
    num: "03",
    title: "コメント生成",
    desc: "相手の言語・文脈・最近の投稿に合わせた、スパムに見えない自然なコメントを自動生成。",
  },
  {
    num: "04",
    title: "承認 & 自動投稿",
    desc: "半自動モード：あなたが承認して投稿。慣れたら全自動に切り替え可能。",
  },
  {
    num: "05",
    title: "返信検知 & 学習",
    desc: "何が刺さったかをリアルタイム分析。コメント・チャネルを自動改善し続ける。",
  },
  {
    num: "06",
    title: "100人獲得",
    desc: "βユーザー確保・オンボーディング・フィードバック収集まで全自動。",
  },
];

export default function SixSteps() {
  return (
    <section className="relative py-16 md:py-24" style={{ zIndex: 1 }}>
      <div className="w-full max-w-5xl mx-auto px-6">
        {/* Header */}
        <div className="w-full text-center mb-16">
          <h2 className="w-full text-center font-heading font-bold text-[clamp(1.8rem,4vw,2.8rem)] mb-4">
            <span className="text-orange">6</span>ステップで最初の
            <span className="text-orange">100人</span>へ
          </h2>
          <p className="w-full text-center text-muted text-base max-w-lg mx-auto">
            URLを入力してから100人獲得まで、すべてAIが自動化
          </p>
        </div>

        {/* 3×2 Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">

          {STEPS.map((step) => (
            <div
              key={step.num}
              className="group relative rounded-2xl p-7 transition-all duration-300 cursor-default
                         hover:-translate-y-1"
              style={{
                background: "#13132a",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              {/* Top gradient line on hover */}
              <div
                className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl opacity-0
                           group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background: "linear-gradient(90deg, #ff6b35, #ffd60a)",
                }}
              />

              {/* Step number */}
              <div
                className="text-xs font-mono font-bold mb-3 tracking-wider"
                style={{ color: "#ff6b35" }}
              >
                STEP {step.num}
              </div>

              {/* Title */}
              <h3
                className="font-heading font-bold text-lg mb-3 text-text
                           group-hover:text-orange transition-colors duration-200"
              >
                {step.title}
              </h3>

              {/* Description */}
              <p
                className="text-sm leading-relaxed"
                style={{ color: "rgba(240,239,232,0.5)" }}
              >
                {step.desc}
              </p>
            </div>
          ))}
        </div>



      </div>
    </section>
  );
}
