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

// Try to get public email from GitHub profile
async function getGitHubEmail(githubUrl: string): Promise<string | null> {
  try {
    const username = githubUrl.split('github.com/')[1]?.split(/[/?#]/)[0];
    if (!username || username.length < 1) return null;
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'SPARK-Discovery' };
    if (token) headers['Authorization'] = `token ${token}`;
    const res = await fetch(`https://api.github.com/users/${username}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const email = data.email as string | null;
    if (email && !email.includes('noreply') && !email.includes('users.noreply')) {
      console.log(`[github] Found public email for ${username}: ${email}`);
      return email;
    }
    return null;
  } catch {
    return null;
  }
}

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

    // Extract GitHub link and try to get email from GitHub API
    const githubMatch = content.match(/https?:\/\/github\.com\/([a-zA-Z0-9_-]+)(?:[?\s/")\]|]|$)/);
    if (githubMatch && ['qiita', 'zenn', 'note'].includes(platform)) {
      const ghUrl = `https://github.com/${githubMatch[1]}`;
      const ghEmail = await getGitHubEmail(ghUrl);
      if (ghEmail) {
        result.email = ghEmail;
        result.website = result.website || ghUrl;
      }
    }

    // Extract email from page content (if not already found via GitHub)
    if (!result.email) {
      const emailMatch = content.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
      if (emailMatch) {
        const email = emailMatch[0].toLowerCase();
        if (!email.includes("example") && !email.includes("noreply") && !email.includes("support@") && !email.includes("info@")) {
          result.email = email;
        }
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
        result.website = result.website || urlMatch[0].slice(0, 200);
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
  'blog.', '/blog/', 'techblog', 'engineering.', 'developers.', 'product/', 'landing',
];

// Allowlist of personal platform URL patterns
const PERSONAL_URL_PATTERNS = [
  /note\.com\/[a-zA-Z0-9_-]+/,
  /qiita\.com\/[a-zA-Z0-9_-]+/,
  /zenn\.dev\/[a-zA-Z0-9_-]+/,
  /(?:twitter|x)\.com\/[a-zA-Z0-9_]+/,
  /reddit\.com\/(?:user|r)\/[a-zA-Z0-9_-]+/,
  /wantedly\.com\/(?:id|users)\/[a-zA-Z0-9_-]+/,
  /connpass\.com\/(?:user|event)\/[a-zA-Z0-9_-]+/,
  /producthunt\.com\/(?:@|posts\/)[a-zA-Z0-9_-]+/,
  /peatix\.com\/event\/[0-9]+/,
  /hatenablog\.com/,
  /hatena\.ne\.jp/,
  /chiebukuro\.yahoo\.co\.jp/,
  /discord\.(?:gg|com)/,
  /github\.com\/[a-zA-Z0-9_-]+/,
];

function isCompanyUrl(url: string, content: string = ""): boolean {
  const lower = (url + " " + content.slice(0, 200)).toLowerCase();
  // Check company signals first
  if (COMPANY_SIGNALS.some(s => lower.includes(s))) return true;
  // If URL is from a known personal platform, it's NOT a company
  if (PERSONAL_URL_PATTERNS.some(p => p.test(url))) return false;
  // Unknown domain without personal platform pattern = likely company blog
  const detectedPlatform = detectPlatformFromUrl(url);
  if (detectedPlatform === "web") {
    console.log(`[filter] Skipped unknown domain (likely company): ${url.slice(0, 60)}`);
    return true;
  }
  return false;
}

// Build author profile URL from article URL
function buildProfileUrl(url: string, platform: string, username: string): string {
  switch (platform) {
    case "note": return `https://note.com/${username}`;
    case "qiita": return `https://qiita.com/${username}`;
    case "zenn": return `https://zenn.dev/${username}`;
    case "twitter": return `https://x.com/${username}`;
    case "wantedly": return `https://www.wantedly.com/id/${username}`;
    case "connpass": return `https://connpass.com/user/${username}/`;
    case "reddit": return `https://www.reddit.com/user/${username}`;
    case "hatena": {
      try {
        const host = new URL(url).hostname;
        const sub = host.split(".")[0];
        return `https://profile.hatena.ne.jp/${sub}/`;
      } catch { return url; }
    }
    default: return url || `https://www.google.com/search?q=${encodeURIComponent(username)}`;
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

  // New platforms
  queries.push({ query: `site:wantedly.com ${keyword} 課題 OR 困っている OR 募集`, targetPlatform: "wantedly" });
  queries.push({ query: `site:producthunt.com ${keyword} review OR comment OR alternative`, targetPlatform: "producthunt" });
  queries.push({ query: `site:peatix.com ${keyword} イベント OR セミナー OR 勉強会`, targetPlatform: "peatix" });
  queries.push({ query: `site:discord.gg OR site:discord.com ${keyword} community OR server OR 日本`, targetPlatform: "discord" });

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
  if (u.includes("wantedly.com")) return "wantedly";
  if (u.includes("connpass.com")) return "connpass";
  if (u.includes("producthunt.com")) return "producthunt";
  if (u.includes("peatix.com")) return "peatix";
  if (u.includes("discord.gg") || u.includes("discord.com")) return "discord";
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
      case "wantedly":
        if (pathParts[0] === "id" && pathParts[1]) return pathParts[1];
        if (pathParts[0] === "companies" && pathParts[1]) return pathParts[1];
        return pathParts[0] || "wantedly";
      case "connpass":
        if (pathParts[0] === "user" && pathParts[1]) return pathParts[1];
        return pathParts[0] || "connpass";
      case "producthunt":
        if (pathParts[0]?.startsWith("@")) return pathParts[0].replace("@", "");
        if (pathParts[0] === "posts" && pathParts[1]) return pathParts[1];
        return pathParts[0] || "producthunt";
      case "peatix":
        if (pathParts[0] === "event" && pathParts[1]) return `event-${pathParts[1]}`;
        return pathParts[0] || "peatix";
      case "discord":
        return pathParts[1] || pathParts[0] || "discord";
      case "google_maps":
        return pathParts[0] || "business";
      default:
        return urlObj.hostname.replace("www.", "").split(".")[0] || "web";
    }
  } catch {
    return platform || "web";
  }
}

export const discoverTargets = inngest.createFunction(
  { id: "discover-targets", triggers: [{ event: "campaign/discover" }] },
  async ({ event, step }: any) => {
    const campaignId = event.data.campaign_id as string;
    console.log("Starting discover for campaign:", campaignId);

    // ═══ STEP 1: Get campaign + generate queries ═══
    const stepData = await step.run("get-campaign-and-queries", async () => {
    console.log("[step1] START campaign_id:", campaignId);

    // 1. キャンペーン取得
    const { data: campaign, error: campErr } = await getSupabase()
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();
    console.log("[step1] campaign found:", !!campaign, "error:", campErr?.message || "none", "platforms:", campaign?.platforms);

    if (!campaign) return { campaign: null, platforms: [], productDescription: "", searchQueries: [], remaining: 0, dedupKeys: [] as string[], minMatchScore: 0 };

    // 2. Per-campaign target limit
    // TODO: change back to plan-based limit before production release
    const campaignLimit = campaign.daily_limit || 50;

    const { count } = await getSupabase()
      .from("targets")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    const existingCount = count || 0;
    if (existingCount >= campaignLimit) {
      console.log(`Campaign limit reached: ${existingCount}/${campaignLimit}`);
      return { campaign: null, platforms: [], productDescription: "", searchQueries: [], remaining: 0, dedupKeys: [] as string[], minMatchScore: 0 };
    }
    const remaining = campaignLimit - existingCount;
    const minMatchScore = (campaign.min_match_score as number) || 50;
    console.log(`Campaign ${campaignId}: ${existingCount}/${campaignLimit} targets, remaining: ${remaining}, minMatchScore: ${minMatchScore}`);

    // 2b. Cross-campaign deduplication: only skip targets found in last 7 days
    const userId = campaign.user_id;
    const { data: userCampaigns } = await getSupabase()
      .from("campaigns")
      .select("id")
      .eq("user_id", userId);
    const userCampaignIds = (userCampaigns || []).map((c: { id: string }) => c.id);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: existingTargetRows } = await getSupabase()
      .from("targets")
      .select("username, platform")
      .in("campaign_id", userCampaignIds)
      .gte("created_at", sevenDaysAgo);

    const dedupSet = new Set<string>();
    (existingTargetRows || []).forEach((t: { username: string; platform: string }) => {
      dedupSet.add(`${t.platform}::${t.username.toLowerCase()}`);
    });
    console.log(`[dedup] Loaded ${dedupSet.size} existing targets from last 7 days across ${userCampaignIds.length} campaigns`);

    // 3. Generate problem-focused search queries via Claude
    const platforms = (campaign.platforms || []) as string[];
    const productDescription = (campaign.product_description as string) || "";
    const targetPersonas = (campaign.target_personas || []) as Array<Record<string, unknown>>;
    console.log("[discovery] User selected platforms:", JSON.stringify(platforms));

    // Extract pain_scene and discovery_signals from personas
    const painScenes = targetPersonas
      .map(p => p.pain_scene as string || "")
      .filter(Boolean)
      .join(" / ");
    const discoverySignals = targetPersonas
      .flatMap(p => (p.discovery_signals as string[] || []))
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");
    const personaContext = painScenes || productDescription;

    // Generate search queries focused on PEOPLE WITH PROBLEMS (not product descriptions)
    let searchQueries: string[] = [];
    try {
      const queryGenRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022", max_tokens: 600, temperature: 0.8,
          messages: [{ role: "user", content: `Generate 6 Japanese search queries to find people who are CURRENTLY STRUGGLING with:
${personaContext}

They are looking for solutions like: ${productDescription}
${discoverySignals ? `Discovery signals (what they say/post): ${discoverySignals}` : ""}

Rules:
- Queries must sound like REAL PEOPLE'S complaints, questions or cries for help
- NOT product descriptions or feature lists
- Use expressions like: 「〜で困ってる」「〜どうすればいい」「〜時間かかりすぎ」「〜いい方法ない？」「〜しんどい」「〜疲れた」
- Vary formats: some as questions, some as complaints, some as "searching for"
- Examples for a "find beta testers" product: "βテスター どこで募集すればいい", "初期ユーザー集めるの時間かかりすぎ", "プロダクト検証 ユーザー 見つからない"

Return JSON only: { "queries": ["query1", "query2", "query3", "query4", "query5", "query6"] }` }],
        }),
      });
      if (queryGenRes.ok) {
        const queryGenData = await queryGenRes.json();
        const text = queryGenData.content?.[0]?.text || "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          searchQueries = (parsed.queries || []).filter((q: unknown) => typeof q === "string" && q.length > 0);
        }
      }
    } catch (e) { console.error("[discovery] Query generation error:", e); }

    // Fallback if Claude fails
    if (searchQueries.length === 0) {
      searchQueries = [
        `${personaContext.slice(0, 25)} 困っている`,
        `${personaContext.slice(0, 25)} 解決策 探してる`,
        `${productDescription.slice(0, 20)} どうすればいい`,
      ];
    }
    console.log("[step1] pain context:", personaContext.slice(0, 80));
    console.log("[step1] generated queries:", searchQueries.length, searchQueries);
    console.log("[step1] returning:", { platforms, queriesCount: searchQueries.length, remaining });

    return { campaign, platforms, productDescription, searchQueries, remaining, dedupKeys: [...dedupSet], minMatchScore };
    }); // end step 1

    if (!stepData.campaign) return { error: "Campaign not found or limit reached" };
    const { campaign, platforms, productDescription, searchQueries, remaining } = stepData;
    const dedupSet = new Set(stepData.dedupKeys);
    const minMatchScore = stepData.minMatchScore;

    // ═══ STEP 2: Discover targets ═══
    const discoveryResult = await step.run("discover-targets-search", async () => {

    const insertedTargets: string[] = [];
    let limitReached = false;

    console.log("[step2] START platforms:", platforms, "queries:", searchQueries?.length, "remaining:", remaining);
    console.log("[step2] TAVILY_KEY set:", !!process.env.TAVILY_API_KEY);
    console.log("[step2] GOOGLE_KEY set:", !!process.env.GOOGLE_PLACES_API_KEY);
    console.log("[step2] ANTHROPIC_KEY set:", !!process.env.ANTHROPIC_API_KEY);
    // Legacy logs (kept for compatibility)
    console.log("[search] TAVILY_API_KEY set:", !!process.env.TAVILY_API_KEY);
    console.log("[search] platforms:", platforms);
    console.log("[search] searchQueries:", searchQueries);
    console.log("[search] remaining slots:", remaining, "dedup keys:", dedupSet.size);

    // 6-month freshness
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const startDate = sixMonthsAgo.toISOString().split("T")[0];

    // Platform-specific site prefixes
    const PLATFORM_SITE: Record<string, string> = {
      twitter: "site:x.com OR site:twitter.com",
      reddit: "site:reddit.com",
      note: "site:note.com",
      qiita: "site:qiita.com",
      zenn: "site:zenn.dev",
      yahoo_qa: "site:detail.chiebukuro.yahoo.co.jp",
      hatena: "site:hatenablog.com OR site:hatenadiary.com",
      wantedly: "site:wantedly.com",
      producthunt: "site:producthunt.com",
      peatix: "site:peatix.com",
    };

    // Process each platform the user selected (HARD BLOCK: skip anything not selected)
    for (const platform of platforms) {
      if (limitReached) break;
      console.log(`[step2] processing platform: ${platform} (inserted: ${insertedTargets.length}/${remaining})`);

      // Skip platforms handled separately below (connpass, google_maps)
      if (platform === "connpass" || platform === "google_maps") continue;

      // Twitter: use dedicated Twitter search API
      if (platform === "twitter") {
        for (const query of searchQueries.slice(0, 3)) {
          if (limitReached) break;
          const tweets = await searchTwitterTargets(query, campaign.target_language || "ja");
          console.log(`[discovery] Twitter results for "${query}": ${tweets.length}`);
          for (const tweet of tweets) {
            if (insertedTargets.length >= remaining) { limitReached = true; break; }
            if (tweet.username && tweet.username !== "unknown") {
              const dedupKey = `twitter::${tweet.username.toLowerCase()}`;
              if (dedupSet.has(dedupKey)) continue;
              dedupSet.add(dedupKey);
              await getSupabase().from("targets").insert({
                campaign_id: campaignId, platform: "twitter", username: tweet.username,
                profile_url: `https://x.com/${tweet.username}`, post_url: tweet.url,
                post_content: tweet.content?.slice(0, 500) || "", match_score: 60,
                match_reason: `キーワード: ${query}`, status: "pending",
              });
              insertedTargets.push(tweet.username);
            }
          }
        }
        continue;
      }

      // "web" platform: cycle through multiple Japanese community site prefixes
      if (platform === "web") {
        const webSites = [
          "site:note.com",
          "site:qiita.com",
          "site:zenn.dev",
          "site:reddit.com",
          "site:detail.chiebukuro.yahoo.co.jp",
        ];
        let webInserted = 0;
        for (const sitePfx of webSites) {
          if (limitReached || webInserted >= 4) break;
          for (const query of searchQueries.slice(0, 2)) {
            if (limitReached) break;
            const fullQuery = `${sitePfx} ${query}`;
            try {
              const tavilyResponse = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
                body: JSON.stringify({ query: fullQuery, max_results: 8, search_depth: "basic", topic: "general", include_raw_content: false, start_date: startDate }),
              });
              if (!tavilyResponse.ok) { console.error(`[web] Tavily error for "${fullQuery}":`, tavilyResponse.status); continue; }
              const tavilyData = await tavilyResponse.json();
              const results = filterFreshResults((tavilyData.results || []) as Record<string, unknown>[], sixMonthsAgo);
              console.log(`[web] ${sitePfx}: ${results.length} results for "${query.slice(0, 40)}"`);
              for (const result of results) {
                const url = (result.url as string) || "";
                const content = String((result.content as string) || "").slice(0, 500);
                if (!url) continue;
                if (isCompanyUrl(url, content)) continue;
                if (insertedTargets.length >= remaining) { limitReached = true; break; }
                const detectedPlatform = detectPlatformFromUrl(url);
                const actualPlatform = detectedPlatform !== "web" ? detectedPlatform : "web";
                const username = extractUsername(url, actualPlatform);
                if (username && username !== "unknown") {
                  const dedupKey = `${actualPlatform}::${username.toLowerCase()}`;
                  if (dedupSet.has(dedupKey)) continue;
                  dedupSet.add(dedupKey);
                  const profileUrl = buildProfileUrl(url, actualPlatform, username);
                  const social = extractSocialFromContent(content);
                  const { error: insertErr } = await getSupabase().from("targets").insert({
                    campaign_id: campaignId, platform: actualPlatform, username,
                    profile_url: profileUrl, post_url: url, post_content: content,
                    match_score: 52, match_reason: `Web検索: ${query.slice(0, 30)}`, status: "pending",
                    ...(social.found_email ? { email: social.found_email } : {}),
                  });
                  if (!insertErr) { insertedTargets.push(username); webInserted++; console.log(`[web] Inserted: ${actualPlatform} @${username}`); }
                }
              }
            } catch (err) { console.error("[web] Tavily error:", err); }
          }
        }
        console.log(`[web] total inserted: ${webInserted}`);
        continue;
      }

      const sitePrefix = PLATFORM_SITE[platform] || "";
      for (const query of searchQueries) {
        if (limitReached) break;
        const fullQuery = sitePrefix ? `${sitePrefix} ${query}` : query;
        try {
          const tavilyResponse = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
            body: JSON.stringify({ query: fullQuery, max_results: 10, search_depth: "basic", topic: "general", include_raw_content: false, start_date: startDate }),
          });
          if (!tavilyResponse.ok) { console.error(`[discovery] Tavily error for "${fullQuery}":`, tavilyResponse.status); continue; }
          const tavilyData = await tavilyResponse.json();
          const rawCount = tavilyData.results?.length || 0;
          const results = filterFreshResults((tavilyData.results || []) as Record<string, unknown>[], sixMonthsAgo);
          console.log(`[search] Tavily "${platform}": ${rawCount} raw → ${results.length} fresh (query: "${fullQuery.slice(0, 60)}")`);
          if (rawCount === 0) console.log("[search] Tavily full response:", JSON.stringify(tavilyData).slice(0, 300));

          for (const result of results) {
            const url = (result.url as string) || "";
            const content = String((result.content as string) || (result.snippet as string) || "").slice(0, 500);
            if (!url) continue;
            if (isCompanyUrl(url, content)) { console.log(`[discovery] Skipped company: ${url.slice(0, 60)}`); continue; }
            if (insertedTargets.length >= remaining) { limitReached = true; break; }

            const detectedPlatform = detectPlatformFromUrl(url);
            // HARD BLOCK: only accept results matching the target platform or from explicitly selected platforms
            if (detectedPlatform !== platform && !platforms.includes(detectedPlatform)) {
              console.log(`[search] Blocked off-platform: ${detectedPlatform} (wanted ${platform}) url: ${url.slice(0, 50)}`);
              continue;
            }
            const actualPlatform = detectedPlatform !== "web" ? detectedPlatform : platform;
            const username = extractUsername(url, actualPlatform);
            if (username && username !== "unknown") {
              const dedupKey = `${actualPlatform}::${username.toLowerCase()}`;
              if (dedupSet.has(dedupKey)) { console.log(`[search] Dedup skip: ${dedupKey}`); continue; }
              dedupSet.add(dedupKey);
              const profileUrl = buildProfileUrl(url, actualPlatform, username);
              const social = extractSocialFromContent(content);
              console.log(`[search] Inserting: ${actualPlatform} @${username}`);
              const { error: insertErr } = await getSupabase().from("targets").insert({
                campaign_id: campaignId, platform: actualPlatform, username,
                profile_url: profileUrl, post_url: url, post_content: content,
                match_score: 55, match_reason: `検索: ${query.slice(0, 30)}`, status: "pending",
                ...(social.found_email ? { email: social.found_email } : {}),
              });
              if (insertErr) { console.error(`[search] Insert error for ${username}:`, insertErr.message); continue; }
              insertedTargets.push(username);
              console.log(`[search] Inserted (${insertedTargets.length}/${remaining}): ${actualPlatform} @${username}`);
            } else {
              console.log(`[search] No username from url: ${url.slice(0, 60)}`);
            }
          }
        } catch (err) { console.error("[discovery] Tavily error:", err); }
      }
      console.log(`[discovery] Progress after ${platform}: ${insertedTargets.length}/${remaining} targets found`);
    }

    // Connpass API discovery (if "connpass" is in selected platforms)
    if (platforms.includes("connpass") && !limitReached) {
      try {
        // Use Claude-generated search queries for connpass too
        for (const keyword of searchQueries.slice(0, 2)) {
          if (limitReached) break;
          console.log(`[connpass] Searching events for: ${keyword}`);
          const connpassRes = await fetch(`https://connpass.com/api/v1/event/?keyword=${encodeURIComponent(keyword)}&count=10&order=2`, {
            signal: AbortSignal.timeout(8000),
          });
          if (!connpassRes.ok) continue;
          const connpassData = await connpassRes.json();
          const events = (connpassData.events || []) as Array<Record<string, unknown>>;
          console.log(`[connpass] Found ${events.length} events for "${keyword}"`);
          for (const event of events.slice(0, 5)) {
            if (insertedTargets.length >= remaining) { limitReached = true; break; }
            const ownerNickname = (event.owner_nickname as string) || "";
            const ownerDisplay = (event.owner_display_name as string) || ownerNickname;
            const eventUrl = event.event_url as string || "";
            const eventDesc = String(event.description || "").replace(/<[^>]+>/g, "").slice(0, 500);
            if (!ownerNickname || ownerNickname === "unknown") continue;
            const dedupKey = `connpass::${ownerNickname.toLowerCase()}`;
            if (dedupSet.has(dedupKey)) continue;
            dedupSet.add(dedupKey);
            const social = extractSocialFromContent(eventDesc);
            const { error: connErr } = await getSupabase().from("targets").insert({
              campaign_id: campaignId, platform: "connpass",
              username: ownerDisplay || ownerNickname,
              profile_url: `https://connpass.com/user/${ownerNickname}/`,
              post_url: eventUrl,
              post_content: `${event.title || ""}\n${eventDesc}`.slice(0, 500),
              match_score: 55, match_reason: `Connpassイベント主催者`, status: "pending",
              ...(social.found_email ? { email: social.found_email } : {}),
            });
            if (connErr) { console.error(`[connpass] Insert error for ${ownerNickname}:`, connErr.message); continue; }
            insertedTargets.push(ownerNickname);
            console.log(`[connpass] Inserted: ${ownerDisplay} (${ownerNickname})`);
          }
        }
      } catch (err) { console.error("[connpass] error:", err); }
    }

    // Google Places API discovery (if "google_maps" is in selected platforms)
    // Required env vars: GOOGLE_PLACES_API_KEY, HUNTER_API_KEY (optional)
    if (platforms.includes("google_maps") && !limitReached) {
      console.log(`[google_maps] Starting. GOOGLE_KEY set: ${!!process.env.GOOGLE_PLACES_API_KEY}`);
      if (!process.env.GOOGLE_PLACES_API_KEY) {
        console.error("[google_maps] GOOGLE_PLACES_API_KEY is not set — skipping");
      } else {
      try {
        // Use productDescription keywords directly — more relevant than area-based queries
        const kw = productDescription.slice(0, 30).trim();
        const b2bQueries = [
          kw,                              // raw product keyword
          `${kw} 会社`,                    // + 会社
          `${kw} IT企業`,                  // + IT企業
          `${kw} スタートアップ`,            // + startup
        ];
        console.log(`[google_maps] B2B queries:`, b2bQueries);
        for (const query of b2bQueries.slice(0, 3)) {
          if (limitReached || insertedTargets.length >= remaining) break;
          console.log(`[google_maps] Searching: ${query}`);
          const placesRes = await fetch(
            `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=ja&key=${process.env.GOOGLE_PLACES_API_KEY}`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (!placesRes.ok) { console.error(`[google_maps] Places API error: ${placesRes.status} for "${query}"`); continue; }
          const placesData = await placesRes.json();
          console.log(`[google_maps] API status: ${placesData.status} for "${query}"`);
          const places = (placesData.results || []) as Array<Record<string, unknown>>;
          console.log(`[google_maps] Found ${places.length} businesses for "${query}"`);
          if (places.length === 0) continue;
          for (const place of places.slice(0, 8)) {
            if (insertedTargets.length >= remaining) { limitReached = true; break; }
            const name = (place.name as string) || "";
            if (!name) continue;
            const dedupKey = `google_maps::${name.toLowerCase()}`;
            if (dedupSet.has(dedupKey)) continue;
            dedupSet.add(dedupKey);
            const placeId = place.place_id as string || "";
            const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${placeId}`;
            const address = (place.formatted_address as string) || "";
            // Get details (phone/website)
            let phone = "";
            let website = "";
            if (placeId) {
              try {
                const detailRes = await fetch(
                  `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${process.env.GOOGLE_PLACES_API_KEY}`,
                  { signal: AbortSignal.timeout(5000) }
                );
                if (detailRes.ok) {
                  const detail = await detailRes.json();
                  phone = (detail.result?.formatted_phone_number as string) || "";
                  website = (detail.result?.website as string) || "";
                  if (website) console.log(`[google_maps] ${name} → website: ${website}`);
                }
              } catch { /* skip details */ }
            }
            // Hunter.io email finder
            let email = "";
            if (website && process.env.HUNTER_API_KEY) {
              try {
                const domain = new URL(website).hostname.replace("www.", "");
                const hunterRes = await fetch(
                  `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=3&api_key=${process.env.HUNTER_API_KEY}`,
                  { signal: AbortSignal.timeout(5000) }
                );
                if (hunterRes.ok) {
                  const hunterData = await hunterRes.json();
                  const emails = (hunterData.data?.emails || []) as Array<{ value: string; confidence: number }>;
                  if (emails.length > 0) {
                    emails.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
                    email = emails[0].value || "";
                    console.log(`[google_maps] Hunter found email for ${domain}: ${email} (confidence: ${emails[0].confidence})`);
                  } else {
                    console.log(`[google_maps] Hunter: no emails found for ${domain}`);
                  }
                }
              } catch (hunterErr) { console.error(`[google_maps] Hunter error:`, hunterErr); }
            }
            const { error: mapsInsertErr } = await getSupabase().from("targets").insert({
              campaign_id: campaignId, platform: "google_maps", username: name,
              profile_url: mapsUrl, post_url: mapsUrl,
              post_content: `${address} ${phone ? `📞 ${phone}` : ""}`.slice(0, 500),
              match_score: email ? 70 : phone ? 55 : 45,
              match_reason: `Googleマップ B2B: ${query.slice(0, 40)}`, status: "pending",
              ...(email ? { email } : {}),
              ...(phone ? { phone } : {}),
              ...(website ? { website } : {}),
            });
            if (mapsInsertErr) { console.error(`[google_maps] Insert error: ${mapsInsertErr.message}`); continue; }
            insertedTargets.push(name);
            console.log(`[google_maps] ✅ Inserted: ${name} email=${email || "none"} phone=${phone || "none"}`);
          }
        } // end B2B queries loop
      } catch (err) { console.error("[google_maps] error:", err); }
      } // end GOOGLE_PLACES_API_KEY check
    }

    console.log(`[step2] Discovery complete: ${insertedTargets.length} targets found`);
    return { targetsFound: insertedTargets.length };
    }); // end step 2

    // ═══ STEP 3: Extract contacts ═══
    await step.run("extract-contacts", async () => {

    // Helper: discover a user's personal website via Tavily search
    const findWebsiteForUser = async (username: string, platform: string, postUrl: string): Promise<string | null> => {
      if (!process.env.TAVILY_API_KEY) return null;
      try {
        // Search for the user's personal site / contact page
        const queries: Record<string, string> = {
          reddit: `reddit user u/${username} site OR contact OR email`,
          twitter: `"${username}" twitter site OR email OR contact -site:twitter.com -site:x.com`,
          connpass: `connpass ${username} github OR ホームページ OR email`,
          wantedly: `wantedly "${username}" 連絡先 OR サイト OR github`,
        };
        const q = queries[platform] || `"${username}" ${platform} contact email site`;
        const tavilyRes = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
          body: JSON.stringify({ query: q, max_results: 3, search_depth: "basic", include_raw_content: false }),
          signal: AbortSignal.timeout(6000),
        });
        if (!tavilyRes.ok) return null;
        const data = await tavilyRes.json();
        const results = (data.results || []) as Array<{ url: string }>;
        const excludedDomains = ['reddit.com','twitter.com','x.com','connpass.com','wantedly.com','note.com','qiita.com','zenn.dev','facebook.com','instagram.com','youtube.com'];
        for (const r of results) {
          try {
            const hostname = new URL(r.url).hostname.toLowerCase();
            if (!excludedDomains.some(d => hostname.includes(d))) {
              console.log(`[contact] Found website for ${username} via Tavily: ${r.url}`);
              return r.url;
            }
          } catch { continue; }
        }
        return null;
      } catch { return null; }
    };

    // Helper: run Hunter.io on a domain
    const hunterLookup = async (websiteUrl: string, username: string): Promise<string | null> => {
      if (!process.env.HUNTER_API_KEY) return null;
      try {
        const domain = new URL(websiteUrl).hostname.replace("www.", "");
        const res = await fetch(
          `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=5&api_key=${process.env.HUNTER_API_KEY}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const emails = (data.data?.emails || []) as Array<{ value: string; confidence: number }>;
        if (emails.length > 0) {
          emails.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
          const best = emails[0];
          console.log(`[contact] Hunter: ${domain} → ${best.value} (conf: ${best.confidence})`);
          return best.value;
        }
        // Also try Hunter email finder if we know the name pattern
        const hunterVerify = await fetch(
          `https://api.hunter.io/v2/email-finder?domain=${domain}&company=${domain}&api_key=${process.env.HUNTER_API_KEY}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (hunterVerify.ok) {
          const vData = await hunterVerify.json();
          if (vData.data?.email) {
            console.log(`[contact] Hunter finder: ${domain} → ${vData.data.email}`);
            return vData.data.email;
          }
        }
      } catch (e) { console.error(`[contact] Hunter error for ${username}:`, e); }
      return null;
    };

    // 公開連絡先情報の抽出（プロフィールページから）
    try {
      const { data: newTargets } = await getSupabase()
        .from("targets")
        .select("id, profile_url, platform, username, email, website, post_url")
        .eq("campaign_id", campaignId)
        .is("contact_url", null)
        .order("match_score", { ascending: false })
        .limit(50); // increased from 15

      if (newTargets && newTargets.length > 0) {
        console.log(`[contact] Processing ${newTargets.length} targets for contact extraction...`);
        let emailsFound = 0;

        // Process sequentially to avoid rate limits
        for (const t of newTargets as Array<{ id: string; profile_url: string | null; platform: string; username: string; email: string | null; website: string | null; post_url: string | null }>) {
          try {
            const profileUrl = buildProfileUrl(t.profile_url || "", t.platform, t.username);
            const updateData: Record<string, unknown> = { contact_url: profileUrl };

            // Skip if already has email
            if (t.email && !t.email.startsWith("Twitter:")) {
              await getSupabase().from("targets").update(updateData).eq("id", t.id);
              continue;
            }

            // Step A: Scrape profile page via Jina
            const info = await extractContactInfo(profileUrl, t.platform);
            if (info.email) updateData.email = info.email;
            if (info.website) updateData.website = info.website;
            if (info.phone) updateData.phone = info.phone;

            // Step B: If no email yet, try to discover their personal website
            let websiteUrl = info.website || (t.website as string | null);
            if (!updateData.email && !websiteUrl) {
              websiteUrl = await findWebsiteForUser(t.username, t.platform, t.post_url || profileUrl);
              if (websiteUrl) updateData.website = websiteUrl;
            }

            // Step C: Run Hunter.io on discovered website
            if (!updateData.email && websiteUrl) {
              const hunterEmail = await hunterLookup(websiteUrl, t.username);
              if (hunterEmail) {
                updateData.email = hunterEmail;
                emailsFound++;
              }
            }

            if (updateData.email) {
              emailsFound++;
              console.log(`[contact] ✅ ${t.platform} @${t.username} → ${updateData.email}`);
            } else {
              console.log(`[contact] ❌ ${t.platform} @${t.username} → no email found`);
            }

            await getSupabase().from("targets").update(updateData).eq("id", t.id);
          } catch (tErr) { console.error(`[contact] Error for ${t.username}:`, tErr); }
        }
        console.log(`[contact] Complete: ${emailsFound} emails found from ${newTargets.length} targets`);
      }
    } catch (e) {
      console.error("Contact extraction error:", e);
    }
    }); // end step 3

    // ═══ STEP 4: AI scoring ═══
    await step.run("score-targets", async () => {

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
            FirecrawlApp = firecrawlModule.default || (firecrawlModule as any).FirecrawlAppV1 || (firecrawlModule as any).FirecrawlApp;
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

            const scoreProdDesc = productDescription || "";
            // Detect if this looks like a company/corporate post
            const looksLikeCompany = /株式会社|合同会社|公式|サービス|ソリューション|press|release/.test(enrichedContent.slice(0, 300));
            const isPersonalPlatform = ["note", "qiita", "zenn", "twitter", "reddit", "wantedly", "connpass"].includes(t.platform);

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
                temperature: 0.3,
                system: `You must respond with valid JSON only. No markdown, no explanation. Start with { and end with }.
重要ルール:
- スコアは必ず差をつけてください。全員に同じスコアをつけることは禁止です。
- 企業ブログや会社の公式記事の場合、q3_scoreは必ず0にしてください。
- 「困っている」「探している」の直接的表現がない限り、q1_scoreを7以上にしないでください。
- 一般的な技術記事やノウハウ共有は q1=3, q2=3 程度です。`,
                messages: [
                  {
                    role: "user",
                    content: `βテスター候補を厳密に評価してください。${looksLikeCompany ? "\n⚠️ この投稿は企業・法人の可能性が高いです。個人でない場合はq3=0にしてください。" : ""}

プロダクト: ${scoreProdDesc}
投稿者: ${t.username} (${t.platform})
投稿内容: ${enrichedContent.slice(0, 500)}

Q1. 課題の深さ (0-10):
  0: プロダクトと全く無関係
  2-3: 関連分野だが課題を抱えている証拠なし（ノウハウ記事、一般論）
  5-6: 課題に言及しているが解決策を探していない
  8-9: 「困っている」「探している」「やりたい」と明確に表現
  10: 「今すぐ解決したい」「ツールを探している」と緊急性がある

Q2. 試す意欲 (0-10):
  0: 意欲が全く読み取れない
  2-3: 既存ツールに満足、保守的
  5-6: 新しい技術への関心はあるが積極的ではない
  8-9: 「試したい」「使ってみたい」と表現
  10: βテストや新サービスに積極的に参加する人

Q3. 接触可能性 (0-5):
  0: 企業アカウント/ボット/連絡不可${!isPersonalPlatform ? " ← 個人プラットフォームではないため注意" : ""}
  1-2: アカウントはあるが連絡手段不明
  3-4: 個人アカウントでアクティブ
  5: SNSリンクやメールが公開されている

JSONのみ:
{"q1_score":0,"q2_score":0,"q3_score":0,"reason":"日本語1文","estimated_age":"20代/30代/40代/不明","estimated_role":"職種"}`,
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
              const q1 = Math.min(10, Math.max(0, score.q1_score || 0));
              const q2 = Math.min(10, Math.max(0, score.q2_score || 0));
              const q3 = Math.min(5, Math.max(0, score.q3_score || 0));
              const totalScore = Math.min(100, Math.max(0, (q1 + q2 + q3) * 4));

              const priority = totalScore >= 65 ? "S" : totalScore >= 50 ? "A" : totalScore >= 35 ? "B" : "C";

              const updateData = {
                match_score: totalScore,
                q1_score: q1,
                q2_score: q2,
                q3_score: q3,
                relevance_score: q1,
                intent_score: q2,
                influence_score: q3,
                accessibility_score: q3,
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
                const belowThreshold = totalScore < minMatchScore;
                console.log(`[scoring] ✅ ${t.username}: ${priority} (${totalScore}%) [Q1:${q1} Q2:${q2} Q3:${q3}]${belowThreshold ? ` (below ${minMatchScore}%)` : ""}`);
              }
            } else {
              console.log(`[scoring] No valid JSON in response for ${t.username}, setting C`);
              await getSupabase().from("targets").update({ priority: "C", status: "scored", q1_score: 0, q2_score: 0, q3_score: 0, relevance_score: 0, intent_score: 0, influence_score: 0, accessibility_score: 0 }).eq("id", t.id);
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
    }); // end step 4

    return { success: true, campaignId, targetsFound: discoveryResult?.targetsFound || 0 };
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
