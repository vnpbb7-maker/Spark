"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Home() {
  const [url, setUrl] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsLoggedIn(!!user);
    };
    checkAuth();
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const cx = cv.getContext("2d");
    if (!cx) return;

    const resize = () => { cv!.width = cv!.offsetWidth; cv!.height = cv!.offsetHeight; };
    resize();
    window.addEventListener("resize", resize);


    class Spark {
      x=0;y=0;vx=0;vy=0;life=0;decay=0;sz=0;tail:{x:number;y:number;life:number}[]=[];maxTail=0;col:[number,number,number]=[255,107,53];wobble=0;
      constructor(){ this.reset(true); }
      reset(init:boolean){
        this.x=Math.random()*cv!.width;
        this.y=init?Math.random()*cv!.height:cv!.height+4;
        this.vx=(Math.random()-0.5)*1.8; this.vy=-(Math.random()*2.4+0.8);
        this.life=init?Math.random():1; this.decay=Math.random()*0.012+0.006;
        this.sz=Math.random()*2.2+0.4; this.tail=[]; this.maxTail=Math.floor(Math.random()*5+3);
        const r=Math.random();
        this.col=r<0.45?[255,107,53]:r<0.78?[255,214,10]:[255,160,60];
        this.wobble=Math.random()*0.08-0.04;
      }
      update(){
        this.tail.unshift({x:this.x,y:this.y,life:this.life});
        if(this.tail.length>this.maxTail)this.tail.pop();
        this.x+=this.vx; this.y+=this.vy;
        this.vy+=0.025; this.vx+=this.wobble; this.vx*=0.992;
        this.life-=this.decay;
        if(this.life<=0||this.y<-10)this.reset(false);
      }
      draw(){
        const [r,g,b]=this.col;
        for(let i=0;i<this.tail.length;i++){
          const t=this.tail[i],a=t.life*(1-i/this.tail.length)*0.45,s=this.sz*(1-i/this.tail.length)*0.7;
          cx.beginPath();cx.arc(t.x,t.y,Math.max(s,0.2),0,Math.PI*2);
          cx.fillStyle=`rgba(${r},${g},${b},${a})`;cx.fill();
        }
        cx.beginPath();cx.arc(this.x,this.y,this.sz,0,Math.PI*2);
        cx.fillStyle=`rgba(${r},${g},${b},${this.life*0.85})`;cx.fill();
        if(this.sz>1.2&&this.life>0.4){
          cx.beginPath();cx.arc(this.x,this.y,this.sz*0.45,0,Math.PI*2);
          cx.fillStyle=`rgba(255,240,200,${this.life*0.6})`;cx.fill();
        }
      }
    }

    class Ember {
      x=0;y=0;vx=0;vy=0;life=0;decay=0;sz=0;
      constructor(){this.reset(true);}
      reset(init:boolean){
        this.x=Math.random()*cv!.width;
        this.y=init?Math.random()*cv!.height:cv!.height+2;
        this.vx=(Math.random()-0.5)*0.6; this.vy=-(Math.random()*1.1+0.3);
        this.life=init?Math.random():1; this.decay=Math.random()*0.007+0.003;
        this.sz=Math.random()*1.1+0.2;
      }
      update(){
        this.x+=this.vx+Math.sin(Date.now()*0.001+this.x)*0.15;
        this.y+=this.vy; this.vy+=0.008; this.life-=this.decay;
        if(this.life<=0||this.y<-5)this.reset(false);
      }
      draw(){
        cx.beginPath();cx.arc(this.x,this.y,this.sz,0,Math.PI*2);
        cx.fillStyle=`rgba(255,180,60,${this.life*0.35})`;cx.fill();
      }
    }

    const sparks=Array.from({length:80},()=>new Spark());
    const embers=Array.from({length:50},()=>new Ember());
    let raf:number;

    const animate=()=>{
      cx!.clearRect(0,0,cv!.width,cv!.height);
      embers.forEach(e=>{e.update();e.draw();});
      sparks.forEach(s=>{s.update();s.draw();});
      raf=requestAnimationFrame(animate);
    };
    animate();

    return ()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",resize); };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        minHeight: "100vh",
        background: "#0d0d1a",
        color: "#f0efe8",
        fontFamily: "DM Sans, sans-serif",
        overflowX: "hidden",
        position: "relative",
      }}
    >
      {/* NAV */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 48px",
          background: "rgba(13,13,26,0.8)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 22 }}>
          ⚡ SPARK
        </div>
        <button
          onClick={() => router.push(isLoggedIn ? "/dashboard" : "/auth/login")}
          style={{
            background: "#ff6b35",
            color: "#fff",
            border: "none",
            borderRadius: 20,
            padding: "8px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          無料で始める
        </button>
      </nav>

      {/* Canvas fire animation */}
      <canvas ref={canvasRef} style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* HERO */}
      <section
        style={{
          width: "100%",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "120px 24px 60px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* バッジ */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(255,107,53,0.1)",
            border: "0.5px solid rgba(255,107,53,0.3)",
            borderRadius: 20,
            padding: "6px 16px",
            fontSize: 12,
            color: "#ff6b35",
            marginBottom: 28,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#ff6b35",
              display: "inline-block",
            }}
          />
          AI Growth Engine — Beta
        </div>

        {/* タイトル */}
        <h1
          style={{
            fontFamily: "Space Grotesk",
            fontSize: "clamp(36px, 6vw, 72px)",
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-2px",
            marginBottom: 24,
            width: "100%",
            textAlign: "center",
          }}
        >
          あなたのプロダクトに
          <br />
          <span style={{ color: "#ff6b35" }}>最初の火をつける。</span>
        </h1>

        {/* サブテキスト */}
        <p
          style={{
            fontSize: 18,
            color: "rgba(240,239,232,0.6)",
            lineHeight: 1.7,
            maxWidth: 520,
            margin: "0 auto 40px",
            textAlign: "center",
          }}
        >
          URL・SNSアカウントを入れるだけ。
          <br />
          AIが最初の100人を連れてくる。
        </p>

        {/* 入力フォーム */}
        <div
          style={{
            width: "100%",
            maxWidth: 560,
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(255,255,255,0.05)",
            border: "0.5px solid rgba(255,255,255,0.15)",
            borderRadius: 14,
            padding: "6px 6px 6px 20px",
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourproduct.com または instagram.com/xxxx"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 15,
              color: "#f0efe8",
              fontFamily: "DM Sans",
            }}
          />
          <button
            onClick={() => {
              if (isLoggedIn) {
                router.push("/dashboard");
              } else {
                if (url) {
                  router.push(`/auth/login?redirect=/campaigns/new?url=${encodeURIComponent(url)}`);
                } else {
                  router.push("/auth/login");
                }
              }
            }}
            style={{
              background: "#ff6b35",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "12px 24px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: "DM Sans",
            }}
          >
            火をつける →
          </button>
        </div>

        {/* 無料テキスト */}
        <p
          style={{
            fontSize: 12,
            color: "rgba(240,239,232,0.3)",
            textAlign: "center",
            width: "100%",
          }}
        >
          無料で試せます · クレジットカード不要
        </p>

        {/* プラットフォームバッジ */}
        <div
          style={{
            width: "100%",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "32px 24px",
            borderTop: "0.5px solid rgba(255,255,255,0.07)",
            borderBottom: "0.5px solid rgba(255,255,255,0.07)",
            marginTop: 40,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "rgba(240,239,232,0.3)",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            対応プラットフォーム
          </span>
          {["𝕏 X", "🤖 Reddit", "in LinkedIn", "♪ TikTok", "◈ Instagram", "f Facebook"].map(
            (p) => (
              <span
                key={p}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "rgba(240,239,232,0.6)",
                  background: "rgba(255,255,255,0.05)",
                  border: "0.5px solid rgba(255,255,255,0.1)",
                  borderRadius: 20,
                  padding: "4px 12px",
                }}
              >
                {p}
              </span>
            )
          )}
        </div>
      </section>

      {/* 6ステップ */}
      <section
        style={{
          width: "100%",
          padding: "80px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#ff6b35",
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          仕組み
        </div>
        <h2
          style={{
            fontFamily: "Space Grotesk",
            fontSize: "clamp(24px, 4vw, 42px)",
            fontWeight: 700,
            letterSpacing: -1,
            textAlign: "center",
            marginBottom: 48,
          }}
        >
          6ステップで<span style={{ color: "#ff6b35" }}>最初の100人</span>へ
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            width: "100%",
            maxWidth: 1100,
            margin: "0 auto",
          }}
        >
          {[
            {
              num: "01",
              title: "プロダクト分析",
              desc: "URLか説明文を入れるだけ。AIが本質的価値・ペルソナ・競合差分を自動抽出。",
            },
            {
              num: "02",
              title: "ターゲット発見",
              desc: "X・Reddit・LinkedIn・TikTok・Instagram・Facebookをリアルタイムスキャン。",
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
          ].map((step) => (
            <div
              key={step.num}
              style={{
                background: "#13132a",
                border: "0.5px solid rgba(255,255,255,0.07)",
                borderRadius: 16,
                padding: 24,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#ff6b35",
                  fontWeight: 600,
                  letterSpacing: 1,
                  marginBottom: 14,
                }}
              >
                STEP {step.num}
              </div>
              <div
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: 18,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                {step.title}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "rgba(240,239,232,0.5)",
                  lineHeight: 1.6,
                }}
              >
                {step.desc}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 料金 */}
      <section
        style={{
          width: "100%",
          padding: "80px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#ff6b35",
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          料金
        </div>
        <h2
          style={{
            fontFamily: "Space Grotesk",
            fontSize: "clamp(24px, 4vw, 42px)",
            fontWeight: 700,
            textAlign: "center",
            marginBottom: 48,
          }}
        >
          シンプルな料金プラン
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            width: "100%",
            maxWidth: 1100,
            margin: "0 auto",
          }}
        >
          {[
            {
              name: "Free",
              price: "無料",
              per: "",
              desc: "まず試したい方へ",
              features: [
                "✅ 発見数: 10件/日",
                "✅ Reddit, Twitter, Connpass, Wantedly",
                "✅ AIコメント生成",
                "❌ フォーム自動送信",
              ],
              cta: "無料で始める",
              featured: false,
            },
            {
              name: "Starter",
              price: "$29",
              per: "/月",
              desc: "本格的に始めたい方へ",
              features: [
                "✅ 発見数: 100件/日",
                "✅ + note, Qiita, Yahoo知恵袋, Peatix, ProductHunt",
                "✅ AIコメント生成",
                "✅ フォーム自動送信",
              ],
              cta: "Starterを始める",
              featured: false,
            },
            {
              name: "Growth",
              price: "$99",
              per: "/月",
              desc: "一番人気 🔥",
              features: [
                "✅ 発見数: 1,000件/日",
                "✅ + LinkedIn, Googleマップ, Discord, Web全体",
                "✅ 一括フォーム送信（1,000件/日）",
                "✅ 優先サポート",
              ],
              cta: "Growthを始める",
              featured: true,
            },
          ].map((plan) => (
            <div
              key={plan.name}
              style={{
                background: plan.featured ? "rgba(255,107,53,0.05)" : "#13132a",
                border: plan.featured
                  ? "1px solid #ff6b35"
                  : "0.5px solid rgba(255,255,255,0.07)",
                borderRadius: 16,
                padding: 24,
                position: "relative",
              }}
            >
              {plan.featured && (
                <div
                  style={{
                    position: "absolute",
                    top: -12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "#ff6b35",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "4px 14px",
                    borderRadius: 20,
                    whiteSpace: "nowrap",
                  }}
                >
                  🔥 一番人気
                </div>
              )}
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(240,239,232,0.5)",
                  marginBottom: 8,
                }}
              >
                {plan.desc}
              </div>
              <div
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: 16,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {plan.name}
              </div>
              <div
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: 42,
                  fontWeight: 700,
                  marginBottom: 4,
                }}
              >
                {plan.price}
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 400,
                    color: "rgba(240,239,232,0.5)",
                  }}
                >
                  {plan.per}
                </span>
              </div>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "16px 0 24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {plan.features.map((f) => (
                  <li
                    key={f}
                    style={{
                      fontSize: 13,
                      color: "rgba(240,239,232,0.6)",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => router.push("/auth/login")}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: 10,
                  border: plan.featured
                    ? "none"
                    : "0.5px solid rgba(255,255,255,0.2)",
                  background: plan.featured ? "#ff6b35" : "transparent",
                  color: plan.featured ? "#fff" : "rgba(240,239,232,0.6)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "DM Sans",
                }}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </section>



      {/* FAQ */}
      <section
        style={{
          width: "100%",
          maxWidth: 800,
          margin: "0 auto",
          padding: "80px 24px",
        }}
      >
        <h2
          style={{
            fontFamily: "Space Grotesk",
            fontSize: 32,
            fontWeight: 700,
            textAlign: "center",
            marginBottom: 40,
          }}
        >
          よくある質問
        </h2>
        <div>
          {[
            {
              q: "誰のアカウントで投稿されますか？",
              a: "あなた自身のSNSアカウントで投稿されます。SPARKはあなたのアカウントを代理操作するツールです。SPARKのアカウントは使用しません。",
            },
            {
              q: "クレジットカードなしで試せますか？",
              a: "はい。Freeプランはカード不要で今すぐ始められます。Reddit・TwitterでAIがターゲットを発見し、コメントを生成します（1日10件まで）。",
            },
            {
              q: "自動投稿はBANされませんか？",
              a: "対策として、投稿間隔をランダムに（30〜90秒）設定し、1日の投稿数に上限を設けています。また半自動モードでは人間が内容を確認してから投稿します。各プラットフォームの利用規約はご確認ください。",
            },
            {
              q: "どのプラットフォームに対応していますか？",
              a: "Reddit・TwitterはFreeプランから利用可能。note・Qiita・ZennはStarterプラン（$29/月）から、LinkedIn・Googleマップ・Webクロール全体はGrowthプラン（$99/月）からご利用いただけます。",
            },
            {
              q: "半自動と全自動の違いは？",
              a: "半自動モードはAIがコメントを生成し、あなたが内容を確認してから投稿します。全自動モードはAIが生成から投稿まで完全に自動で実行します。最初は半自動をおすすめします。",
            },
            {
              q: "いつでもキャンセルできますか？",
              a: "はい。いつでもキャンセル可能です。請求期間終了まで引き続きご利用いただけます。",
            },
            {
              q: "どのくらいで最初のユーザーが獲得できますか？",
              a: "プロダクトやターゲット層によって異なりますが、多くの場合1〜2週間で最初の反応が得られます。AIが継続的に学習・改善するため、時間とともに精度が上がります。",
            },
            {
              q: "どう活用できますか？",
              a: "需要に合った候補者をAIが自動発見し、SNSで自然なアプローチメッセージを送ります。従来のスカウトメール・求人広告と異なり、候補者が既に発信している悩みや関心に合わせて接触するため、返信率が高くなります。",
            },
          ].map((faq, i) => (
            <div
              key={i}
              style={{
                borderBottom: "0.5px solid rgba(255,255,255,0.07)",
              }}
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "20px 0",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "DM Sans",
                  fontSize: 15,
                  fontWeight: 600,
                  color: openIndex === i ? "#ff6b35" : "#f0efe8",
                  textAlign: "left",
                  transition: "color 0.2s",
                }}
              >
                {faq.q}
                <span
                  style={{
                    fontSize: 12,
                    marginLeft: 16,
                    flexShrink: 0,
                    transition: "transform 0.2s",
                    transform: openIndex === i ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                >
                  ▼
                </span>
              </button>
              <div
                style={{
                  maxHeight: openIndex === i ? 200 : 0,
                  overflow: "hidden",
                  transition: "max-height 0.3s ease, opacity 0.3s ease",
                  opacity: openIndex === i ? 1 : 0,
                }}
              >
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.7,
                    color: "rgba(240,239,232,0.6)",
                    paddingBottom: 20,
                    margin: 0,
                  }}
                >
                  {faq.a}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section
        style={{
          width: "100%",
          padding: "80px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 700,
            margin: "0 auto",
            background: "#13132a",
            border: "0.5px solid rgba(255,255,255,0.13)",
            borderRadius: 20,
            padding: "48px 32px",
          }}
        >
          <h2
            style={{
              fontFamily: "Space Grotesk",
              fontSize: 36,
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            最初の火花を、今。
          </h2>
          <p
            style={{
              fontSize: 16,
              color: "rgba(240,239,232,0.5)",
              marginBottom: 28,
            }}
          >
            良いプロダクトが、誰にも届かずに死んでいる。
            <br />
            SPARKはその問題を終わらせる。
          </p>
          <button
            onClick={() => router.push(isLoggedIn ? "/campaigns/new" : "/auth/login")}
            style={{
              background: "#ff6b35",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "14px 36px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "DM Sans",
            }}
          >
            無料でプロダクトを分析する →
          </button>
        </div>
      </section>

      {/* フッター */}
      <footer
        style={{
          width: "100%",
          padding: "24px 48px",
          borderTop: "0.5px solid rgba(255,255,255,0.07)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "rgba(240,239,232,0.3)",
        }}
      >
        <div>⚡ SPARK</div>
        <div>© 2025 SPARK. AI Growth Engine.</div>
      </footer>
    </div>
  );
}
