import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const generateComments = inngest.createFunction(
  { id: "generate-comments", name: "Generate Comments" },
  { event: "campaign/generate" },
  async ({ event, step }: { event: { data: { campaign_id: string } }; step: any }) => {
    const campaignId = event.data.campaign_id as string;

    const campaign = await step.run("get-campaign", async () => {
      const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", campaignId).single();
      return data;
    });
    if (!campaign || campaign.status !== "running") return { message: "Not running" };

    const targets = await step.run("get-pending-targets", async () => {
      const { data } = await supabaseAdmin.from("targets").select("*").eq("campaign_id", campaignId).eq("status", "pending").limit(10);
      return data || [];
    });

    const toneMap: Record<string, string> = { casual: "カジュアル", professional: "プロフェッショナル", empathetic: "共感型" };
    const platformLimits: Record<string, string> = {
      twitter: "140字以内・リプライ形式", reddit: "200字以内・会話調", linkedin: "300字以内・丁寧",
      tiktok: "100字以内・フレンドリー", instagram: "100字以内・カジュアル", facebook: "200字以内・親しみやすい",
    };

    let generated = 0;
    for (const target of targets) {
      await step.run(`generate-${target.id}`, async () => {
        try {
          const msg = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514", max_tokens: 500,
            system: `あなたは共感力の高いGrowthハッカーです。自動コメントを生成してください。
プロダクト：${campaign.product_description}
プラットフォーム：${target.platform}（${platformLimits[target.platform] || "200字以内"}）
トーン：${toneMap[campaign.tone] || "カジュアル"}

【ルール】売り込みから始めない・投稿内容に触れる・問いかけで終わる・プロダクト名は最後に1回
JSONのみ：{"comment":"本文","approach":"理由"}`,
            messages: [{ role: "user", content: `@${target.username}: ${target.post_content}\nマッチ理由: ${target.match_reason}` }],
          });
          const tb = msg.content.find((b) => b.type === "text");
          if (!tb || tb.type !== "text") return;
          let js = tb.text.trim();
          const m = js.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (m) js = m[1].trim();
          const parsed = JSON.parse(js);

          await supabaseAdmin.from("comments").insert({
            target_id: target.id, campaign_id: campaignId, platform: target.platform,
            content: parsed.comment, approach: parsed.approach, approved: false,
          });
          await supabaseAdmin.from("targets").update({ status: "comment_generated" }).eq("id", target.id);
          generated++;
        } catch (e) { console.error("Gen error:", e); }
      });
    }

    // Auto-post if auto_mode
    if (campaign.auto_mode && generated > 0) {
      await step.sendEvent("trigger-post", { name: "campaign/post", data: { campaign_id: campaignId } });
    }

    return { generated };
  }
);
