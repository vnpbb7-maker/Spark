import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Twitter API検索
async function searchTwitterTargets(keyword: string, language: string): Promise<{ url: string; username: string; content: string }[]> {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) {
    console.log("TWITTER_BEARER_TOKEN not set, skipping Twitter search");
    return [];
  }

  const langQuery = language === "ja" ? " lang:ja" : "";
  const query = `${keyword}${langQuery} -is:retweet has:links`;

  const url = new URL("https://api.twitter.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "author_id,text,created_at,reply_settings");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });

  console.log("Twitter search status:", response.status);

  if (!response.ok) {
    const error = await response.text();
    console.log("Twitter search error:", error);
    return [];
  }

  const data = await response.json();
  const tweets = data.data || [];
  const users = data.includes?.users || [];

  // reply_settings が "everyone" のツイートのみ許可
  const replyableTweets = tweets.filter((tweet: { reply_settings?: string }) => {
    const rs = tweet.reply_settings || "everyone";
    const allowed = rs === "everyone" || rs === "mentionedUsers";
    if (!allowed) console.log("Skipping reply-restricted tweet:", tweet.reply_settings);
    return allowed;
  });
  console.log(`Replyable tweets: ${replyableTweets.length}/${tweets.length}`);

  return replyableTweets.map((tweet: { id: string; author_id: string; text: string }) => {
    const user = users.find((u: { id: string; username: string }) => u.id === tweet.author_id);
    return {
      url: `https://x.com/${user?.username}/status/${tweet.id}`,
      username: user?.username || "unknown",
      content: tweet.text,
    };
  });
}

