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
type ContactInfo = { email?: string; phone?: string; website?: string; contact_url?: string; twitter_handle?: string };

async function extractContactInfo(profileUrl: string, platform: string): Promise<ContactInfo> {
  try {
    // Use Jina Reader to fetch profile page content
    const jinaUrl = `https://r.jina.ai/${profileUrl}`;
    const res = await fetch(jinaUrl, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    const text = await res.text();
    const content = text.slice(0, 5000);

    const result: ContactInfo = {};

    // Extract Twitter/X handle
    const twitterPatterns = [
      /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:[?\s/"]|$)/,
      /@([a-zA-Z0-9_]{2,15})(?:\s|$|\)|,|\|)/,
    ];
    for (const pattern of twitterPatterns) {
      const match = content.match(pattern);
      if (match && match[1] && !['home','search','explore','settings','i','intent'].includes(match[1].toLowerCase())) {
        result.twitter_handle = `@${match[1]}`;
        break;
      }
    }

    // Extract email (public profile/bio only)
    const emailMatch = content.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
    if (emailMatch) {
      const email = emailMatch[0].toLowerCase();
      if (!email.includes("example") && !email.includes("noreply") && !email.includes("support@") && !email.includes("info@")) {
        result.email = email;
      }
    }

    // Extract JP phone numbers
    const phoneMatch = content.match(/0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/);
    if (phoneMatch) {
      result.phone = phoneMatch[0].replace(/\s/g, "");
    }

    // Extract website URLs (exclude major platforms)
    const excludedDomains = ['twitter','x','facebook','instagram','tiktok','linkedin','youtube','reddit','note','zenn','qiita','hatena','amazon','google','apple','github'];
    const urlPattern = /https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})[^\s")'\]\|]*/g;
    let urlMatch;
    while ((urlMatch = urlPattern.exec(content)) !== null) {
      const domain = urlMatch[1].toLowerCase();
      if (!excludedDomains.some(d => domain.includes(d))) {
        result.website = urlMatch[0].slice(0, 200);
        break;
      }
    }

    result.contact_url = profileUrl;

    const foundCount = Object.keys(result).filter(k => k !== 'contact_url').length;
    if (foundCount > 0) {
      console.log(`[contact] ${platform} ${profileUrl.slice(0, 40)}: found ${Object.keys(result).join(', ')}`);
    }

    return result;
  } catch {
    return {};
  }
}

// Filter Tavily results to only include content from the last 6 months
function filterFreshResults(results: Record<string, unknown>[], cutoffDate: Date): Record<string, unknown>[] {
  return results.filter(r => {
    const pubDate = r.published_date as string | undefined;
    if (!pubDate) return true; // keep if no date info
    try {
      return new Date(pubDate) > cutoffDate;
    } catch {
      return true; // keep if date can't be parsed
    }
  });
}

// Filter out corporate/company results — keep individual users only
const COMPANY_SIGNALS = [
  '株式会社', '合同会社', '有限会社', 'inc.', 'corp', 'co.jp', 'co.,ltd', 'company', 'official',
  'サービス紹介', 'プレスリリース', 'お知らせ', '会社概要', '採用情報', '企業',
  '/press/', '/news/', '/company/', '/about/', '/service/', '/recruit/',
];

function isCompanyUrl(url: string, content: string = ""): boolean {
  const lower = (url + " " + content.slice(0, 200)).toLowerCase();
  return COMPANY_SIGNALS.some(s => lower.includes(s));
}

// Build author profile URL from article URL
function buildProfileUrl(url: string, platform: string, username: string): string {
  switch (platform) {
    case "note": return `https://note.com/${username}`;
    case "qiita": return `https://qiita.com/${username}`;
    case "zenn": return `https://zenn.dev/${username}`;
    case "twitter": return `https://x.com/${username}`;
    case "hatena": {
      // hatena blog: username.hatenablog.com or hatena.ne.jp/username
      try {
        const host = new URL(url).hostname;
        const sub = host.split(".")[0];
        return `https://profile.hatena.ne.jp/${sub}/`;
      } catch { return url; }
    }
    default: return url;
  }
}

