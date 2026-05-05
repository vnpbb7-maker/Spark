import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const { target_id, campaign_id } = await request.json();

    // Get campaign + target
    const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", campaign_id).single();
    const { data: target } = await supabase.from("targets").select("*").eq("id", target_id).single();
    if (!campaign || !target) return NextResponse.json({ error: "データが見つかりません" }, { status: 404 });

    const toneMap: Record<string, string> = { casual: "カジュアル", professional: "プロフェッショナル", empathetic: "共感型" };
    const platformLimits: Record<string, string> = {
      twitter: "140字以内・リプライ形式", reddit: "200字以内・会話調", linkedin: "300字以内・丁寧",
      tiktok: "100字以内・フレンドリー", instagram: "100字以内・カジュアル", facebook: "200字以内・親しみやすい",
    };

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      system: `あなたは共感力の高いGrowthハッカーです。
以下の情報を元に自動コメントを生成してください。

プロダクト：${campaign.product_description}
対象投稿：${target.post_content || "不明"}
プラットフォーム：${target.platform}
トーン：${toneMap[campaign.tone] || "カジュアル"}

【プラットフォーム別制約】
${target.platform}: ${platformLimits[target.platform] || "200字以内"}

【絶対ルール】
・売り込みから始めない
・対象投稿の内容に必ず触れる
・テンプレートっぽく見えない
・最後は問いかけで終わる
・プロダクト名は最後に1回だけ自然に

JSONのみ返してください：
{
  "comment": "コメント本文",
  "approach": "このアプローチにした理由（1文）"
}`,
      messages: [{ role: "user", content: `対象: @${target.username}\n投稿内容: ${target.post_content}\nマッチ理由: ${target.match_reason}` }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No response");

    let jsonStr = textBlock.text.trim();
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
    const parsed = JSON.parse(jsonStr);

    // Save comment
    const { data: comment, error } = await supabase.from("comments").insert({
      target_id, campaign_id, platform: target.platform,
      content: parsed.comment, approach: parsed.approach, approved: false,
    }).select().single();

    if (error) throw error;

    // Update target status
    await supabase.from("targets").update({ status: "comment_generated" }).eq("id", target_id);

    return NextResponse.json({ comment });
  } catch (error) {
    console.error("Generate comment error:", error);
    return NextResponse.json({ error: "コメント生成に失敗しました" }, { status: 500 });
  }
}
