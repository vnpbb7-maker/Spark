"use client";

import { useEffect, useState } from "react";
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

  const addLog = (entry: LogEntry) => {
    setLogs((prev) => [entry, ...prev].slice(0, 20));
  };

  useEffect(() => {
    const supabase = createClient();
    const filter = campaignId ? `campaign_id=eq.${campaignId}` : undefined;

    const channel = supabase
      .channel(`campaign-${campaignId || "all"}`)
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
              icon: "✍",
              text: `コメント生成中: ${c.platform}`,
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
          table: "comments",
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          const newC = payload.new as Record<string, string | boolean | null>;
          const oldC = payload.old as Record<string, string | boolean | null>;
          if (newC.approved && !oldC.approved) {
            addLog(
              makeLogEntry({
                icon: "✅",
                text: `承認済み: コメント #${(newC.id as string).slice(0, 8)}`,
                color: "#7c5cfc",
                type: "approve",
              })
            );
          }
          if (newC.posted_at && !oldC.posted_at) {
            addLog(
              makeLogEntry({
                icon: "📤",
                text: `投稿完了: ${newC.platform}`,
                color: "#2dd17a",
                type: "post",
              })
            );
          }
          if (newC.responded_at && !oldC.responded_at) {
            addLog(
              makeLogEntry({
                icon: "💬",
                text: `返信あり: ${newC.platform}`,
                color: "#ff6b35",
                type: "reply",
              })
            );
          }
        }
      )
      .subscribe((status) => {
        console.log("Realtime status:", status);
        if (status === "CHANNEL_ERROR") {
          console.error("Realtime channel error - check Supabase Realtime settings");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  return logs;
}
