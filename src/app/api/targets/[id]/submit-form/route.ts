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
  const { sender_name, sender_email, preview_only, override_message } = await req.json().catch(() => ({}));

  const supabase = getSupabase();

  // 1. ターゲット情報を取得
  const { data: target, error: targetErr } = await supabase
    .from("targets")
    .select("*, campaigns(*)")
    .eq("id", targetId)
    .single();

  if (!target || targetErr) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }

  const campaign = target.campaigns as Record<string, unknown>;
  const websiteUrl: string =
    (target.contact_url as string) ||
    (target.website as string) ||
    "";

  if (!websiteUrl || !websiteUrl.startsWith("http")) {
    return NextResponse.json(
      { error: "このターゲットにはウェブサイトURLがありません" },
      { status: 400 }
    );
  }

  // 送信者情報のフォールバック
  const finalSenderName = sender_name || "SPARK";
  const finalSenderEmail = sender_email || "";

  if (!finalSenderEmail) {
    return NextResponse.json(
      { error: "送信者メールアドレスが必要です（設定ページで登録してください）" },
      { status: 400 }
    );
  }

  // 2. Claude でパーソナライズされたメッセージを生成
  let message = "";
  try {
    const productDescription =
      (campaign.product_description as string) || "";
    const postContent = (target.post_content as string) || "";
    const username = (target.username as string) || "";

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system:
          "あなたはスタートアップの創業者です。自然で押しつけがましくない日本語のお問い合わせメッセージを書いてください。",
        messages: [
          {
            role: "user",
            content: `以下の情報を使って、ウェブサイトのお問い合わせフォームに送るメッセージを200文字以内で書いてください。

プロダクト概要: ${productDescription.substring(0, 200)}
相手の名前/サイト: ${username}
相手の投稿/コンテンツ: ${postContent.substring(0, 300)}

ルール:
- 押しつけがましくない自然な日本語
- βテスターや初期ユーザーとして試してほしいことを伝える
- 200文字以内
- 本文のみ（件名や挨拶は不要）

メッセージのみ返してください。`,
          },
        ],
      }),
    });

    if (claudeRes.ok) {
      const data = await claudeRes.json();
      message = (data.content?.[0]?.text || "").trim();
      console.log("[submit-form] Claude message:", message.slice(0, 80));
    }
  } catch (e) {
    console.error("[submit-form] Claude error:", e);
  }

  // Claude が失敗した場合のフォールバック
  if (!message) {
    const productDescription =
      (campaign.product_description as string) || "新しいプロダクト";
    message = `はじめまして。${productDescription.substring(0, 50)}の開発をしているものです。βテスターとしてご協力いただける方を探しており、ぜひ一度試していただければ幸いです。`;
  }

  // If caller provided an override message (user edited in modal), use it
  if (override_message) message = override_message;

  // preview_only: return message without submitting
  if (preview_only) {
    return NextResponse.json({ generatedMessage: message, preview: true });
  }

  // 3. Railway Playwright サーバーにフォーム送信を依頼
  const playwrightUrl = process.env.PLAYWRIGHT_SERVER_URL;
  const playwrightKey = process.env.PLAYWRIGHT_API_KEY;

  if (!playwrightUrl) {
    return NextResponse.json(
      {
        success: false,
        queued: true,
        message: "Playwrightサーバーが未設定です。PLAYWRIGHT_SERVER_URLを設定してください。",
        generatedMessage: message,
      },
      { status: 200 }
    );
  }

  try {
    const formRes = await fetch(`${playwrightUrl}/submit-contact-form`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": playwrightKey || "",
      },
      body: JSON.stringify({
        target_id: targetId,
        website_url: websiteUrl,
        message,
        sender_name: finalSenderName,
        sender_email: finalSenderEmail,
      }),
      signal: AbortSignal.timeout(55000),
    });

    const result = await formRes.json();
    console.log("[submit-form] Railway result:", result);

    // 4. Supabase のターゲットを更新
    if (result.success || result.submitted) {
      await supabase
        .from("targets")
        .update({
          contacted_at: new Date().toISOString(),
          status: "contacted",
        })
        .eq("id", targetId);
    }

    return NextResponse.json({ ...result, generatedMessage: message });
  } catch (err) {
    console.error("[submit-form] Playwright server error:", err);
    return NextResponse.json(
      { success: false, error: "Playwrightサーバーへの接続に失敗しました", generatedMessage: message },
      { status: 500 }
    );
  }
}
