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

// Extract publicly available contact info from a profile/page URL
async function extractContactInfo(url: string): Promise<{ email?: string; phone?: string; website?: string; contact_url?: string }> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const text = await res.text();
    const content = text.slice(0, 5000); // Limit to avoid excess processing

    const result: { email?: string; phone?: string; website?: string; contact_url?: string } = {};

    // Extract email (public profile/bio only)
    const emailMatch = content.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
    if (emailMatch) {
      const email = emailMatch[0].toLowerCase();
      // Filter out common non-personal emails
      if (!email.includes("example.com") && !email.includes("noreply") && !email.includes("support@")) {
        result.email = email;
      }
    }

    // Extract JP phone numbers
    const phoneMatch = content.match(/0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/);
    if (phoneMatch) {
      result.phone = phoneMatch[0].replace(/\s/g, "");
    }

    // Extract website URLs from profile (look for personal/business sites)
    const urlMatches = content.match(/https?:\/\/(?!(?:twitter|x|facebook|instagram|tiktok|linkedin|youtube|reddit|note|zenn|qiita)\.com)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s")']*/g);
    if (urlMatches && urlMatches.length > 0) {
      result.website = urlMatches[0].slice(0, 200);
    }

    // Extract contact page URLs
    const contactMatch = content.match(/https?:\/\/[^\s"')]+(?:contact|お問い合わせ|inquiry|about)[^\s"')]*|\/contact\/?/i);
    if (contactMatch) {
      let contactUrl = contactMatch[0];
      if (contactUrl.startsWith("/")) {
        try {
          const base = new URL(url);
          contactUrl = `${base.origin}${contactUrl}`;
        } catch { /* ignore */ }
      }
      result.contact_url = contactUrl.slice(0, 200);
    }

    return result;
  } catch {
    return {};
  }
}
function buildMultiPlatformQueries(keyword: string, language: string = ""): { query: string; targetPlatform: string }[] {
  const isJa = language === "ja";
  const queries: { query: string; targetPlatform: string }[] = [];

  // Social platforms
  queries.push({ query: `site:twitter.com OR site:x.com ${keyword}${isJa ? " 日本語" : ""} -is:retweet`, targetPlatform: "twitter" });
  queries.push({ query: `site:reddit.com ${keyword}${isJa ? "" : " looking for"}`, targetPlatform: "reddit" });
  queries.push({ query: `site:facebook.com ${keyword}${isJa ? " グループ" : " group"}`, targetPlatform: "facebook" });
  queries.push({ query: `site:instagram.com ${keyword}${isJa ? "" : ""}`, targetPlatform: "instagram" });
  queries.push({ query: `site:tiktok.com ${keyword}`, targetPlatform: "tiktok" });
  queries.push({ query: `site:linkedin.com ${keyword}${isJa ? " 日本" : " professional"}`, targetPlatform: "linkedin" });
  queries.push({ query: `site:youtube.com ${keyword}${isJa ? " レビュー" : " review"}`, targetPlatform: "youtube" });

  // Japanese blog/community platforms
  queries.push({ query: `site:note.com ${keyword}${isJa ? " 使ってみた OR 試してみた" : ""}`, targetPlatform: "note" });
  queries.push({ query: `site:zenn.dev ${keyword}`, targetPlatform: "zenn" });
  queries.push({ query: `site:qiita.com ${keyword}`, targetPlatform: "qiita" });
  queries.push({ query: `site:hatenablog.com OR site:hatena.ne.jp ${keyword}`, targetPlatform: "hatena" });
  queries.push({ query: `site:detail.chiebukuro.yahoo.co.jp ${keyword}${isJa ? " おすすめ" : ""}`, targetPlatform: "yahoo_qa" });

  // General web
  queries.push({ query: `${keyword}${isJa ? " ツール おすすめ ブログ" : " tool recommendation blog"}`, targetPlatform: "web" });
  queries.push({ query: `site:quora.com OR site:stackoverflow.com ${keyword}`, targetPlatform: "web" });

  return queries;
}

function detectPlatformFromUrl(url: string): string {
  if (!url) return "web";
  const u = url.toLowerCase();
  if (u.includes("twitter.com") || u.includes("x.com")) return "twitter";
  if (u.includes("reddit.com")) return "reddit";
  if (u.includes("facebook.com") || u.includes("fb.com")) return "facebook";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("note.com")) return "note";
  if (u.includes("zenn.dev")) return "zenn";
  if (u.includes("qiita.com")) return "qiita";
  if (u.includes("hatenablog") || u.includes("hatena.ne.jp")) return "hatena";
  if (u.includes("chiebukuro.yahoo")) return "yahoo_qa";
  if (u.includes("5ch.net") || u.includes("2ch.sc")) return "5ch";
  if (u.includes("quora.com")) return "quora";
  if (u.includes("stackoverflow.com")) return "stackoverflow";
  return "web";
}

