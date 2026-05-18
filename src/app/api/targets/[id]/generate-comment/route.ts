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

    const forceRegenerate = body.force === true;

    // Check if comment already exists (skip if force=true)
    if (!forceRegenerate) {
      const { data: existing } = await supabase
        .from("comments")
        .select("id, content, approach")
        .eq("target_id", targetId)
        .limit(1)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ comment: existing, generatedMessage: existing.content });
      }
    }

    const languageInstruction =
      campaign?.target_language === "ja" ? "日本語で書く"
        : campaign?.target_language === "en" ? "英語で書く"
          : "投稿と同じ言語で書く";

    const isB2B = target.platform === "google_maps";
    const productLine = campaign?.product_description || campaign?.product_url || productUrl || "プロダクト";
    const companyName = target.username || "御社";
    const effectiveProductUrl = productUrl || campaign?.product_url || "";

    // ── プレーンテキスト直接出力（JSON prefill廃止）──
    const promptContent = isB2B
      ? `あなたは優秀な日本語ビジネスメールライターです。
以下の情報をもとに、300〜400字の自然なビジネスメールを生成してください。

【送信先企業】${companyName}
【送信者名】${senderName}
【プロダクト】Spark AI（${effectiveProductUrl}）
【プロダクトの特徴・参考キーワード】${keywords || productLine}

## 厳守ルール
- キーワードはそのまま使わず、文脈に合わせて自然に言い換える
- 「100名」「リスト」などの単語は意味を汲んで「初期ユーザー獲得」「顧客リスト構築」などに変換
- 以下の構成で書く：
  1行目: ${companyName} ご担当者様
  （空行）
  はじめまして、${senderName}と申します。
  （プロダクト説明2〜3文：送信先業種に合わせてカスタマイズ）
  （βテスター募集の依頼1〜2文）
  ご検討のほど、よろしくお願いいたします。
- 件名不要、本文のみ出力
- テンプレート感を出さない
- 丁寧で簡潔なビジネス文体

メール本文のみを出力してください。JSONや説明文は不要です。`
      : `あなたは共感力の高いGrowthハッカーです。
以下の情報を元に自然なコメントを生成してください。

プロダクト：${productLine}
プロダクトURL：${productUrl || campaign?.product_url || ""}
${keywords ? `訴求ポイント（自然に言い換えて使う）：${keywords}` : ""}
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
・150文字以内
・プロダクトについて最後に1文だけ自然に触れる

JSONではなく、コメント本文のみを直接出力してください。余計な記号・引用符・括弧は不要です。`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        // prefillなし — プレーンテキスト直接出力
        messages: [
          { role: "user", content: promptContent },
        ],
      }),
    });

    const data = await response.json();
    const rawText = (data.content?.[0]?.text || "").trim();
    console.log("[generate-comment] Claude raw response:", rawText.slice(0, 200));

    if (!rawText) {
      console.error("[generate-comment] Empty response from Claude. data:", JSON.stringify(data).slice(0, 300));
      return NextResponse.json({ error: "コメント生成に失敗しました" }, { status: 500 });
    }

    // ── クリーニング：JSONが混入していた場合でも本文を抽出 ──
    let finalContent = rawText;

    // JSONオブジェクト形式で返ってきた場合はcommentフィールドを抽出
    if (/^\s*\{[\s\S]*\}\s*$/.test(finalContent)) {
      try {
        const parsed = JSON.parse(finalContent);
        finalContent = parsed.comment || parsed.message || parsed.text || finalContent;
      } catch { /* JSONではないのでそのまま */ }
    }

    // 先頭末尾の { } ` など不要記号を除去
    finalContent = finalContent
      .replace(/^[\s`{}"]+/, "")
      .replace(/[\s`{}"]+$/, "")
      .trim();

    if (!finalContent) {
      return NextResponse.json({ error: "コメント生成に失敗しました" }, { status: 500 });
    }

    // Save to comments table
    const { data: saved, error } = await supabase.from("comments").insert({
      target_id: targetId,
      campaign_id: target.campaign_id,
      platform: target.platform,
      content: finalContent,
      approach: "",
      approved: false,
    }).select().single();

    if (error) {
      console.error("Comment save error:", error);
      return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ comment: saved, generatedMessage: finalContent });
  } catch (error) {
    console.error("Generate comment error:", error);
    return NextResponse.json({ error: "エラーが発生しました" }, { status: 500 });
  }
}