function buildSearchQuery(platform: string, keyword: string, language: string = ""): string {
  if (language === "ja") {
    switch (platform) {
      case "twitter":
        return `site:twitter.com OR site:x.com ${keyword} 日本語 スタートアップ status`;
      case "reddit":
        return `${keyword} 日本語 スタートアップ`;
      case "linkedin":
        return `${keyword} 日本 LinkedIn`;
      case "tiktok":
        return `${keyword} 日本語 tiktok`;
      case "instagram":
        return `${keyword} 日本語 instagram`;
      case "facebook":
        return `${keyword} 日本語 facebook`;
      default:
        return `${keyword} 日本語`;
    }
  }

  if (language === "zh") {
    switch (platform) {
      case "twitter":
        return `site:twitter.com OR site:x.com ${keyword} 中文 startup status`;
      case "reddit":
        return `${keyword} 中文 startup`;
      default:
        return `${keyword} 中文`;
    }
  }

  if (language === "ko") {
    switch (platform) {
      case "twitter":
        return `site:twitter.com OR site:x.com ${keyword} 한국어 startup status`;
      case "reddit":
        return `${keyword} 한국어 startup`;
      default:
        return `${keyword} 한국어`;
    }
  }

  // 英語 / any / その他
  switch (platform) {
    case "twitter":
      return `site:twitter.com OR site:x.com ${keyword} startup founder status`;
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

function isValidPlatformUrl(url: string, platform: string): boolean {
  if (!url) return false;
  switch (platform) {
    case "reddit":
      return url.includes("reddit.com");
    case "twitter":
      return (url.includes("twitter.com") || url.includes("x.com")) &&
             url.includes("/status/");
    case "linkedin":
      return url.includes("linkedin.com");
    case "tiktok":
      return url.includes("tiktok.com");
    case "instagram":
      return url.includes("instagram.com");
    default:
      return true;
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

    // 2. 本日の接触数確認（ユーザー全体）
    const today = new Date().toISOString().split("T")[0];

    const { data: userCampaigns } = await getSupabase()
      .from("campaigns")
      .select("id")
      .eq("user_id", campaign.user_id);

    const campaignIds = userCampaigns?.map((c: { id: string }) => c.id) || [campaignId];

    const { count } = await getSupabase()
      .from("targets")
      .select("*", { count: "exact", head: true })
      .in("campaign_id", campaignIds)
      .gte("created_at", today);

    if (count && count >= campaign.daily_limit) {
      console.log(`Daily limit reached: ${count}/${campaign.daily_limit}`);
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
            // TwitterはAPIで検索
            if (platform === "twitter") {
              const tweets = await searchTwitterTargets(keyword, campaign.target_language || "ja");
              console.log(`Twitter API results for "${keyword}":`, tweets.length);

              for (const tweet of tweets) {
                if (tweet.username && tweet.username !== "unknown") {
                  await getSupabase().from("targets").insert({
                    campaign_id: campaignId,
                    platform: "twitter",
                    username: tweet.username,
                    profile_url: `https://x.com/${tweet.username}`,
                    post_url: tweet.url,
                    post_content: tweet.content?.slice(0, 500) || "",
                    match_score: 60,
                    match_reason: "Twitter API検索",
                    status: "pending",
                  });
                  insertedTargets.push(tweet.username);
                  console.log("Inserted Twitter target:", tweet.username, tweet.url);
                }
              }
              continue; // Tavilyの処理をスキップ
            }
            const query = buildSearchQuery(platform, keyword, campaign.target_language || "");
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
              console.log("URL:", url, "→ username:", username);

              if (!isValidPlatformUrl(url, platform)) {
                console.log("Skipping invalid URL for platform:", platform, url);
                continue;
              }

              if (username && username !== "unknown") {
                // 即保存（スコアはバッチ処理で後から更新）
                console.log("Inserting target:", username, "on", platform);

                await getSupabase().from("targets").insert({
                  campaign_id: campaignId,
                  platform,
                  username,
                  profile_url: url,
                  post_url: url,
                  post_content: result.content?.slice(0, 500) || "",
                  match_score: 50,
                  match_reason: "AI分析待ち",
                  status: "pending",
                });
                insertedTargets.push(username);
                console.log("Inserted target:", username);
              } else {
                console.log("Skipping - invalid username:", username, "from URL:", url);
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

        const requiredKeywords = campaign?.required_keywords || "";
        const keywordInstruction = requiredKeywords
          ? `\n・必ず以下のキーワードを自然に含める：${requiredKeywords}`
          : "";

        const languageInstruction =
          campaign?.target_language === "ja"
            ? "日本語で書く"
            : campaign?.target_language === "en"
              ? "英語で書く"
              : campaign?.target_language === "zh"
                ? "中国語で書く"
                : campaign?.target_language === "ko"
                  ? "韓国語で書く"
                  : "投稿と同じ言語で書く";

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

【ルール】
・${languageInstruction}
・売り込みから始めない
・対象投稿の内容に具体的に触れる
・自然な会話調で書く
・最後は問いかけで終わる
・150文字以内${keywordInstruction}
・プロダクトについて最後に1文だけ自然に触れる

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
          // テキストからJSONブロックを抽出
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            commentData = JSON.parse(jsonMatch[0]);
          } else {
            commentData = { comment: text.slice(0, 200), approach: "自動生成" };
          }
        } catch {
          commentData = { comment: text.slice(0, 200), approach: "自動生成" };
        }

        // コメントが文字列かどうか確認
        let finalContent =
          typeof commentData.comment === "string"
            ? commentData.comment
            : JSON.stringify(commentData.comment);

        // ```json {...} ``` 形式を除去
        const codeBlockMatch = finalContent.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlockMatch) {
          try {
            const parsed = JSON.parse(codeBlockMatch[1]);
            finalContent = parsed.comment || finalContent;
          } catch {}
        }

        // { "comment": "..." } 形式を除去
        if (typeof finalContent === "string" && /^\s*\{[\s\S]*\}\s*$/.test(finalContent)) {
          try {
            const parsed = JSON.parse(finalContent);
            finalContent = parsed.comment || finalContent;
          } catch {}
        }

        if (finalContent) {
          // commentsテーブルに保存
          await supabase.from("comments").insert({
            target_id: target.id,
            campaign_id: campaignId,
            platform: target.platform,
            content: finalContent,
            approach: commentData.approach || "",
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