function extractUsername(url: string, platform: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);

    switch (platform) {
      case "reddit":
        if (pathParts[0] === "r" && pathParts[1]) return `r/${pathParts[1]}`;
        if (pathParts[0] === "user" && pathParts[1]) return pathParts[1];
        return pathParts[0] || "reddit";
      case "twitter":
        if (urlObj.pathname.includes("search")) return `search:${urlObj.searchParams.get("q")?.slice(0, 20) || "query"}`;
        return pathParts[0] || "twitter";
      case "linkedin":
        if (pathParts[0] === "in" && pathParts[1]) return pathParts[1];
        if (pathParts[0] === "company" && pathParts[1]) return pathParts[1];
        return pathParts[0] || "linkedin";
      case "instagram":
        return pathParts[0]?.replace("@", "") || "instagram";
      case "tiktok":
        return pathParts[0]?.replace("@", "") || "tiktok";
      case "youtube":
        if (pathParts[0] === "watch") return urlObj.searchParams.get("v") || "youtube";
        if (pathParts[0]?.startsWith("@")) return pathParts[0];
        if (pathParts[0] === "channel" && pathParts[1]) return pathParts[1];
        return pathParts[0] || "youtube";
      case "facebook":
        if (pathParts[0] === "groups" && pathParts[1]) return `group/${pathParts[1]}`;
        return pathParts[0] || "facebook";
      case "note":
        return pathParts[0] || "note";
      case "zenn":
        return pathParts[0] || "zenn";
      case "qiita":
        return pathParts[0] || "qiita";
      default:
        return urlObj.hostname.replace("www.", "").split(".")[0] || "web";
    }
  } catch {
    return platform || "web";
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

    const dailyLimit = campaign.daily_limit || 10;
    const usedToday = count || 0;
    if (usedToday >= dailyLimit) {
      console.log(`Daily limit already reached: ${usedToday}/${dailyLimit}`);
      return { error: "Daily limit reached" };
    }
    const remaining = dailyLimit - usedToday;
    console.log(`Daily limit: ${usedToday}/${dailyLimit}, remaining: ${remaining}`);

    // 3. Tavily APIでターゲット発見
    const personas = campaign.target_personas?.personas || [];
    const platforms = campaign.platforms || [];
    const insertedTargets: string[] = [];
    let limitReached = false;
    console.log("Personas count:", personas.length);
    console.log("Platforms:", platforms);

    for (const persona of personas.slice(0, 2)) {
      if (limitReached) break;
      for (const platform of platforms.slice(0, 4)) {
        if (limitReached) break;
        // For SNS platforms, use where_to_find; for blogs/web, use persona keywords
        const keywords = persona.where_to_find?.[platform] || persona.keywords || [];

        for (const keyword of keywords.slice(0, 2)) {
          try {
            // TwitterはAPIで検索
            if (platform === "twitter") {
              const tweets = await searchTwitterTargets(keyword, campaign.target_language || "ja");
              console.log(`Twitter API results for "${keyword}":`, tweets.length);

              for (const tweet of tweets) {
                if (insertedTargets.length >= remaining) {
                  console.log(`Daily limit reached during Twitter insert: ${usedToday + insertedTargets.length}/${dailyLimit}`);
                  limitReached = true;
                  break;
                }
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
                  console.log(`Inserted Twitter target (${insertedTargets.length}/${remaining}):`, tweet.username);
                }
              }
              continue; // Tavilyの処理をスキップ
            }
            // Multi-platform Tavily search
            const allQueries = buildMultiPlatformQueries(keyword, campaign.target_language || "");
            // Select queries matching the campaign's selected platforms + always include web/qa
            const selectedQueries = allQueries.filter(q => {
              if (q.targetPlatform === platform) return true;
              if (q.targetPlatform === "web" || q.targetPlatform === "qa") return true;
              return false;
            }).slice(0, 3);

            console.log(`Running ${selectedQueries.length} Tavily queries for platform=${platform}, keyword=${keyword}`);

            // Run queries in parallel
            const queryResults = await Promise.allSettled(
              selectedQueries.map(async (sq) => {
                const tavilyResponse = await fetch(
                  "https://api.tavily.com/search",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${process.env.TAVILY_API_KEY}`,
                    },
                    body: JSON.stringify({
                      query: sq.query,
                      max_results: 5,
                      search_depth: "basic",
                    }),
                  }
                );
                if (!tavilyResponse.ok) {
                  console.error(`Tavily error for "${sq.query}":`, tavilyResponse.status);
                  return [];
                }
                const tavilyData = await tavilyResponse.json();
                return (tavilyData.results || []).map((r: Record<string, unknown>) => ({ ...r, _targetPlatform: sq.targetPlatform }));
              })
            );

            // Flatten results from all queries
            const results: Record<string, unknown>[] = [];
            for (const qr of queryResults) {
              if (qr.status === "fulfilled" && Array.isArray(qr.value)) {
                results.push(...qr.value);
              }
            }
            console.log(`Total Tavily results for keyword "${keyword}":`, results.length);

            // Deduplicate by URL
            const seenUrls = new Set<string>();
            for (const result of results) {
              const url = (result.url as string) || "";
              if (!url || seenUrls.has(url)) continue;
              seenUrls.add(url);

              // Auto-detect platform from URL
              const detectedPlatform = detectPlatformFromUrl(url);
              const username = extractUsername(url, detectedPlatform);
              console.log(`URL: ${url} → platform: ${detectedPlatform}, username: ${username}`);

              if (insertedTargets.length >= remaining) {
                console.log(`Daily limit reached: ${usedToday + insertedTargets.length}/${dailyLimit}`);
                limitReached = true;
                break;
              }

              if (username && username !== "unknown") {
                await getSupabase().from("targets").insert({
                  campaign_id: campaignId,
                  platform: detectedPlatform,
                  username,
                  profile_url: url,
                  post_url: url,
                  post_content: ((result.content as string) || "").slice(0, 500),
                  match_score: 50,
                  match_reason: "AI分析待ち",
                  status: "pending",
                });
                insertedTargets.push(username);
                console.log(`Inserted target (${insertedTargets.length}/${remaining}):`, detectedPlatform, username);
              }
            }
          } catch (err) {
            console.error("Discovery error:", err);
          }
        }
      }
    }

    // 公開連絡先情報の抽出（バッチ処理、最大10件並列）
    try {
      const { data: newTargets } = await getSupabase()
        .from("targets")
        .select("id, profile_url, platform")
        .eq("campaign_id", campaignId)
        .is("email", null)
        .order("created_at", { ascending: false })
        .limit(10);

      if (newTargets && newTargets.length > 0) {
        console.log(`Extracting contact info for ${newTargets.length} targets...`);
        const contactResults = await Promise.allSettled(
          newTargets.map(async (t: { id: string; profile_url: string; platform: string }) => {
            const info = await extractContactInfo(t.profile_url);
            if (info.email || info.phone || info.website || info.contact_url) {
              await getSupabase().from("targets").update(info).eq("id", t.id);
              console.log(`Contact info found for ${t.id}:`, JSON.stringify(info));
            }
            return info;
          })
        );
        const found = contactResults.filter(r => r.status === "fulfilled" && r.value && Object.keys(r.value).length > 0).length;
        console.log(`Contact extraction complete: ${found}/${newTargets.length} targets had contact info`);
      }
    } catch (e) {
      console.error("Contact extraction error:", e);
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
