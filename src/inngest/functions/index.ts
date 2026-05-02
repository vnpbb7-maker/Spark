import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const discoverTargets = inngest.createFunction(
  { id: "discover-targets", triggers: [{ event: "campaign/discover" }] },
  async ({ event }: any) => {
    const campaignId = event.data.campaign_id as string;
    console.log("Starting discover for campaign:", campaignId);

    // 1. キャンペーン取得
    const { data: campaign } = await getSupabase()
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();

    if (!campaign) return { error: "Campaign not found" };

    // 2. 本日の接触数確認
    const today = new Date().toISOString().split("T")[0];
    const { count } = await getSupabase()
      .from("targets")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .gte("created_at", today);

    if (count && count >= campaign.daily_limit) {
      return { error: "Daily limit reached" };
    }

    // 3. Tavily APIでターゲット発見
    const personas = campaign.target_personas?.personas || [];
    const platforms = campaign.platforms || [];
    console.log("Personas count:", personas.length);
    console.log("Platforms:", platforms);

    for (const persona of personas.slice(0, 1)) {
      for (const platform of platforms.slice(0, 2)) {
        const keywords = persona.where_to_find?.[platform] || [];

        for (const keyword of keywords.slice(0, 2)) {
          try {
            console.log("Calling Tavily for keyword:", keyword, "platform:", platform);
            const tavilyResponse = await fetch(
              "https://api.tavily.com/search",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  api_key: process.env.TAVILY_API_KEY,
                  query: `site:${platform === "twitter" ? "twitter.com" : platform === "reddit" ? "reddit.com" : platform + ".com"} ${keyword}`,
                  max_results: 3,
                }),
              }
            );

            const tavilyData = await tavilyResponse.json();
            const results = tavilyData.results || [];
            console.log("Tavily results:", results.length);

            for (const result of results) {
              // URLからユーザー名を抽出
              const url = result.url || "";
              const username = url.split("/")[3] || "unknown";

              if (username && username !== "unknown") {
                // マッチスコアをClaudeで算出
                const anthropicResponse = await fetch(
                  "https://api.anthropic.com/v1/messages",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-api-key": process.env.ANTHROPIC_API_KEY!,
                      "anthropic-version": "2023-06-01",
                    },
                    body: JSON.stringify({
                      model: "claude-sonnet-4-20250514",
                      max_tokens: 200,
                      messages: [
                        {
                          role: "user",
                          content: `以下のターゲットとプロダクトを比較し、JSONのみで返してください：
プロダクト：${campaign.product_description || campaign.product_url}
ターゲットURL：${url}
コンテンツ：${result.content?.slice(0, 200) || ""}
{"score": 0-100の数値, "reason": "マッチ理由1文"}`,
                        },
                      ],
                    }),
                  }
                );

                const anthropicData = await anthropicResponse.json();
                const text =
                  anthropicData.content?.[0]?.text ||
                  '{"score":50,"reason":"分析中"}';

                let matchData = { score: 50, reason: "分析中" };
                try {
                  matchData = JSON.parse(text);
                } catch {}
                console.log("Match score:", matchData.score, "for:", username);

                if (matchData.score >= 50) {
                  await getSupabase().from("targets").insert({
                    campaign_id: campaignId,
                    platform,
                    username,
                    profile_url: url,
                    post_url: url,
                    post_content: result.content?.slice(0, 500) || "",
                    match_score: matchData.score,
                    match_reason: matchData.reason,
                    status: "pending",
                  });
                  console.log("Inserted target:", username);
                }
              }
            }
          } catch (err) {
            console.error("Discovery error:", err);
          }
        }
      }
    }

    return { success: true, campaignId };
  }
);

export const generateComments = inngest.createFunction(
  { id: "generate-comments", triggers: [{ event: "campaign/generate" }] },
  async ({ event }: any) => {
    return { success: true };
  }
);

export const postComments = inngest.createFunction(
  { id: "post-comments", triggers: [{ event: "campaign/post" }] },
  async ({ event }: any) => {
    return { success: true };
  }
);

export const monitorReplies = inngest.createFunction(
  { id: "monitor-replies", triggers: [{ event: "campaign/monitor" }] },
  async ({ event }: any) => {
    return { success: true };
  }
);
