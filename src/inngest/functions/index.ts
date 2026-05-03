import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function buildSearchQuery(platform: string, keyword: string): string {
  switch (platform) {
    case "twitter":
      return `${keyword} startup founder twitter`;
    case "reddit":
      return `reddit ${keyword} startup`;
    case "linkedin":
      return `${keyword} linkedin professional`;
    case "tiktok":
      return `${keyword} tiktok`;
    case "instagram":
      return `${keyword} instagram`;
    case "facebook":
      return `${keyword} facebook group`;
    default:
      return keyword;
  }
}

function extractUsername(url: string, platform: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);

    switch (platform) {
      case "reddit":
        // /r/subreddit/comments/id/title → r/subreddit
        if (pathParts[0] === "r" && pathParts[1]) {
          return `r/${pathParts[1]}`;
        }
        // /user/username → username
        if (pathParts[0] === "user" && pathParts[1]) {
          return pathParts[1];
        }
        return pathParts[0] || "reddit";

      case "twitter":
        // /username/status/id → username
        // /search?q=... → search
        if (urlObj.pathname.includes("search")) {
          return `search:${urlObj.searchParams.get("q")?.slice(0, 20) || "query"}`;
        }
        return pathParts[0] || "twitter";

      case "linkedin":
        // /in/username → username
        if (pathParts[0] === "in" && pathParts[1]) {
          return pathParts[1];
        }
        return pathParts[0] || "linkedin";

      default:
        return pathParts[0] || platform;
    }
  } catch {
    return platform;
  }
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
    const insertedTargets: string[] = [];
    console.log("Personas count:", personas.length);
    console.log("Platforms:", platforms);

    for (const persona of personas.slice(0, 1)) {
      for (const platform of platforms.slice(0, 2)) {
        const keywords = persona.where_to_find?.[platform] || [];

        for (const keyword of keywords.slice(0, 2)) {
          try {
            const query = buildSearchQuery(platform, keyword);
            console.log("Tavily query:", query);
            console.log("TAVILY_API_KEY exists:", !!process.env.TAVILY_API_KEY);
            console.log("TAVILY_API_KEY prefix:", process.env.TAVILY_API_KEY?.slice(0, 8));

            const tavilyResponse = await fetch(
              "https://api.tavily.com/search",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${process.env.TAVILY_API_KEY}`,
                },
                body: JSON.stringify({
                  query: query,
                  max_results: 5,
                  search_depth: "basic",
                }),
              }
            );

            console.log("Tavily status:", tavilyResponse.status);
            const tavilyText = await tavilyResponse.text();
            console.log("Tavily raw response:", tavilyText.slice(0, 500));

            const tavilyData = JSON.parse(tavilyText);
            const results = tavilyData.results || [];
            console.log("Tavily results count:", results.length);

            for (const result of results) {
              // URLからユーザー名を抽出
              const url = result.url || "";
              const username = extractUsername(url, platform);

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
                  insertedTargets.push(username);
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

    // コメント生成を発火
    try {
      await inngest.send({
        name: "campaign/generate",
        data: { campaign_id: campaignId },
      });
      console.log("Triggered generate-comments for campaign:", campaignId);
    } catch (e) {
      console.error("Failed to fire generate:", e);
    }

    return { success: true, campaignId, targetsFound: insertedTargets.length };
  }
);

export const generateComments = inngest.createFunction(
  { id: "generate-comments", triggers: [{ event: "campaign/generate" }] },
  async ({ event }: any) => {
    const campaignId = event.data.campaign_id as string;
    console.log("Starting comment generation for campaign:", campaignId);

    const supabase = getSupabase();

    // pending状態のtargetsを取得（最大10件）
    const { data: targets } = await supabase
      .from("targets")
      .select("*, campaigns(*)")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .limit(10);

    if (!targets || targets.length === 0) {
      return { success: true, message: "No pending targets" };
    }

    console.log("Generating comments for", targets.length, "targets");

    for (const target of targets) {
      try {
        const campaign = target.campaigns;

        // Claude APIでコメント生成
        const response = await fetch(
          "https://api.anthropic.com/v1/messages",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY!,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 300,
              messages: [
                {
                  role: "user",
                  content: `あなたは共感力の高いGrowthハッカーです。
以下の情報を元に自然なコメントを生成してください。

プロダクト：${campaign?.product_description || campaign?.product_url}
対象投稿URL：${target.post_url}
投稿内容：${target.post_content?.slice(0, 300) || ""}
プラットフォーム：${target.platform}
トーン：casual

【ルール】
・売り込みから始めない
・対象投稿の内容に触れる
・自然な会話調
・最後は問いかけで終わる
・100文字以内

JSONのみ返してください：
{"comment": "コメント本文", "approach": "このアプローチにした理由1文"}`,
                },
              ],
            }),
          }
        );

        const data = await response.json();
        const text = data.content?.[0]?.text || "{}";

        let commentData = { comment: "", approach: "" };
        try {
          commentData = JSON.parse(text);
        } catch {
          commentData = { comment: text.slice(0, 200), approach: "自動生成" };
        }

        if (commentData.comment) {
          // commentsテーブルに保存
          await supabase.from("comments").insert({
            target_id: target.id,
            campaign_id: campaignId,
            platform: target.platform,
            content: commentData.comment,
            approach: commentData.approach,
            approved: false,
          });

          // targetのstatusを更新
          await supabase
            .from("targets")
            .update({ status: "contacted" })
            .eq("id", target.id);

          console.log("Comment generated for:", target.username);
        }
      } catch (err) {
        console.error("Comment generation error:", err);
      }
    }

    return { success: true, campaignId };
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
