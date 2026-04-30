import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSearchQueries(
  platforms: string[],
  keywords: string[],
  whereToFind: Record<string, string[]>
): Array<{ platform: string; query: string }> {
  const queries: Array<{ platform: string; query: string }> = [];
  for (const platform of platforms) {
    const kws = keywords.slice(0, 3);
    const platformTargets = whereToFind[platform] || [];
    const siteMap: Record<string, string> = {
      twitter: "site:twitter.com",
      reddit: "site:reddit.com",
      linkedin: "site:linkedin.com",
      tiktok: "site:tiktok.com",
      instagram: "site:instagram.com",
      facebook: "site:facebook.com/groups",
    };
    const site = siteMap[platform] || "";
    for (const kw of kws) {
      const extra = platformTargets[0] || "";
      queries.push({ platform, query: `${site} ${extra} ${kw}`.trim() });
    }
  }
  return queries.slice(0, 10);
}

async function tavilySearch(query: string): Promise<Array<{ url: string; content: string; title: string }>> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: 5,
        include_answer: false,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

async function scoreTarget(
  result: { url: string; content: string; title: string },
  platform: string,
  productDescription: string
): Promise<{ score: number; reason: string; post_url: string; post_content: string; username: string } | null> {
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: `以下のターゲットとプロダクトを比較し、JSONのみで返してください：
{
  "score": 85,
  "reason": "マッチ理由（1文・日本語）",
  "post_url": "コメント対象URL",
  "post_content": "投稿内容（100字以内）",
  "username": "ユーザー名"
}
スコアが60未満なら score: 0 を返す。`,
      messages: [{
        role: "user",
        content: `プロダクト: ${productDescription}\n\nターゲット投稿:\nURL: ${result.url}\nタイトル: ${result.title}\n内容: ${result.content.slice(0, 500)}\nプラットフォーム: ${platform}`,
      }],
    });
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    let jsonStr = textBlock.text.trim();
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed.score < 60) return null;
    return { ...parsed, post_url: parsed.post_url || result.url };
  } catch {
    return null;
  }
}

export const discoverTargets = inngest.createFunction(
  { id: "discover-targets", name: "Discover Targets" },
  { event: "campaign/discover" },
  async ({ event, step }: { event: { data: { campaign_id: string } }; step: any }) => {
    const campaignId = event.data.campaign_id as string;

    // 1. Get campaign
    const campaign = await step.run("get-campaign", async () => {
      const { data } = await supabaseAdmin
        .from("campaigns")
        .select("*")
        .eq("id", campaignId)
        .single();
      return data;
    });

    if (!campaign || campaign.status !== "running") {
      return { message: "Campaign not running" };
    }

    // 2. Check daily limit
    const todayCount = await step.run("check-daily-limit", async () => {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabaseAdmin
        .from("targets")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .gte("created_at", `${today}T00:00:00Z`);
      return count || 0;
    });

    if (todayCount >= campaign.daily_limit) {
      return { message: "Daily limit reached", count: todayCount };
    }

    const remaining = campaign.daily_limit - todayCount;
    const personas = campaign.target_personas?.personas || [];
    if (personas.length === 0) return { message: "No personas" };

    // 3. Search with Tavily
    const searchResults = await step.run("tavily-search", async () => {
      const persona = personas[0];
      const queries = buildSearchQueries(
        campaign.platforms || [],
        persona.keywords || [],
        persona.where_to_find || {}
      );
      const allResults: Array<{ platform: string; url: string; content: string; title: string }> = [];
      const searchPromises = queries.map(async (q) => {
        const results = await tavilySearch(q.query);
        return results.map((r) => ({ ...r, platform: q.platform }));
      });
      const batchResults = await Promise.all(searchPromises);
      for (const batch of batchResults) {
        allResults.push(...batch);
      }
      return allResults.slice(0, remaining);
    });

    // 4. Score each result
    const savedCount = await step.run("score-and-save", async () => {
      let saved = 0;
      for (const result of searchResults.slice(0, 10)) {
        const scored = await scoreTarget(
          result,
          result.platform,
          campaign.product_description
        );
        if (scored && scored.score >= 60) {
          await supabaseAdmin.from("targets").insert({
            campaign_id: campaignId,
            platform: result.platform,
            username: scored.username || "unknown",
            post_url: scored.post_url,
            post_content: scored.post_content,
            match_reason: scored.reason,
            match_score: scored.score,
            status: "pending",
          });
          saved++;
        }
      }
      return saved;
    });

    return { message: "Discovery complete", saved: savedCount };
  }
);
