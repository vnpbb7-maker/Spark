import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export const maxDuration = 300; // 5 minutes (Vercel Pro)

const BATCH_SIZE = 10; // max targets per API call

interface BulkResult {
  targetId: string;
  username: string;
  status: "sent" | "failed" | "gmail";
  method: "form" | "gmail" | "none";
  gmailUrl?: string;
  error?: string;
}

async function generateMessage(
  target: Record<string, unknown>,
  productDescription: string
): Promise<string> {
  const isB2B = target.platform === "google_maps";
  const promptContent = isB2B
    ? `あなたはスタートアップの代表者です。以下の企業へ送る営業メールを書いてください。

プロダクト：${productDescription}
送信先企業名：${target.username}
企業情報：${(target.post_content as string || "").slice(0, 200)}

【ルール】
・丁寧なビジネス日本語（敬語）
・自己紹介（プロダクト名）→ 役立てていただける理由 → βテスター依頼
・200〜300文字以内・本文のみ

本文のみ返してください。JSONは不要。`
    : `あなたはスタートアップのGrowthハッカーです。
以下の人物へのお問い合わせメッセージを書いてください。

プロダクト：${productDescription}
相手：${target.username} (${target.platform})
投稿内容：${(target.post_content as string || "").slice(0, 300)}

【ルール】
・自然な日本語、売り込みから始めない
・具体的な共感 → βテスター依頼
・150文字以内・本文のみ

本文のみ返してください。JSONは不要。`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: promptContent }],
      }),
      signal: AbortSignal.timeout(8000), // 8s per message, fail fast
    });
    if (res.ok) {
      const data = await res.json();
      return (data.content?.[0]?.text || "").trim();
    }
  } catch (e) {
    console.error("[bulk-submit] Claude error:", e);
  }

  const pd = productDescription.slice(0, 50);
  return `はじめまして。${pd}の開発をしているものです。βテスターとしてお試しいただけないかとご連絡しました。ご検討いただけますと幸いです。`;
}

// Attempt to send email via Gmail MCP (Claude integration)
// Falls back to returning Gmail compose URL if MCP fails or is unconfigured
async function sendViaGmailMcp(
  toEmail: string,
  subject: string,
  body: string
): Promise<{ sent: boolean; gmailUrl: string }> {
  const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(toEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const mcpUrl = process.env.GMAIL_MCP_URL || "";

  if (!mcpUrl || !process.env.ANTHROPIC_API_KEY) {
    return { sent: false, gmailUrl };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Send an email to ${toEmail} with subject "${subject}" and body: ${body}. Use the Gmail tool to send it. Reply only with {"sent": true} after sending.`,
        }],
        mcp_servers: [{
          type: "url",
          url: mcpUrl,
          name: "gmail-mcp",
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      const text = (data.content?.[0]?.text || "").toLowerCase();
      if (text.includes("sent") || text.includes("true")) {
        console.log("[bulk-submit] Gmail MCP sent email to:", toEmail);
        return { sent: true, gmailUrl };
      }
    }
  } catch (e) {
    console.error("[bulk-submit] Gmail MCP error:", e);
  }
  return { sent: false, gmailUrl };
}

import { inngest } from "@/inngest/client";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const campaignId = params.id;
  const body = await req.json().catch(() => ({}));
  const {
    senderName = "",
    senderEmail = "",
    userEmail = "",
    preview = false,
    messages = {},
  } = body;

  const targetIds: string[] = (body.targetIds || []).slice(0, BATCH_SIZE);

  if (!targetIds?.length) {
    return NextResponse.json({ error: "targetIds required" }, { status: 400 });
  }

  const supabase = getSupabase();

  // Fetch campaign for preview / daily-limit check
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("product_description, product_url, daily_limit, send_count, name, user_id")
    .eq("id", campaignId)
    .single();

  const productDescription =
    (campaign?.product_description as string) ||
    (campaign?.product_url as string) ||
    "SPARKプロダクト";

  // ── PREVIEW MODE: synchronous as before ──────────────────────────────────
  if (preview) {
    const { data: targets } = await supabase
      .from("targets")
      .select("id, username, platform, email, website, contact_url, post_content, post_url")
      .in("id", targetIds);

    if (!targets?.length) return NextResponse.json({ preview: true, previews: [] });

    const previews = await Promise.all(
      targets.map(async (target) => {
        const overrideMsg = (messages as Record<string, string>)[target.id];
        const message = overrideMsg || await generateMessage(target as Record<string, unknown>, productDescription);
        const email = target.email as string | null;
        const websiteUrl = (target.contact_url as string) || (target.website as string) || "";
        const hasEmail = email && !email.startsWith("Twitter:") && !email.startsWith("DM:");
        const method = hasEmail ? "gmail" : websiteUrl ? "form" : "none";
        return { targetId: target.id, username: target.username as string, platform: target.platform as string, message, method };
      })
    );
    return NextResponse.json({ preview: true, previews });
  }

  // ── SEND MODE: enqueue Inngest background job ─────────────────────────────
  const dailyLimit = (campaign?.daily_limit as number) || 100;
  const sendCount  = (campaign?.send_count  as number) || 0;
  const remaining  = Math.max(0, dailyLimit - sendCount);
  const toProcess  = targetIds.slice(0, remaining);

  if (toProcess.length === 0) {
    return NextResponse.json({
      error: `1日の送信上限（${dailyLimit}件）に達しています`,
      queued: false,
    });
  }

  await inngest.send({
    name: "outreach/bulk-send",
    data: {
      campaignId,
      targetIds: toProcess,
      senderName,
      senderEmail,
      userEmail: userEmail || senderEmail,
    },
  });

  // Optimistically update send_count
  if (toProcess.length > 0) {
    try {
      await supabase.from("campaigns")
        .update({ send_count: sendCount + toProcess.length })
        .eq("id", campaignId);
    } catch { /* non-critical */ }
  }

  return NextResponse.json({
    queued: true,
    count: toProcess.length,
    message: `${toProcess.length}件のバックグラウンド送信を開始しました。完了後にメールでお知らせします。`,
  });
}
