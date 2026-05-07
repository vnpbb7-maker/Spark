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
function buildMultiPlatformQueries(keyword: string, _language: string = ""): { query: string; targetPlatform: string }[] {
  const queries: { query: string; targetPlatform: string }[] = [];

  // All queries are Japanese-only — prioritize Japanese platforms over English ones
  // Social platforms
  queries.push({ query: `site:twitter.com OR site:x.com ${keyword} 日本語 -is:retweet`, targetPlatform: "twitter" });
  queries.push({ query: `site:facebook.com ${keyword} グループ 日本語`, targetPlatform: "facebook" });
  queries.push({ query: `site:instagram.com ${keyword} 日本`, targetPlatform: "instagram" });
  queries.push({ query: `site:linkedin.com ${keyword} 日本`, targetPlatform: "linkedin" });
  queries.push({ query: `site:youtube.com ${keyword} レビュー 日本語`, targetPlatform: "youtube" });

  // Japanese blog/community platforms (primary discovery sources)
  queries.push({ query: `site:note.com ${keyword} 使ってみた OR 試してみた OR 困っている`, targetPlatform: "note" });
  queries.push({ query: `site:zenn.dev ${keyword}`, targetPlatform: "zenn" });
  queries.push({ query: `site:qiita.com ${keyword}`, targetPlatform: "qiita" });
  queries.push({ query: `site:hatenablog.com OR site:hatena.ne.jp ${keyword}`, targetPlatform: "hatena" });
  queries.push({ query: `site:detail.chiebukuro.yahoo.co.jp ${keyword} おすすめ OR 困って`, targetPlatform: "yahoo_qa" });

  // General web (Japanese)
  queries.push({ query: `${keyword} ツール おすすめ ブログ 日本語`, targetPlatform: "web" });

  // Reddit — only Japanese subreddits
  queries.push({ query: `site:reddit.com ${keyword} 日本語 OR 日本`, targetPlatform: "reddit" });

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

    for (const persona of personas.slice(0, 3)) {
      if (limitReached) break;

      // Build search queries from new persona format (discovery_signals + twitter_keywords)
      // Fall back to legacy format (where_to_find / keywords) for old cached data
      const discoverySignals = persona.discovery_signals || [];
      const twitterKeywords = persona.twitter_keywords || [];
      const redditCommunities = persona.reddit_communities || [];
      const legacyKeywords = persona.keywords || [];

      // Combine signals: discovery_signals first, then twitter_keywords
      const searchTerms = [
        ...discoverySignals,
        ...twitterKeywords.slice(0, 2),
        ...legacyKeywords.slice(0, 2),
      ].filter(Boolean).slice(0, 5);

      console.log(`Persona "${persona.label || persona.name}": ${searchTerms.length} search terms, ${redditCommunities.length} reddit communities`);

      for (const platform of platforms.slice(0, 4)) {
        if (limitReached) break;

        // For Twitter, search using twitter_keywords directly
        if (platform === "twitter") {
          const twKeywords = twitterKeywords.length > 0 ? twitterKeywords : searchTerms;
          for (const keyword of twKeywords.slice(0, 3)) {
            const tweets = await searchTwitterTargets(keyword, campaign.target_language || "ja");
            console.log(`Twitter API results for "${keyword}":`, tweets.length);

            for (const tweet of tweets) {
              if (insertedTargets.length >= remaining) { limitReached = true; break; }
              if (tweet.username && tweet.username !== "unknown") {
                await getSupabase().from("targets").insert({
                  campaign_id: campaignId, platform: "twitter", username: tweet.username,
                  profile_url: `https://x.com/${tweet.username}`, post_url: tweet.url,
                  post_content: tweet.content?.slice(0, 500) || "", match_score: 60,
                  match_reason: `キーワード: ${keyword}`, status: "pending",
                });
                insertedTargets.push(tweet.username);
              }
            }
          }
          continue;
        }

        // For Reddit, skip English subreddits — use Japanese platforms instead
        // Reddit communities from Claude are usually English (r/startupideas etc)
        // Instead redirect reddit platform searches to Japanese sites
        if (platform === "reddit") {
          const jpSites = ["site:note.com", "site:zenn.dev", "site:qiita.com"];
          for (const site of jpSites) {
            if (limitReached) break;
            const query = `${site} ${searchTerms[0] || keyword} 困っている OR 探している`;
            try {
              const tavilyResponse = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
                body: JSON.stringify({ query, max_results: 5, search_depth: "basic", topic: "general", include_raw_content: false }),
              });
              if (!tavilyResponse.ok) continue;
              const tavilyData = await tavilyResponse.json();
              const results = (tavilyData.results || []) as Record<string, unknown>[];
              for (const result of results) {
                const url = (result.url as string) || "";
                if (!url) continue;
                if (insertedTargets.length >= remaining) { limitReached = true; break; }
                const detectedPlatform = detectPlatformFromUrl(url);
                const username = extractUsername(url, detectedPlatform);
                if (username && username !== "unknown") {
                  await getSupabase().from("targets").insert({
                    campaign_id: campaignId, platform: detectedPlatform, username, profile_url: url,
                    post_url: url, post_content: ((result.content as string) || "").slice(0, 500),
                    match_score: 55, match_reason: `日本語プラットフォーム: ${site}`, status: "pending",
                  });
                  insertedTargets.push(username);
                  console.log(`Inserted JP target: ${username} from ${site}`);
                }
              }
            } catch (err) { console.error(`JP platform discovery error:`, err); }
          }
          continue;
        }

        // For other platforms, use discovery_signals with buildMultiPlatformQueries
        for (const searchTerm of searchTerms.slice(0, 3)) {
          if (limitReached) break;
          try {
            const allQueries = buildMultiPlatformQueries(searchTerm, campaign.target_language || "");
            const selectedQueries = allQueries.filter(q => {
              if (q.targetPlatform === platform) return true;
              if (q.targetPlatform === "web") return true;
              return false;
            }).slice(0, 2);

            console.log(`Running ${selectedQueries.length} Tavily queries for platform=${platform}, signal="${searchTerm}"`);

            const queryResults = await Promise.allSettled(
              selectedQueries.map(async (sq) => {
                const tavilyResponse = await fetch("https://api.tavily.com/search", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
                  body: JSON.stringify({ query: sq.query, max_results: 5, search_depth: "basic", topic: "general", include_raw_content: false }),
                });
                if (!tavilyResponse.ok) { console.error(`Tavily error for "${sq.query}":`, tavilyResponse.status); return []; }
                const tavilyData = await tavilyResponse.json();
                return (tavilyData.results || []).map((r: Record<string, unknown>) => ({ ...r, _targetPlatform: sq.targetPlatform }));
              })
            );

            const results: Record<string, unknown>[] = [];
            for (const qr of queryResults) {
              if (qr.status === "fulfilled" && Array.isArray(qr.value)) results.push(...qr.value);
            }
            console.log(`Tavily results for signal "${searchTerm}":`, results.length);

            const seenUrls = new Set<string>();
            for (const result of results) {
              const url = (result.url as string) || "";
              if (!url || seenUrls.has(url)) continue;
              seenUrls.add(url);

              const detectedPlatform = detectPlatformFromUrl(url);
              const username = extractUsername(url, detectedPlatform);

              if (insertedTargets.length >= remaining) { limitReached = true; break; }

              if (username && username !== "unknown") {
                await getSupabase().from("targets").insert({
                  campaign_id: campaignId, platform: detectedPlatform, username,
                  profile_url: url, post_url: url,
                  post_content: ((result.content as string) || "").slice(0, 500),
                  match_score: 50, match_reason: `シグナル: ${searchTerm}`, status: "pending",
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

    // Firecrawl deep extraction + Multi-factor AI scoring
    try {
      // Find targets that haven't been scored yet (no relevance_score)
      const { data: scoringTargets, error: scoringQueryErr } = await getSupabase()
        .from("targets")
        .select("id, username, platform, post_url, post_content, profile_url")
        .eq("campaign_id", campaignId)
        .is("relevance_score", null)
        .order("created_at", { ascending: false })
        .limit(15);

      console.log(`[scoring] query result: ${scoringTargets?.length || 0} unscored targets, error:`, scoringQueryErr || "none");

      if (scoringTargets && scoringTargets.length > 0) {
        console.log(`[scoring] Starting multi-factor scoring for ${scoringTargets.length} targets...`);

        // Optional: Firecrawl deep content extraction
        let firecrawlAvailable = false;
        let FirecrawlApp: any = null;
        if (process.env.FIRECRAWL_API_KEY) {
          try {
            const firecrawlModule = await import("@mendable/firecrawl-js");
            FirecrawlApp = firecrawlModule.default || firecrawlModule.FirecrawlApp;
            firecrawlAvailable = true;
            console.log("Firecrawl available for deep extraction");
          } catch { console.log("Firecrawl module not available, using Tavily snippets only"); }
        }

        for (const t of scoringTargets) {
          try {
            let enrichedContent = t.post_content || "";

            // Deep extraction with Firecrawl (if available and URL exists)
            if (firecrawlAvailable && FirecrawlApp && t.post_url) {
              try {
                const fc = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
                const scrapeResult = await fc.scrapeUrl(t.post_url, { formats: ["markdown"] });
                if (scrapeResult?.success && scrapeResult.markdown) {
                  enrichedContent = scrapeResult.markdown.slice(0, 1500);
                  // Update post_content with richer data
                  await getSupabase().from("targets").update({
                    post_content: enrichedContent.slice(0, 500),
                  }).eq("id", t.id);
                  console.log(`Firecrawl enriched: ${t.username} (${enrichedContent.length} chars)`);
                }
              } catch (fcErr) {
                console.log(`Firecrawl failed for ${t.username}, using existing content`);
              }
            }

            // Multi-factor scoring with Claude
            const scoreResponse = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY!,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 300,
                system: "You must respond with valid JSON only. No markdown, no explanation.",
                messages: [
                  {
                    role: "user",
                    content: `あなたはβテスターの適性を評価する専門家です。
以下の投稿を読んで、このプロダクトのβテスターとして適切かを評価してください。

プロダクト: ${campaign.product_description || campaign.product_url}
投稿者: ${t.username}
プラットフォーム: ${t.platform}
投稿内容: ${enrichedContent.slice(0, 500)}

以下の4軸で評価してください（各0-25点、合計100点）:
1. 課題一致度 (relevance_score): プロダクトが解決する課題を抱えているか
2. 行動意欲 (intent_score): 新しいツールを試す意欲を示しているか（「探してる」「困ってる」「試したい」等）
3. 影響力 (influence_score): フォロワーやコミュニティへの影響力があるか
4. 接触可能性 (accessibility_score): 返信・反応してくれそうか

JSON形式で返してください:
{"relevance_score":0,"intent_score":0,"influence_score":0,"accessibility_score":0,"total_score":0,"priority":"S","reason":"日本語で1文","estimated_age":"20代","estimated_role":"推定役職"}

priority基準: S=80点以上, A=60-79, B=40-59, C=39以下`,
                  },
                  { role: "assistant", content: "{" },
                ],
              }),
            });

            const scoreData = await scoreResponse.json();
            const scoreText = "{" + (scoreData.content?.[0]?.text || "");
            const scoreMatch = scoreText.match(/\{[\s\S]*\}/);

            console.log(`[scoring] Raw API response for ${t.username}:`, scoreText.slice(0, 200));

            if (scoreMatch) {
              const score = JSON.parse(scoreMatch[0]);
              const r = Math.min(25, Math.max(0, score.relevance_score || 0));
              const i = Math.min(25, Math.max(0, score.intent_score || 0));
              const f = Math.min(25, Math.max(0, score.influence_score || 0));
              const a = Math.min(25, Math.max(0, score.accessibility_score || 0));
              const totalScore = Math.min(100, Math.max(0, r + i + f + a));

              const updateData = {
                match_score: totalScore,
                relevance_score: r,
                intent_score: i,
                influence_score: f,
                accessibility_score: a,
                priority: score.priority || (totalScore >= 80 ? "S" : totalScore >= 60 ? "A" : totalScore >= 40 ? "B" : "C"),
                ai_reason: (score.reason || "").slice(0, 200),
                estimated_age: score.estimated_age || "不明",
                estimated_role: (score.estimated_role || "不明").slice(0, 50),
                status: "scored",
              };

              console.log(`[scoring] Saving scores for ${t.username}:`, JSON.stringify(updateData));
              const { error: updateErr } = await getSupabase().from("targets").update(updateData).eq("id", t.id);
              if (updateErr) {
                console.error(`[scoring] DB update error for ${t.username}:`, updateErr);
              } else {
                console.log(`[scoring] ✅ ${t.username}: ${updateData.priority} (${totalScore}%) [R:${r} I:${i} F:${f} A:${a}]`);
              }
            } else {
              console.log(`[scoring] No valid JSON in response for ${t.username}, setting C`);
              await getSupabase().from("targets").update({ priority: "C", status: "scored", relevance_score: 0, intent_score: 0, influence_score: 0, accessibility_score: 0 }).eq("id", t.id);
            }
          } catch (scoreErr) {
            console.error(`[scoring] Error for ${t.username}:`, scoreErr);
            await getSupabase().from("targets").update({ priority: "C", status: "scored", relevance_score: 0, intent_score: 0, influence_score: 0, accessibility_score: 0 }).eq("id", t.id);
          }
        }
      }
    } catch (e) {
      console.error("Multi-factor scoring error:", e);
    }

    // コメント生成は手動トリガーに変更（自動生成を停止）
    // ユーザーがキャンペーンページで個別or一括でコメント生成ボタンを押す

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

          // Update status (scoring already done in discovery)
          await supabase.from("targets").update({ status: "commented" }).eq("id", target.id);
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
