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
    const isPRTimes = target.platform === "prtimes";
    const isFormBusiness = target.platform === "wantedly" || isPRTimes;
    // モーダル入力値を優先（DBのキャンペーン値より上書き）
    const productLine = productUrl || campaign?.product_description || campaign?.product_url || "プロダクト";
    const companyName = target.username || "御社";
    const effectiveProductUrl = productUrl || campaign?.product_url || "";

    // クリック追跡が有効な場合、トラッキングURLを生成（メール送信用のみ — プロンプトには渡さない）
    const useTracking = bodyEnableTracking || (campaign?.enable_tracking === true);
    const resolvedCampaignId = bodyCampaignId || (campaign?.id as string) || null;
    const trackedUrl = useTracking && resolvedCampaignId && target.id
      ? `https://spark-ai.jp/api/track/${resolvedCampaignId}/${target.id}`
      : null;
    console.log(`[generate-comment] useTracking=${useTracking} trackedUrl=${trackedUrl?.slice(0, 60) ?? "none"}`);

    // Claudeプロンプトには絶対にトラッキングURLを渡さない
    // 表示用URLは常にドメインのみ（spark-ai.jp）
    const displayProductUrl = "spark-ai.jp";

    // ドメイン表記でURLを含めるよう指示（https://形式・トラッキングURLは禁止）
    const urlInstruction = `\n※本文中に「spark-ai.jp」というドメイン名を自然な形で1回含めること。例：「spark-ai.jp でご確認いただけます」「spark-ai.jp をぜひご覧ください」\n※「https://」から始まる形式では書かないこと。`;

    // ── プレーンテキスト直接出力（JSON prefill廃止）──
    const promptContent = isPRTimes
      ? `あなたはビジネスメールのプロです。
以下の情報を元に、企業お問い合わせフォームへのメッセージを生成してください。

送信者: ${senderName}
自社サービス: ${productLine}
${keywords ? `【必ず含める訴求ポイント】${keywords}` : ""}
送信先企業: ${companyName}
プレスリリース内容: ${(target.post_content as string || "").slice(0, 200)}

【厳守ルール】
・書き出しは「${senderName}と申します。」で始める
・相手のプレスリリース内容（新サービス・新規事業）に1文触れる
・自社サービスの訴求ポイント（上記【必ず含める訴求ポイント】）を自然な形で必ず1文に盛り込む
・締めは「ご検討いただけますと幸いです。」または同等の丁寧な結び
・全体150〜200字（フォームの文字数制限を考慮）
・件名は不要、本文のみ
・売り込み色を抑えた提案型
・敬語・ビジネスメール文体
・送信者名「${senderName}」は必ずそのままの文字で使用すること
${effectiveProductUrl ? `・本文末尾付近に「詳しくは ${effectiveProductUrl} をご覧ください」を自然な形で含めること` : ""}

メッセージ本文のみ返してください。`
      : isB2B || isFormBusiness
      ? `あなたは優秀な日本語ビジネスメールライターです。
以下の情報をもとに、自然なビジネスメールを生成してください。

【送信先企業】${companyName}
【送信者名】${senderName}
【自社サービス・プロダクト説明】${productLine}
${keywords ? `【訴求ポイント（必ず盛り込むこと）】${keywords}` : ""}

## 厳守ルール
- 送信者名「${senderName}」は必ずそのままの文字で使用すること。絶対に翻訳・英訳・変換しないこと
- 上記【訴求ポイント】は意訳・言い換えOKだが、必ずメッセージの中核として盛り込むこと
- 数字＋名詞の組み合わせ（100名・50件等）は「多くの」「初期ユーザー」等に言い換える
- カタカナ列挙は禁止。文脈に合わせた日本語で表現する
- 必ず以下の構成と改行で書く（段落間は必ず1行空ける）：

${companyName} ご担当者様

はじめまして、${senderName}と申します。

（プロダクト説明＋訴求ポイントを盛り込んだ2〜3文：送信先業種に合わせてカスタマイズ）

（βテスター募集の依頼1〜2文）

${effectiveProductUrl ? `詳しくは ${effectiveProductUrl} をご覧ください。\n\n` : ""}ご検討のほど、よろしくお願いいたします。

- テンプレート感を出さない
- 丁寧で簡潔なビジネス文体
- 全体300字以内。長くなる場合は説明を省いて簡潔にする

【絶対禁止：URL記載ルール】
- https://spark-ai.jp/api/track/ を含むURLを文中に一切書かない
- https://... の形でURLをそのまま文中に貼り付けない（effectiveProductUrlを除く）

件名不要。メール本文のみを出力してください。JSONや説明文は不要です。`
      : `あなたは共感力の高いGrowthハッカーです。
以下の情報を元に自然なコメントを生成してください。

プロダクト：${productLine}
${effectiveProductUrl ? `プロダクトURL：${effectiveProductUrl}` : ""}
${keywords ? `【必ず盛り込む訴求ポイント】${keywords}\n上記の訴求ポイントをコメントの核として自然に組み込むこと。` : ""}
対象投稿URL：${target.post_url}
投稿内容：${target.post_content?.slice(0, 300) || ""}
プラットフォーム：${target.platform}

【ルール】
・${languageInstruction}
・送信者名「${senderName}」は必ずそのままの文字で使用すること。絶対に翻訳・英訳・変換しないこと
・「${senderName}と申します」と自然に名乗る
・売り込みから始めない
・対象投稿の内容に具体的に触れる
・自然な会話調で書く
・最後は問いかけで終わる
・150文字以内
・プロダクトと訴求ポイントについて最後に1文だけ自然に触れる
・数字＋名詞（100名・50件等）は「多くの」「初期ユーザー」等に意訳する
${effectiveProductUrl ? `・「詳しくは ${effectiveProductUrl} をご覧ください」を自然な形でコメント末尾に含める` : ""}

【絶対禁止：URL記載ルール】
- https://spark-ai.jp/api/track/ を含むURLを文中に一切書かない

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
