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
    const bodyEnableTracking = body.enable_tracking === true || body.enableTracking === true;
    const bodyCampaignId = (body.campaign_id as string) || null;
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
    } else {
      // force=true: 既存コメントを削除してから新規生成（上書き保証）
      const { error: delErr } = await supabase
        .from("comments")
        .delete()
        .eq("target_id", targetId);
      if (delErr) console.error("[generate-comment] Delete existing comment error:", delErr);
    }

    const languageInstruction =
      campaign?.target_language === "ja" ? "日本語で書く"
        : campaign?.target_language === "en" ? "英語で書く"
          : "投稿と同じ言語で書く";

    const isB2B = target.platform === "google_maps";
    const productLine = campaign?.product_description || campaign?.product_url || productUrl || "プロダクト";
    const companyName = target.username || "御社";
    const effectiveProductUrl = productUrl || campaign?.product_url || "";

    // クリック追跡が有効な場合、トラッキングURLを生成
    // bodyから渡されたenableTracking優先、なければcampaign DB値を使用
    const useTracking = bodyEnableTracking || (campaign?.enable_tracking === true);
    const resolvedCampaignId = bodyCampaignId || (campaign?.id as string) || null;
    const baseProductUrl = effectiveProductUrl;
    const trackedUrl = useTracking && resolvedCampaignId && target.id
      ? `https://spark-ai.jp/api/track/${resolvedCampaignId}/${target.id}`
      : baseProductUrl;
    const displayProductUrl = trackedUrl || baseProductUrl;
    console.log(`[generate-comment] useTracking=${useTracking} trackedUrl=${trackedUrl?.slice(0, 60)}...`);

    // URLを本文に必ず含めるよう指示（追跡URLまたはproductUrl）
    const urlForInstruction = displayProductUrl || productUrl || "";
    const urlInstruction = urlForInstruction
      ? `\n※必ず本文中に「${urlForInstruction}」というURLを自然な形で1回含めること。例：「詳細は ${urlForInstruction} をご覧ください」`
      : "";

    // ── プレーンテキスト直接出力（JSON prefill廃止）──
    const promptContent = isB2B
      ? `あなたは優秀な日本語ビジネスメールライターです。
以下の情報をもとに、自然なビジネスメールを生成してください。

【送信先企業】${companyName}
【送信者名】${senderName}
【プロダクト】Spark AI（${displayProductUrl}）
【プロダクトの特徴・参考キーワード】${keywords || productLine}

## 厳守ルール
- 送信者名「${senderName}」は必ずそのままの文字で使用すること。絶対に翻訳・英訳・変換しないこと（例：「木」を"wood"にしない）
- キーワードは参考情報のみ。文中にそのまま使用しないこと
- 「100名」「テストユーザー」「広告リスト」「自動サーチ」「AI」などの単語はそのまま書かない
- 数字＋名詞の組み合わせ（例：100名・50件）も禁止。「多くの」「初期ユーザー」などに言い換える
- カタカナ列挙（例：「Saas・AI・自動化」）は禁止。文脈に合わせた日本語で説明する
- 「100名」「リスト」などの単語は意味を汲んで「初期ユーザー獲得」「顧客開拓」などに変換
- 必ず以下の構成と改行で書く（段落間は必ず1行空ける）：

${companyName} ご担当者様

はじめまして、${senderName}と申します。

（プロダクト説明2〜3文：送信先業種に合わせてカスタマイズ）

（βテスター募集の依頼1〜2文）

ご検討のほど、よろしくお願いいたします。

- テンプレート感を出さない
- 丁寧で簡潔なビジネス文体
- 全体300字以内。長くなる場合は説明を省いて簡潔にする
- 1文が長い場合は2文に分ける
${urlInstruction}

【重要：キーワードの扱い】
- keywordsはあくまで参考情報。絶対にそのまま文中に貼り付けないこと
- URLの後ろにカッコ書きで入れることも厳禁（例：「https://... （100名のテストユーザー　広告リスト）」は禁止）
- キーワードの意味・価値を自然な日本語に意訳して使うこと
  例：「100名のテストユーザー」→「初期ユーザーとともに改善中」
  例：「広告リスト」→「見込み顧客の発掘」
  例：「自動サーチAI」→「AIによる顧客探索」

件名不要。メール本文のみを出力してください。JSONや説明文は不要です。`
      : `あなたは共感力の高いGrowthハッカーです。
以下の情報を元に自然なコメントを生成してください。

プロダクト：${productLine}
プロダクトURL：${displayProductUrl || campaign?.product_url || ""}
${keywords ? `訴求ポイント（参考のみ・そのまま使用禁止）：${keywords}` : ""}
対象投稿URL：${target.post_url}
投稿内容：${target.post_content?.slice(0, 300) || ""}
プラットフォーム：${target.platform}

【ルール】
・${languageInstruction}
・送信者名「${senderName}」は必ずそのままの文字で使用すること。絶対に翻訳・英訳・変換しないこと（例：「木」を"wood"にしない）
・「${senderName}と申します」と自然に名乗る
・売り込みから始めない
・対象投稿の内容に具体的に触れる
・自然な会話調で書く
・最後は問いかけで終わる
・150文字以内
・プロダクトについて最後に1文だけ自然に触れる
・訴求ポイントのキーワードはそのまま使わない。「100名」「広告リスト」「自動サーチ」などの語句は禁止
・URLの後ろにカッコ書きでキーワードを列挙しないこと（例：「https://... （100名　広告リスト）」は絶対禁止）
・キーワードは意味を汲み取って自然な表現に意訳すること
  例：「100名のテストユーザー」→「初期ユーザーとともに改善中」
  例：「広告リスト」→「見込み顧客の発掘」
${urlInstruction}

JSONではなく、コメント本文のみを直接出力してください。余計な記号・引用符・括弧は不要です。`;

    // 529 Overloaded 対応: 指数バックオフリトライ
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          messages: [
            { role: "user", content: promptContent },
          ],
        }),
      });
      if (response.status === 529 || response.status === 429) {
        const waitMs = 2000 * Math.pow(2, attempt);
        console.warn(`[generate-comment] ただいまAIが混雑しています。自動で再試行中... (${attempt + 1}/3) — ${waitMs / 1000}秒後`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, waitMs)); continue; }
        return NextResponse.json({ error: "ただいまAIが混雑しています。しばらくしてから再度お試しください。" }, { status: 503 });
      }
      break; // 成功または別エラー
    }

    const data = await response!.json();
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
