import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const targetId = params.id;
  console.log("[submit-form] START targetId:", targetId);

  const body = await req.json().catch(() => ({}));
  const { sender_name, sender_email, preview_only, override_message } = body;
  console.log("[submit-form] body keys:", Object.keys(body), "preview_only:", preview_only);

  const supabase = getSupabase();

  // 1. Fetch target (without JOIN to avoid null campaign issue)
  const { data: target, error: targetErr } = await supabase
    .from("targets")
    .select("*")
    .eq("id", targetId)
    .single();

  if (!target || targetErr) {
    console.error("[submit-form] Target not found:", targetErr?.message);
    return NextResponse.json({ error: "Target not found", detail: targetErr?.message }, { status: 404 });
  }

  // 2. Fetch campaign separately (safer than JOIN)
  const campaignId = (target.campaign_id as string) || "";
  const { data: campaignRow } = await supabase
    .from("campaigns")
    .select("product_description, product_url")
    .eq("id", campaignId)
    .single();

  const productDescription =
    (campaignRow?.product_description as string) ||
    (campaignRow?.product_url as string) ||
    "新しいプロダクト";

  const websiteUrl: string =
    (target.contact_url as string) ||
    (target.website as string) ||
    "";

  console.log("[submit-form] websiteUrl:", websiteUrl?.slice(0, 60));

  if (!websiteUrl || !websiteUrl.startsWith("http")) {
    // For preview_only with no URL, still return a message (useful for email targets)
    if (!preview_only) {
      return NextResponse.json(
        { error: "このターゲットにはウェブサイトURLがありません" },
        { status: 400 }
      );
    }
  }

  // Sender info
  const finalSenderName = sender_name || "担当者";
  const finalSenderEmail = sender_email || "";

  // preview_only doesn't need sender email
  if (!preview_only && !finalSenderEmail) {
    return NextResponse.json(
      { error: "送信者メールアドレスが必要です（設定ページで登録してください）" },
      { status: 400 }
    );
  }

  // 3. Generate message with Claude — use actual sender_name in prompt
  let generatedMessage = "";
  try {
    const postContent = (target.post_content as string) || "";
    const username = (target.username as string) || "";
    const isB2B = target.platform === "google_maps";

    const promptContent = isB2B
      ? `以下の情報を使って、企業のお問い合わせフォームまたはメールに送る営業メッセージを書いてください。

プロダクト: ${productDescription.substring(0, 200)}
送信者名: ${finalSenderName}
送信先企業: ${username}
企業情報: ${postContent.substring(0, 200)}

ルール:
- 丁寧なビジネス日本語（敬語）
- 「私は${finalSenderName}と申します」から始める
- プロダクトがこの企業のビジネスに役立てる理由を1文で説明
- βテスターとして試してほしいことを依頼
- 200〜300文字以内、本文のみ

メッセージのみ返してください。`
      : `以下の情報を使って、ウェブサイトのお問い合わせフォームに送るメッセージを書いてください。

プロダクト: ${productDescription.substring(0, 200)}
送信者名: ${finalSenderName}
相手: ${username}
相手の投稿/コンテンツ: ${postContent.substring(0, 300)}

ルール:
- 自然で親しみやすい日本語
- 「${finalSenderName}と申します」と名乗る
- 相手の活動への共感を1文入れる
- βテスターとして試してほしいことを伝える
- 150〜200文字以内、本文のみ

メッセージのみ返してください。`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
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
      signal: AbortSignal.timeout(12000),
    });

    if (claudeRes.ok) {
      const data = await claudeRes.json();
      generatedMessage = (data.content?.[0]?.text || "").trim();
      console.log("[submit-form] Claude OK, message length:", generatedMessage.length);
    } else {
      const errText = await claudeRes.text().catch(() => "");
      console.error("[submit-form] Claude error:", claudeRes.status, errText.slice(0, 100));
    }
  } catch (e) {
    console.error("[submit-form] Claude exception:", e);
  }

  // Fallback if Claude failed
  if (!generatedMessage) {
    generatedMessage = `はじめまして、${finalSenderName}と申します。${productDescription.substring(0, 50)}の開発をしており、βテスターとしてお試しいただけないかとご連絡しました。ご検討いただけますと幸いです。`;
    console.log("[submit-form] Using fallback message");
  }

  // Override with user-edited message if provided
  if (override_message) generatedMessage = override_message;

  console.log("[submit-form] preview message:", generatedMessage?.slice(0, 50));

  // preview_only: return generated message without submitting
  if (preview_only) {
    return NextResponse.json({
      success: true,
      generatedMessage,
      preview: true,
    });
  }

  // 4a. If target has email → Gmail MCP or compose URL
  const targetEmail = (target.email as string) || "";
  const hasDirectEmail = targetEmail && !targetEmail.startsWith("Twitter:") && !targetEmail.startsWith("DM:");
  if (hasDirectEmail) {
    const mcpUrl = process.env.GMAIL_MCP_URL || "";
    const subject = `【ご提案】${productDescription.slice(0, 40)}`;
    let mcpSent = false;
    if (mcpUrl && process.env.ANTHROPIC_API_KEY) {
      try {
        const mcpRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{ role: "user", content: `Send an email to ${targetEmail} with subject "${subject}" and body: ${generatedMessage}. Use the Gmail tool. Reply only {"sent": true}.` }],
            mcp_servers: [{ type: "url", url: mcpUrl, name: "gmail-mcp" }],
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (mcpRes.ok) {
          const d = await mcpRes.json();
          const txt = (d.content?.[0]?.text || "").toLowerCase();
          mcpSent = txt.includes("sent") || txt.includes("true");
        }
      } catch (e) { console.error("[submit-form] Gmail MCP error:", e); }
    }
    if (mcpSent) {
      await supabase.from("targets").update({ contacted_at: new Date().toISOString(), status: "contacted" }).eq("id", targetId);
      return NextResponse.json({ success: true, submitted: true, generatedMessage, method: "email_mcp" });
    }
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(targetEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(generatedMessage)}`;
    return NextResponse.json({ success: true, submitted: false, generatedMessage, gmailUrl, method: "gmail_compose" });
  }

  // 4b. Playwright form submission
  const playwrightUrl = process.env.PLAYWRIGHT_SERVER_URL;
  const playwrightKey = process.env.PLAYWRIGHT_API_KEY;

  if (!playwrightUrl) {
    return NextResponse.json({
      success: false,
      queued: true,
      message: "Playwrightサーバーが未設定です。",
      generatedMessage,
    });
  }

  try {
    const formRes = await fetch(`${playwrightUrl}/submit-contact-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": playwrightKey || "" },
      body: JSON.stringify({
        target_id: targetId,
        website_url: websiteUrl,
        message: generatedMessage,
        sender_name: finalSenderName,
        sender_email: finalSenderEmail,
      }),
      signal: AbortSignal.timeout(55000),
    });

    const result = await formRes.json();
    console.log("[submit-form] Railway result:", result);

    if (result.success || result.submitted) {
      await supabase.from("targets").update({ contacted_at: new Date().toISOString(), status: "contacted" }).eq("id", targetId);
    }

    return NextResponse.json({ ...result, generatedMessage });
  } catch (err) {
    console.error("[submit-form] Playwright error:", err);
    return NextResponse.json(
      { success: false, error: "Playwrightサーバーへの接続に失敗しました", generatedMessage },
      { status: 500 }
    );
  }
}
