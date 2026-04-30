"use client";

import { useEffect, useRef, useState } from "react";

interface LogEntry {
  id: number;
  icon: string;
  text: string;
  color: string;
  timestamp: string;
}

const LOG_TEMPLATES: Array<{ icon: string; text: string; color: string }> = [
  {
    icon: "🔍",
    text: "Reddit r/loneliness で発見 → u/quiet_thoughts_22 マッチ度94%",
    color: "#ff6b35",
  },
  {
    icon: "✍",
    text: 'コメントを生成中... 「本音で話せる場所を探している」投稿を参照',
    color: "#ffd60a",
  },
  {
    icon: "✅",
    text: "承認待ちキューに追加",
    color: "#7c5cfc",
  },
  {
    icon: "📤",
    text: "u/quiet_thoughts_22の投稿にコメント投稿完了",
    color: "#2dd17a",
  },
  {
    icon: "💬",
    text: "u/quiet_thoughts_22から返信が来ました",
    color: "#ff6b35",
  },
  {
    icon: "🎉",
    text: "βテスター登録完了",
    color: "#ffd60a",
  },
];

let idCounter = 0;

function getTimestamp() {
  return new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function LiveLog() {
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    // Seed with first 3 logs
    const initial: LogEntry[] = [];
    for (let i = 0; i < 3; i++) {
      const tmpl = LOG_TEMPLATES[i];
      initial.push({ id: ++idCounter, ...tmpl, timestamp: getTimestamp() });
    }
    return initial;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const templateIndexRef = useRef(3);

  useEffect(() => {
    const interval = setInterval(() => {
      const idx = templateIndexRef.current % LOG_TEMPLATES.length;
      const tmpl = LOG_TEMPLATES[idx];
      templateIndexRef.current++;

      const newEntry: LogEntry = {
        id: ++idCounter,
        ...tmpl,
        timestamp: getTimestamp(),
      };

      setLogs((prev) => {
        const next = [...prev, newEntry];
        // Keep max 10 lines — delete older ones
        return next.length > 10 ? next.slice(-10) : next;
      });
    }, 3500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <section className="relative py-24 px-6" style={{ zIndex: 1 }}>
      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="font-heading font-bold text-[clamp(1.8rem,4vw,2.8rem)] mb-4">
            AIが<span className="text-orange">今</span>、動いている
          </h2>
        </div>

        {/* Terminal window */}
        <div
          className="rounded-2xl overflow-hidden border"
          style={{
            background: "#13132a",
            borderColor: "rgba(255,255,255,0.1)",
            boxShadow:
              "0 0 80px rgba(255,107,53,0.08), 0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          {/* Terminal header bar */}
          <div
            className="flex items-center gap-2 px-5 py-3 border-b"
            style={{
              borderColor: "rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            {/* Traffic light dots */}
            <div className="flex gap-1.5">
              <div
                className="w-3 h-3 rounded-full"
                style={{ background: "#ff5f56" }}
              />
              <div
                className="w-3 h-3 rounded-full"
                style={{ background: "#ffbd2e" }}
              />
              <div
                className="w-3 h-3 rounded-full"
                style={{ background: "#27c93f" }}
              />
            </div>

            {/* Title */}
            <span
              className="text-xs ml-2 font-mono"
              style={{ color: "rgba(240,239,232,0.4)" }}
            >
              SPARK Agent · running
            </span>

            {/* Live indicator */}
            <div className="ml-auto flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  background: "#2dd17a",
                  animation: "blink-dot 1.5s ease-in-out infinite",
                }}
              />
              <span className="text-xs" style={{ color: "#2dd17a" }}>
                稼働中
              </span>
            </div>
          </div>

          {/* Log entries */}
          <div
            ref={containerRef}
            className="p-4 space-y-1 overflow-y-auto font-mono text-sm"
            style={{ height: "340px", scrollBehavior: "smooth" }}
          >
            {logs.map((log, index) => (
              <div
                key={log.id}
                className="flex items-start gap-3 rounded-lg px-3 py-2 transition-all duration-300"
                style={{
                  background:
                    index === logs.length - 1
                      ? "rgba(255,107,53,0.08)"
                      : "transparent",
                  borderLeft:
                    index === logs.length - 1
                      ? `2px solid ${log.color}`
                      : "2px solid transparent",
                  animation:
                    index === logs.length - 1 ? "slideIn 0.4s ease" : "none",
                }}
              >
                <span className="text-base leading-5 flex-shrink-0">
                  {log.icon}
                </span>
                <span
                  className="flex-1 leading-5"
                  style={{
                    color:
                      index === logs.length - 1
                        ? log.color
                        : "rgba(240,239,232,0.55)",
                  }}
                >
                  {log.text}
                </span>
                <span
                  className="text-xs leading-5 flex-shrink-0"
                  style={{ color: "rgba(240,239,232,0.2)" }}
                >
                  {log.timestamp}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes blink-dot {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.2; }
        }
      `}</style>
    </section>
  );
}
