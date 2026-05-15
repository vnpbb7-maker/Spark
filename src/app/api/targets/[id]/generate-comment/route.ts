import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: targetId } = await params;
    const body = await request.json().catch(() => ({}));
    const senderName = (body.sender_name as string) || "担当者";
    const productUrl = (body.product_url as string) || "";
    const keywords = (body.keywords as string) || "";
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    // Fetch target with campaign
    const { data: target } = await supabase
      .from("targets")
      .select("*, campaigns(*)")
      .eq("id", targetId)
      .single();

    if (!target) return NextResponse.json({ error: "ターゲットが見つかりません" }, { status: 404 });

    const campaign = target.campaigns;

    // Check if comment already exists
    const { data: existing } = await supabase
      .from("comments")
      .select("id, content, approach")
      .eq("target_id", targetId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ comment: existing });
    }

    const requiredKeywords = campaign?.required_keywords || "";
    const keywordInstruction = requiredKeywords
      ? `\n・必ず以下のキーワードを自然に含める：${requiredKeywords}`
      : "";

    const languageInstruction =
      campaign?.target_language === "ja" ? "日本語で書く"
        : campaign?.target_language === "en" ? "英語で書く"
          : "投稿と同じ言語で書く";

    // B2B business email for google_maps targets
    const isB2B = target.platform === "google_maps";
    const productLine = campaign?.product_description || campaign?.product_url || productUrl || "プロダクト";
    const kwLine = keywords ? `キーワード・訴求ポイント：${keywords}` : "";
    const promptContent = isB2B
      ? `以下の情報を元に、ビジネスメール形式の日本語アウトリーチメッセージを生成してください。

送信先企業: ${target.username}
送信者名: ${senderName}
プロダクト: ${productLine}
プロダクトURL: ${productUrl || campaign?.product_url || ""}
${kwLine}

メール形式（必ずこの構成）:
1行目: ${target.username} ご担当者様
2行目: 空行
3行目: はじめまして、${senderName}と申します。
4行目〜: プロダクトの説明（2〜3文、キーワードを自然に含める）
次の段落: βテスターとしてご協力いただける企業様を探しております。
締め: ご検討のほど、よろしくお願いいたします。

文字数: 200〜280字。テンプレート感を出さず自然な文体で。
企業情報: ${target.post_content?.slice(0, 200) || ""}${keywordInstruction}

JSONのみ返してください：
{"comment": "メール本文", "approach": "このアプローチにした理由1文"}`
      : `あなたは共感力の高いGrowthハッカーです。
以下の情報を元に自然なコメントを生成してください。

プロダクト：${productLine}
プロダクトURL：${productUrl || campaign?.product_url || ""}
${kwLine}
対象投稿URL：${target.post_url}
投稿内容：${target.post_content?.slice(0, 300) || ""}
プラットフォーム：${target.platform}

【ルール】
・${languageInstruction}
・「${senderName}と申します」と自然に名乗る
・売り込みから始めない
・対象投稿の内容に具体的に触れる
・自然な会話調で書く
・最後は問いかけで終わる
・150文字以内${keywordInstruction}
・プロダクトについて最後に1文だけ自然に触れる

JSONのみ返してください：
{"comment": "コメント本文", "approach": "このアプローチにした理由1文"}`;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [
          { role: "user", content: promptContent },
          { role: "assistant", content: "{" },
        ],
      }),
    });

    const data = await response.json();
    const text = "{" + (data.content?.[0]?.text || "");

    let commentData = { comment: "", approach: "" };
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) commentData = JSON.parse(jsonMatch[0]);
      else commentData = { comment: text.slice(0, 200), approach: "自動生成" };
    } catch {
      commentData = { comment: text.slice(0, 200), approach: "自動生成" };
    }

    let finalContent = typeof commentData.comment === "string"
      ? commentData.comment
      : JSON.stringify(commentData.comment);

    // Strip nested JSON
    if (/^\s*\{[\s\S]*\}\s*$/.test(finalContent)) {
      try { const p = JSON.parse(finalContent); finalContent = p.comment || finalContent; } catch {}
    }

    if (!finalContent) {
      return NextResponse.json({ error: "コメント生成に失敗しました" }, { status: 500 });
    }

    // Save to comments table
    const { data: saved, error } = await supabase.from("comments").insert({
      target_id: targetId,
      campaign_id: target.campaign_id,
      platform: target.platform,
      content: finalContent,
      approach: commentData.approach || "",
      approved: false,
    }).select().single();

    if (error) {
      console.error("Comment save error:", error);
      return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ comment: saved });
  } catch (error) {
    console.error("Generate comment error:", error);
    return NextResponse.json({ error: "エラーが発生しました" }, { status: 500 });
  }
}
