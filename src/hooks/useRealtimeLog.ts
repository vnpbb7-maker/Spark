"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export type LogEntry = {
  id: string;
  icon: string;
  text: string;
  color: string;
  timestamp: string;
  type: string;
};

let logIdCounter = 0;

function makeLogEntry(data: {
  icon: string;
  text: string;
  color: string;
  type: string;
}): LogEntry {
  return {
    ...data,
    id: `log-${++logIdCounter}-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

export function useRealtimeLog(campaignId?: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsRef = useRef<LogEntry[]>([]);

  const addLog = useCallback((entry: LogEntry) => {
    // Deduplicate by text
    if (logsRef.current.some((l) => l.text === entry.text)) return;
    const updated = [entry, ...logsRef.current].slice(0, 20);
    logsRef.current = updated;
    setLogs(updated);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const filter = campaignId ? `campaign_id=eq.${campaignId}` : undefined;

    const channel = supabase
      .channel(`campaign-${campaignId || "all"}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "targets",
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          const t = payload.new as Record<string, string | number>;
          addLog(
            makeLogEntry({
              icon: "🔍",
              text: `${t.platform}で発見: @${t.username} (マッチ度${t.match_score}%)`,
              color: "#ff6b35",
              type: "find",
            })
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comments",
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          const c = payload.new as Record<string, string | boolean | null>;
          addLog(
            makeLogEntry({
              icon: "✍️",
              text: `コメント生成: ${c.platform}`,
              color: "#ffd60a",
              type: "generate",
            })
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "targets",
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          const t = payload.new as Record<string, string | number | null>;
          if (t.priority && !payload.old?.priority) {
            addLog(
              makeLogEntry({
                icon: "🧠",
                text: `AI分析完了: @${t.username} → ${t.priority}ランク (${t.match_score}%)`,
                color: "#7c5cfc",
                type: "score",
              })
            );
          }
        }
      )
      .subscribe((status) => {
        console.log("[Realtime] status:", status, "campaign:", campaignId || "all");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId, addLog]);

  return logs;
}