// Extract Twitter handle and other contact info from post content
function extractSocialFromContent(content: string): { twitter_handle?: string; found_email?: string } {
  const result: { twitter_handle?: string; found_email?: string } = {};
  // Twitter handle
  const twitterMatch = content.match(/@([a-zA-Z0-9_]{1,15})(?:\s|$|\)|\]|,)/)
    || content.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})/);
  if (twitterMatch) result.twitter_handle = `@${twitterMatch[1]}`;
  // Email
  const emailMatch = content.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
  if (emailMatch && !emailMatch[0].includes("example") && !emailMatch[0].includes("noreply")) {
    result.found_email = emailMatch[0];
  }
  return result;
}

function buildMultiPlatformQueries(keyword: string, _language: string = ""): { query: string; targetPlatform: string }[] {
  // Multiple query templates — shuffled each run for variety
  const personal = [
    "体験談 OR 困った OR 試した OR やってみた",
    "使ってみた OR 探してる OR 乗り換え OR 比較",
    "解決した OR 導入した OR やめた OR 失敗した",
    "おすすめ OR レビュー OR 感想 OR 実体験",
  ];
  const exclude = "-プレスリリース -サービス紹介 -お知らせ";

  // Pick a random personal keyword set for variety across runs
  const personalIdx = Math.floor(Math.random() * personal.length);
  const p1 = personal[personalIdx];
  const p2 = personal[(personalIdx + 1) % personal.length];

  const queries: { query: string; targetPlatform: string }[] = [];

  // Social
  queries.push({ query: `site:twitter.com OR site:x.com ${keyword} 日本語 -is:retweet`, targetPlatform: "twitter" });

  // Japanese individual-focused platforms (primary) — use alternating personal phrases
  queries.push({ query: `site:note.com ${keyword} ${p1} ${exclude}`, targetPlatform: "note" });
  queries.push({ query: `site:zenn.dev ${keyword} ${p2}`, targetPlatform: "zenn" });
  queries.push({ query: `site:qiita.com ${keyword} ${p1}`, targetPlatform: "qiita" });
  queries.push({ query: `site:hatenablog.com OR site:hatena.ne.jp ${keyword} ${p2}`, targetPlatform: "hatena" });
  queries.push({ query: `site:detail.chiebukuro.yahoo.co.jp ${keyword} おすすめ OR 困って`, targetPlatform: "yahoo_qa" });

  // General web (Japanese, personal)
  queries.push({ query: `${keyword} 個人ブログ ${p2} 日本語 ${exclude}`, targetPlatform: "web" });

  // Reddit — only Japanese
  queries.push({ query: `site:reddit.com ${keyword} 日本語 OR 日本`, targetPlatform: "reddit" });

  // Shuffle array for variety
  for (let i = queries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queries[i], queries[j]] = [queries[j], queries[i]];
  }

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

    // 2. Per-campaign target limit
    // TODO: change back to 10 before production release
    const campaignLimit = campaign.daily_limit || 20;

    const { count } = await getSupabase()
      .from("targets")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    const existingCount = count || 0;
    if (existingCount >= campaignLimit) {
      console.log(`Campaign limit reached: ${existingCount}/${campaignLimit}`);
      return { error: "Campaign limit reached" };
    }
    const remaining = campaignLimit - existingCount;
    const minMatchScore = (campaign.min_match_score as number) || 50;
    console.log(`Campaign ${campaignId}: ${existingCount}/${campaignLimit} targets, remaining: ${remaining}, minMatchScore: ${minMatchScore}`);

    // 2b. Cross-campaign deduplication: load all existing targets for this user
    const userId = campaign.user_id;
    const { data: userCampaigns } = await getSupabase()
      .from("campaigns")
      .select("id")
      .eq("user_id", userId);
    const userCampaignIds = (userCampaigns || []).map((c: { id: string }) => c.id);

    const { data: existingTargetRows } = await getSupabase()
      .from("targets")
      .select("username, platform")
      .in("campaign_id", userCampaignIds);

    const dedupSet = new Set<string>();
    (existingTargetRows || []).forEach((t: { username: string; platform: string }) => {
      dedupSet.add(`${t.platform}::${t.username.toLowerCase()}`);
    });
    console.log(`[dedup] Loaded ${dedupSet.size} existing targets across ${userCampaignIds.length} campaigns`);

    // 3. Tavily APIでターゲット発見
    const personas = campaign.target_personas?.personas || [];
    const platforms = campaign.platforms || [];
    const insertedTargets: string[] = [];
    let limitReached = false;
    console.log("Personas count:", personas.length);
    console.log("[discovery] platforms selected:", platforms);

    for (const persona of personas.slice(0, 3)) {
      if (limitReached) break;

      // Build search queries from new persona format (discovery_signals + twitter_keywords)
      // Fall back to legacy format (where_to_find / keywords) for old cached data
      const discoverySignals = persona.discovery_signals || [];
      const twitterKeywords = persona.twitter_keywords || [];
      const redditCommunities = persona.reddit_communities || [];
      const legacyKeywords = persona.keywords || [];

      // Combine signals: discovery_signals first, then twitter_keywords
      const allSignals = [
        ...discoverySignals,
        ...twitterKeywords,
        ...legacyKeywords,
      ].filter(Boolean);

      // Shuffle signals for variety across runs
      for (let i = allSignals.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allSignals[i], allSignals[j]] = [allSignals[j], allSignals[i]];
      }
      const searchTerms = allSignals.slice(0, 5);

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
                const dedupKey = `twitter::${tweet.username.toLowerCase()}`;
                if (dedupSet.has(dedupKey)) { console.log(`[dedup] Skipped duplicate: @${tweet.username} (twitter)`); continue; }
                dedupSet.add(dedupKey);
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

        // 6-month freshness: calculate start_date for all Tavily searches
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const startDate = sixMonthsAgo.toISOString().split("T")[0]; // YYYY-MM-DD

        // For Reddit, search Japanese platforms — but ONLY ones user selected
        if (platform === "reddit") {
          const jpPlatformMap: Record<string, string> = {
            "note": "site:note.com",
            "zenn": "site:zenn.dev",
            "qiita": "site:qiita.com",
            "reddit": "site:reddit.com",
          };
          // Only search JP sites that are in the user's selected platforms
          const jpSites = platforms
            .filter((p: string) => jpPlatformMap[p])
            .map((p: string) => jpPlatformMap[p]);
          // If no JP platforms selected, fall back to reddit itself
          if (jpSites.length === 0) jpSites.push("site:reddit.com");
          console.log(`[discovery] Reddit redirect → searching: ${jpSites.join(", ")}`);
          for (const site of jpSites) {
            if (limitReached) break;
            const query = `${site} ${searchTerms[0] || keyword} 困っている OR 探している`;
            try {
              const tavilyResponse = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
                body: JSON.stringify({ query, max_results: 5, search_depth: "basic", topic: "general", include_raw_content: false, start_date: startDate }),
              });
              if (!tavilyResponse.ok) continue;
              const tavilyData = await tavilyResponse.json();
              const results = filterFreshResults((tavilyData.results || []) as Record<string, unknown>[], sixMonthsAgo);
              for (const result of results) {
                const url = (result.url as string) || "";
                const content = String((result.content as string) || (result.snippet as string) || "").slice(0, 500);
                if (!url) continue;
                if (isCompanyUrl(url, content)) { console.log(`Skipped company: ${url.slice(0, 60)}`); continue; }
                if (insertedTargets.length >= remaining) { limitReached = true; break; }
                const detectedPlatform = detectPlatformFromUrl(url);
                // Only keep results whose detected platform is in user's selected platforms
                if (!platforms.includes(detectedPlatform) && detectedPlatform !== "web") {
                  console.log(`[discovery] Skipped off-platform result: ${detectedPlatform} (${url.slice(0, 50)})`);
                  continue;
                }
                const username = extractUsername(url, detectedPlatform);
                if (username && username !== "unknown") {
                  const dedupKey = `${detectedPlatform}::${username.toLowerCase()}`;
                  if (dedupSet.has(dedupKey)) { console.log(`[dedup] Skipped duplicate: ${username} (${detectedPlatform})`); continue; }
                  dedupSet.add(dedupKey);
                  const profileUrl = buildProfileUrl(url, detectedPlatform, username);
                  const social = extractSocialFromContent(content);
                  await getSupabase().from("targets").insert({
                    campaign_id: campaignId, platform: detectedPlatform, username, profile_url: profileUrl,
                    post_url: url, post_content: content,
                    match_score: 55, match_reason: `日本語プラットフォーム: ${site}`, status: "pending",
                    ...(social.found_email ? { email: social.found_email } : {}),
                  });
                  insertedTargets.push(username);
                  console.log(`Inserted JP target: ${username} (profile: ${profileUrl.slice(0, 40)})`);
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
              // Only include "web" queries if no platform-specific query matched
              return false;
            }).slice(0, 2);
            // If no platform-specific queries, use web fallback
            if (selectedQueries.length === 0) {
              const webQ = allQueries.filter(q => q.targetPlatform === "web").slice(0, 1);
              selectedQueries.push(...webQ);
            }

            console.log(`Running ${selectedQueries.length} Tavily queries for platform=${platform}, signal="${searchTerm}"`);

            const queryResults = await Promise.allSettled(
              selectedQueries.map(async (sq) => {
                const tavilyResponse = await fetch("https://api.tavily.com/search", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
                  body: JSON.stringify({ query: sq.query, max_results: 5, search_depth: "basic", topic: "general", include_raw_content: false, start_date: startDate }),
                });
                if (!tavilyResponse.ok) { console.error(`Tavily error for "${sq.query}":`, tavilyResponse.status); return []; }
                const tavilyData = await tavilyResponse.json();
                return (tavilyData.results || []).map((r: Record<string, unknown>) => ({ ...r, _targetPlatform: sq.targetPlatform }));
              })
            );

            const rawResults: Record<string, unknown>[] = [];
            for (const qr of queryResults) {
              if (qr.status === "fulfilled" && Array.isArray(qr.value)) rawResults.push(...qr.value);
            }
            const results = filterFreshResults(rawResults, sixMonthsAgo);
            console.log(`Tavily results for signal "${searchTerm}": ${results.length} fresh (${rawResults.length} total)`);

            const seenUrls = new Set<string>();
            for (const result of results) {
              const url = (result.url as string) || "";
              const content = String((result.content as string) || (result.snippet as string) || "").slice(0, 500);
              if (!url || seenUrls.has(url)) continue;
              seenUrls.add(url);

              // Skip company/corporate pages
              if (isCompanyUrl(url, content)) { console.log(`Skipped company: ${url.slice(0, 60)}`); continue; }

              const detectedPlatform = detectPlatformFromUrl(url);
              // Only keep results whose detected platform is in user's selected platforms
              if (!platforms.includes(detectedPlatform) && detectedPlatform !== "web") {
                console.log(`[discovery] Skipped off-platform result: ${detectedPlatform} (${url.slice(0, 50)})`);
                continue;
              }
              const username = extractUsername(url, detectedPlatform);

              if (insertedTargets.length >= remaining) { limitReached = true; break; }

              if (username && username !== "unknown") {
                const dedupKey = `${detectedPlatform}::${username.toLowerCase()}`;
                if (dedupSet.has(dedupKey)) { console.log(`[dedup] Skipped duplicate: ${username} (${detectedPlatform})`); continue; }
                dedupSet.add(dedupKey);
                const profileUrl = buildProfileUrl(url, detectedPlatform, username);
                const social = extractSocialFromContent(content);
                await getSupabase().from("targets").insert({
                  campaign_id: campaignId, platform: detectedPlatform, username,
                  profile_url: profileUrl, post_url: url,
                  post_content: content,
                  match_score: 50, match_reason: `シグナル: ${searchTerm}`, status: "pending",
                  ...(social.found_email ? { email: social.found_email } : {}),
                });
                insertedTargets.push(username);
                console.log(`Inserted target (${insertedTargets.length}/${remaining}): ${detectedPlatform} ${username} (profile: ${profileUrl.slice(0, 40)})`);
              }
            }
          } catch (err) {
            console.error("Discovery error:", err);
          }
        }
      }
    }

    // 公開連絡先情報の抽出（プロフィールページから）
    try {
      const { data: newTargets } = await getSupabase()
        .from("targets")
        .select("id, profile_url, platform, username")
        .eq("campaign_id", campaignId)
        .is("contact_url", null)
        .order("match_score", { ascending: false })
        .limit(15);

      if (newTargets && newTargets.length > 0) {
        console.log(`[contact] Extracting contact info for ${newTargets.length} targets...`);
        const contactResults = await Promise.allSettled(
          newTargets.map(async (t: { id: string; profile_url: string; platform: string; username: string }) => {
            // Use proper profile URL for the platform
            const profileUrl = buildProfileUrl(t.profile_url, t.platform, t.username);
            const info = await extractContactInfo(profileUrl, t.platform);
            if (Object.keys(info).length > 0) {
              // If no email found but twitter_handle exists, note it
              const updateData: Record<string, unknown> = { ...info };
              if (!info.email && info.twitter_handle) {
                updateData.email = `Twitter: ${info.twitter_handle}`;
              }
              await getSupabase().from("targets").update(updateData).eq("id", t.id);
            } else {
              // Mark as checked so we don't retry
              await getSupabase().from("targets").update({ contact_url: profileUrl }).eq("id", t.id);
            }
            return info;
          })
        );
        const found = contactResults.filter(r => r.status === "fulfilled" && r.value && Object.keys(r.value).length > 1).length;
        console.log(`[contact] Complete: ${found}/${newTargets.length} targets had contact info`);
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
                temperature: 0,
                system: "You must respond with valid JSON only. No markdown, no explanation. Start with { and end with }.",
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
2. 行動意欲 (intent_score): 新しいツールを試す意欲を示しているか
3. 影響力 (influence_score): フォロワーやコミュニティへの影響力があるか
4. 接触可能性 (accessibility_score): 返信・反応してくれそうか

JSON形式で返してください:
{"relevance_score":0,"intent_score":0,"influence_score":0,"accessibility_score":0,"reason":"日本語で1文","estimated_age":"20代","estimated_role":"推定役職"}`,
                  },
                ],
              }),
            });

            const scoreData = await scoreResponse.json();
            const rawScoreText = scoreData.content?.[0]?.text || "";
            const scoreMatch = rawScoreText.match(/\{[\s\S]*\}/);

            console.log(`[scoring] Raw response for ${t.username}:`, rawScoreText.slice(0, 200));

            if (scoreMatch) {
              const score = JSON.parse(scoreMatch[0]);
              const r = Math.min(25, Math.max(0, score.relevance_score || 0));
              const i = Math.min(25, Math.max(0, score.intent_score || 0));
              const f = Math.min(25, Math.max(0, score.influence_score || 0));
              const a = Math.min(25, Math.max(0, score.accessibility_score || 0));
              const totalScore = Math.min(100, Math.max(0, r + i + f + a));

              // Always compute priority from total_score
              // Lowered thresholds for better distribution
              const priority = totalScore >= 70 ? "S" : totalScore >= 50 ? "A" : totalScore >= 30 ? "B" : "C";

              const updateData = {
                match_score: totalScore,
                relevance_score: r,
                intent_score: i,
                influence_score: f,
                accessibility_score: a,
                priority,
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
                // Delete targets that score below the campaign's min_match_score
                if (totalScore < minMatchScore) {
                  await getSupabase().from("targets").delete().eq("id", t.id);
                  console.log(`[filter] Removed low score target: @${t.username} (score: ${totalScore}, min: ${minMatchScore})`);
                }
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
