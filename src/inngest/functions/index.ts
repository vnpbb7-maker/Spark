// Deploy: 1747196705 — cache bust
import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";
import { getUserPlan, PLAN_LIMITS } from "@/lib/plan-limits";

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

// 強化版: プロフィール → 公開コミット履歴の順でメールを取得
async function getEmailFromGitHub(username: string): Promise<string | null> {
  if (!username) return null;
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'SPARK-Discovery' };
  if (token) headers['Authorization'] = `token ${token}`;
  try {
    // 1. プロフィールから取得
    const profileRes = await fetch(`https://api.github.com/users/${username}`, { headers, signal: AbortSignal.timeout(4000) });
    if (profileRes.ok) {
      const data = await profileRes.json();
      const email = data.email as string | null;
      if (email && !email.includes('noreply') && !email.includes('users.noreply')) {
        console.log(`[github] Profile email for ${username}: ${email}`);
        return email;
      }
    }
    // 2. 公開コミット履歴から取得
    const eventsRes = await fetch(`https://api.github.com/users/${username}/events/public?per_page=30`, { headers, signal: AbortSignal.timeout(4000) });
    if (eventsRes.ok) {
      const events = await eventsRes.json() as Array<Record<string, unknown>>;
      for (const event of events) {
        if (event.type === 'PushEvent') {
          const commits = (event.payload as Record<string, unknown>)?.commits as Array<Record<string, unknown>> | undefined;
          const commitEmail = commits?.[0]?.author as Record<string, string> | undefined;
          const email = commitEmail?.email;
          if (email && !email.includes('noreply') && !email.includes('users.noreply')) {
            console.log(`[github] Commit email for ${username}: ${email}`);
            return email;
          }
        }
      }
    }
  } catch (e) { console.warn(`[github] getEmailFromGitHub error for ${username}:`, e); }
  return null;
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

// Filter: require minimum 10% Japanese characters in content or title
function isJapanese(text: string): boolean {
  if (!text || text.length === 0) return false;
  const jpChars = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  return jpChars / text.length > 0.1;
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
    case "google_maps": {
      // Google Mapsプラットフォームではwebsiteを返す。place_id URLはフォーム送信に使えない
      // profile_urlがmaps/place_idを含む場合はnull相当の空文字を返す
      if (url && !url.includes("google.com/maps") && !url.includes("place_id")) return url;
      return ""; // websiteはcontact更新フェーズで別途処理
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
  // Intent-signal word banks — pick randomly each run for variety
  const painWords = ["困ってる", "悩んでる", "うまくいかない", "課題", "どうすれば"];
  const discoveryWords = ["おすすめ", "探してる", "教えてください", "使ってみたい", "比較"];
  const actionWords = ["βテスト", "試してみた", "導入したい", "検討中"];
  const exclude = "-プレスリリース -サービス紹介 -お知らせ";

  // Pick random intent words each run
  const pain1 = painWords[Math.floor(Math.random() * painWords.length)];
  const pain2 = painWords[Math.floor(Math.random() * painWords.length)];
  const disc1 = discoveryWords[Math.floor(Math.random() * discoveryWords.length)];
  const disc2 = discoveryWords[Math.floor(Math.random() * discoveryWords.length)];
  const action1 = actionWords[Math.floor(Math.random() * actionWords.length)];

  const queries: { query: string; targetPlatform: string }[] = [];

  // Social — pain + discovery signals
  queries.push({ query: `site:twitter.com OR site:x.com ${keyword} (${pain1} OR ${disc1}) -is:retweet`, targetPlatform: "twitter" });

  // note — pain signal queries
  // Noteは高品質リードが少ないため発見対象から除外
  // queries.push({ query: `site:note.com ${keyword} ${pain1} OR ${pain2} ${exclude}`, targetPlatform: "note" });

  // Zenn — discovery + action
  queries.push({ query: `site:zenn.dev ${keyword} ${disc1} OR ${action1}`, targetPlatform: "zenn" });

  // Qiita — 連絡手段なし（GitHubメール取得が不安定）のため除外
  // queries.push({ query: `site:qiita.com ${keyword} ${pain1} OR ${disc2}`, targetPlatform: "qiita" });

  // はてな — discovery signal
  queries.push({ query: `site:hatenablog.com OR site:hatena.ne.jp ${keyword} ${disc1} OR ${pain2}`, targetPlatform: "hatena" });

  // Yahoo知恵袋 — naturally pain-focused
  queries.push({ query: `site:detail.chiebukuro.yahoo.co.jp ${keyword} ${pain1} OR ${disc1} OR 困って`, targetPlatform: "yahoo_qa" });

  // General web — action + discovery intent
  queries.push({ query: `${keyword} ${disc1} OR ${action1} 日本語 ${exclude}`, targetPlatform: "web" });

  // Reddit
  queries.push({ query: `site:reddit.com ${keyword} (${pain1} OR ${disc1}) 日本`, targetPlatform: "reddit" });

  // Wantedly — pain/challenge signals
  queries.push({ query: `site:wantedly.com ${keyword} ${pain1} OR 課題 OR 困っている`, targetPlatform: "wantedly" });

  // ProductHunt — action signal (English)
  queries.push({ query: `site:producthunt.com ${keyword} (review OR alternative OR "looking for")`, targetPlatform: "producthunt" });

  // Peatix — event-based discovery
  queries.push({ query: `site:peatix.com ${keyword} ${disc1} OR イベント OR セミナー`, targetPlatform: "peatix" });

  // Discord — community discovery
  queries.push({ query: `site:discord.gg OR site:discord.com ${keyword} ${disc1} OR community OR 日本`, targetPlatform: "discord" });

  // Shuffle for variety across runs
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
    console.log("[discover] START campaign_id:", campaignId);

    return await step.run("run-full-discovery", async () => {
    console.log("[discover] step.run ENTERED campaign_id:", campaignId);

    // 1. キャンペーン取得
    const { data: campaign, error: campErr } = await getSupabase()
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();
    console.log("[step1] campaign found:", !!campaign, "error:", campErr?.message || "none", "platforms:", campaign?.platforms);

    if (!campaign) {
      console.log("[step1] campaign not found, aborting");
      await getSupabase().from("campaigns").update({ status: "completed" }).eq("id", campaignId);
      return { error: "Campaign not found" };
    }

    // 2. Per-campaign target limit — plan-based
    const userId = campaign.user_id as string;
    const { plan, isAdmin, limits } = await getUserPlan(getSupabase(), userId);
    console.log(`[discover] userId=${userId} plan=${plan} isAdmin=${isAdmin} maxTargets=${limits.maxTargetsPerCampaign}`);

    // キャンペーン設定のdaily_limitかプラン上限の小さい方を使用（管理者は無制限）
    const campaignLimit = isAdmin
      ? (campaign.daily_limit || 1000)
      : Math.min(campaign.daily_limit || 50, limits.maxTargetsPerCampaign);

    const { count } = await getSupabase()
      .from("targets")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId);
    const existingCount = count || 0;
    const remaining = campaignLimit - existingCount;
    if (existingCount >= campaignLimit) {
      console.log(`[discover] Campaign limit reached: ${existingCount}/${campaignLimit} (plan=${plan})`);
      await getSupabase().from("campaigns").update({ status: "completed" }).eq("id", campaignId);
      return { error: "Campaign limit reached" };
    }
    const minMatchScore = (campaign.min_match_score as number) || 50;
    console.log(`[discover] Campaign ${campaignId}: ${existingCount}/${campaignLimit} targets, remaining: ${remaining}, minMatchScore: ${minMatchScore}`);

    // 2b. Cross-campaign deduplication: SNS/Webターゲットのみ7日間排除（google_mapsは除外）
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
      .neq("platform", "google_maps")   // google_mapsはクロスキャンペーンdedup対象外
      .gte("created_at", sevenDaysAgo);

    const dedupSet = new Set<string>();
    (existingTargetRows || []).forEach((t: { username: string; platform: string }) => {
      dedupSet.add(`${t.platform}::${t.username.toLowerCase()}`);
    });
    console.log(`[dedup] Loaded ${dedupSet.size} existing SNS/Web targets from last 7 days (google_maps excluded from cross-campaign dedup)`);

    // 3. Generate problem-focused search queries via Claude
    // platforms: DB に文字列 '["zenn","wantedly"]' として保存されている場合も対応
    let platforms: string[] = [];
    if (Array.isArray(campaign.platforms)) {
      platforms = (campaign.platforms as string[]).map((p: string) => p.toLowerCase().trim());
    } else if (typeof campaign.platforms === "string" && campaign.platforms.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(campaign.platforms);
        if (Array.isArray(parsed)) platforms = parsed.map((p: string) => String(p).toLowerCase().trim());
      } catch { /* keep empty */ }
    }
    console.log("[discover] parsed platforms:", JSON.stringify(platforms));


    // target_personas may be stored as array OR as object { personas: [...] }
    const rawPersonas = campaign.target_personas;
    let targetPersonas: Array<Record<string, unknown>> = [];
    if (Array.isArray(rawPersonas)) {
      targetPersonas = rawPersonas as Array<Record<string, unknown>>;
    } else if (rawPersonas && typeof rawPersonas === "object" && Array.isArray((rawPersonas as Record<string, unknown>).personas)) {
      targetPersonas = (rawPersonas as Record<string, unknown>).personas as Array<Record<string, unknown>>;
    }
    console.log("[step1] platforms:", platforms, "personas count:", targetPersonas.length);

    // Fix: productDescription might be a URL — prefer personas data instead
    let productDescription = (campaign.product_description as string) || "";
    const isUrl = productDescription.startsWith("http");
    if (isUrl) {
      const rawP = campaign.target_personas as Record<string, unknown> | null;
      const positioning = rawP?.positioning as string || "";
      const firstPainScene = (targetPersonas[0]?.pain_scene as string) || "";
      productDescription = positioning || firstPainScene || productDescription;
      console.log("[step1] productDescription was URL, using personas fallback:", productDescription.slice(0, 80));
    }

    // Extract pain_scene and discovery_signals from personas (guarded)
    const painScenes = Array.isArray(targetPersonas)
      ? targetPersonas.map(p => (p.pain_scene as string) || "").filter(Boolean).join(" / ")
      : "";
    const discoverySignals = Array.isArray(targetPersonas)
      ? targetPersonas.flatMap(p => Array.isArray(p.discovery_signals) ? (p.discovery_signals as string[]) : []).filter(Boolean).slice(0, 5).join(", ")
      : "";
    // Limit context length to avoid truncation in Claude prompt
    const painSummary = painScenes.substring(0, 200);
    const personaContext = painSummary || productDescription.substring(0, 200);
    console.log("[step1] personaContext:", personaContext.slice(0, 100), "| signals:", discoverySignals.slice(0, 80));
    console.log("[discovery] User selected platforms:", JSON.stringify(platforms));


    // Generate search queries focused on PEOPLE WITH PROBLEMS (not product descriptions)
    let searchQueries: string[] = [];
    const fallbackQueries = [
      "βテスター 募集 方法",
      "初期ユーザー 獲得 難しい",
      "プロダクト ユーザー 見つからない",
      "スタートアップ 最初のユーザー",
      "新サービス テスター 探してる",
    ];
    try {
      const queryGenRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001", max_tokens: 400, temperature: 0.8,
          system: "You generate Japanese search queries. Return ONLY a JSON array of 5 short Japanese strings. No explanation, no other text.",
          messages: [{ role: "user", content:
`Product solves: ${productDescription.substring(0, 100)}
Target pain: ${painSummary.substring(0, 100)}

Generate 5 short Japanese search queries (5-15 words each) that find people WHO HAVE THIS PROBLEM RIGHT NOW.
Queries must be natural Japanese phrases, NOT copied from the pain description above.
Examples: "βテスター どこで募集すればいい" / "初期ユーザー集めるの時間かかりすぎ" / "新サービス 使ってくれる人 見つからない"

Return ONLY this JSON format (no markdown, no explanation):
["query1", "query2", "query3", "query4", "query5"]` }],
        }),
      });
      if (queryGenRes.ok) {
        const queryGenData = await queryGenRes.json();
        const text = (queryGenData.content?.[0]?.text || "").trim();
        console.log("[step1] Claude raw response:", text.slice(0, 200));
        // Try parsing as bare array first, then as {queries:[]} object
        try {
          const arrMatch = text.match(/\[[\s\S]*\]/);
          if (arrMatch) {
            const parsed = JSON.parse(arrMatch[0]);
            if (Array.isArray(parsed)) {
              searchQueries = parsed.filter((q: unknown) => typeof q === "string" && q.trim().length > 0);
            }
          }
        } catch { /* try object format below */ }
        if (searchQueries.length === 0) {
          const objMatch = text.match(/\{[\s\S]*\}/);
          if (objMatch) {
            const parsed = JSON.parse(objMatch[0]);
            const arr = parsed.queries || parsed.results || [];
            searchQueries = arr.filter((q: unknown) => typeof q === "string" && q.trim().length > 0);
          }
        }
      } else {
        console.error("[step1] Claude API error:", queryGenRes.status, await queryGenRes.text().catch(() => ""));
      }
    } catch (e) { console.error("[discovery] Query generation error:", e); }

    // Fallback if Claude fails or returns empty
    if (searchQueries.length === 0) {
      console.log("[step1] Claude returned no queries, using fallbacks");
      searchQueries = fallbackQueries;
    }
    // Safety: ensure searchQueries is always a plain string array before returning
    if (!Array.isArray(searchQueries)) searchQueries = [];
    searchQueries = searchQueries.filter((q: unknown) => typeof q === "string" && q.trim().length > 0);

    // Inject user-supplied search keywords (required_keywords) into Tavily queries
    const userKeywords = (campaign.required_keywords as string) || "";
    if (userKeywords.trim()) {
      const keywordList = userKeywords.split(",").map((k: string) => k.trim()).filter(Boolean);
      if (keywordList.length > 0) {
        const intentWords = "困ってる OR 探してる OR おすすめ OR 比較 OR 課題";
        // Add one dedicated user-keyword query
        searchQueries.push(`${keywordList.join(" ")} ${intentWords}`);
        // Prepend top keyword to existing queries for bias
        const topKw = keywordList[0];
        searchQueries = searchQueries.map((q: string) =>
          q.startsWith(topKw) ? q : `${topKw} ${q}`
        );
        console.log(`[step1] Injected user keywords: ${keywordList.join(", ")} → ${searchQueries.length} queries`);
      }
    }

    console.log("[step1] searchQueries type:", typeof searchQueries, "isArray:", Array.isArray(searchQueries));
    console.log("[step1] pain context:", personaContext.slice(0, 80));
    console.log("[step1] generated queries:", searchQueries.length, searchQueries);
    console.log("[phase2] START platforms:", platforms, "queries:", searchQueries.length, "remaining:", remaining);
    const insertedTargets: string[] = [];
    let limitReached = false;

    console.log("[phase2] START platforms:", platforms, "queries:", searchQueries.length, "remaining:", remaining);
    console.log("[phase2] TAVILY_KEY set:", !!process.env.TAVILY_API_KEY);
    console.log("[phase2] GOOGLE_KEY set:", !!process.env.GOOGLE_PLACES_API_KEY);

    // 6-month freshness
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const startDate = sixMonthsAgo.toISOString().split("T")[0];

    // Platform-specific site prefixes
    const PLATFORM_SITE: Record<string, string> = {
      twitter: "site:x.com OR site:twitter.com",
      reddit: "site:reddit.com",
      note: "site:note.com",
      // qiita: "site:qiita.com",  // 除外
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
      console.log(`[phase2] user selected platforms: ${JSON.stringify(platforms)}`);
      console.log(`[step2] processing platform: ${platform} (inserted: ${insertedTargets.length}/${remaining})`);

      // Skip platforms handled separately below (connpass, google_maps, zenn, wantedly, prtimes)
      if (platform === "connpass" || platform === "google_maps" || platform === "zenn" || platform === "wantedly" || platform === "prtimes") {
        console.log(`[phase2] Skipping "${platform}" in generic loop — handled by dedicated handler below`);
        continue;
      }

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

      // "web" platform: only search sites the user has also selected (or core web platforms)
      if (platform === "web") {
        // Build allowed site prefixes: only include community sites if that platform is selected
        const ALL_WEB_SITES: Record<string, string> = {
          note:      "site:note.com",
          // qiita: "site:qiita.com",  // 除外
          zenn:      "site:zenn.dev",
          reddit:    "site:reddit.com",
          yahoo_qa:  "site:detail.chiebukuro.yahoo.co.jp",
          hatena:    "site:hatenablog.com OR site:hatenadiary.com",
          wantedly:  "site:wantedly.com",
        };
        // Only search sites the user explicitly selected; always allow yahoo_qa for web
        const webSites: string[] = [];
        for (const [sitePlatform, sitePrefix] of Object.entries(ALL_WEB_SITES)) {
          if (platforms.includes(sitePlatform) || sitePlatform === "yahoo_qa") {
            webSites.push(sitePrefix);
          }
        }
        // If no community sites selected, search without site restriction
        if (webSites.length === 0) webSites.push("");
        console.log(`[web] searching with site prefixes: ${JSON.stringify(webSites)}`);
        let webInserted = 0;
        for (const sitePfx of webSites) {
          if (limitReached || webInserted >= 4) break;
          for (const query of searchQueries.slice(0, 2)) {
            if (limitReached) break;
            const fullQuery = sitePfx ? `${sitePfx} ${query}` : query;
            try {
              const tavilyResponse = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
                body: JSON.stringify({ query: fullQuery, max_results: 8, search_depth: "basic", topic: "general", include_raw_content: false, start_date: startDate }),
              });
              if (!tavilyResponse.ok) { console.error(`[web] Tavily error for "${fullQuery}":`, tavilyResponse.status); continue; }
              const tavilyData = await tavilyResponse.json();
              const results = filterFreshResults((tavilyData.results || []) as Record<string, unknown>[], sixMonthsAgo);
              console.log(`[web] ${sitePfx || "(no site)"}:  ${results.length} results for "${query.slice(0, 40)}"`);
              for (const result of results) {
                const url = (result.url as string) || "";
                const content = String((result.content as string) || "").slice(0, 500);
                const title = String((result.title as string) || "");
                if (!url) continue;
                if (isCompanyUrl(url, content)) continue;
                // JP filter: skip English-only content
                if (!isJapanese(content) && !isJapanese(title)) {
                  console.log(`[web] ⏭️ Non-JP content skipped: ${url.slice(0, 60)}`);
                  continue;
                }
                if (insertedTargets.length >= remaining) { limitReached = true; break; }
                const detectedPlatform = detectPlatformFromUrl(url);
                console.log(`[web] detected platform for ${url.slice(0, 60)}: ${detectedPlatform}`);
                // STRICT FILTER: if result is from a specific platform the user did NOT select, skip it
                if (detectedPlatform !== "web" && !platforms.includes(detectedPlatform)) {
                  console.log(`[web] Skipping ${url.slice(0, 60)} — platform "${detectedPlatform}" not in user selection ${JSON.stringify(platforms)}`);
                  continue;
                }
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
            const title = String((result.title as string) || "");
            if (!url) continue;
            if (isCompanyUrl(url, content)) { console.log(`[discovery] Skipped company: ${url.slice(0, 60)}`); continue; }
            // JP filter: skip English-only content
            if (!isJapanese(content) && !isJapanese(title)) {
              console.log(`[discovery] ⏭️ Non-JP content skipped: ${url.slice(0, 60)}`);
              continue;
            }
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
            // GitHub経由でメール取得（owner_nicknameをGitHubユーザー名として試みる）
            let email = social.found_email || "";
            if (!email) {
              const ghEmail = await getEmailFromGitHub(ownerNickname);
              if (ghEmail) email = ghEmail;
            }
            const { error: connErr } = await getSupabase().from("targets").insert({
              campaign_id: campaignId, platform: "connpass",
              username: ownerDisplay || ownerNickname,
              profile_url: `https://connpass.com/user/${ownerNickname}/`,
              post_url: eventUrl,
              post_content: `${event.title || ""}\n${eventDesc}`.slice(0, 500),
              match_score: email ? 70 : 55,
              match_reason: `Connpassイベント主催者${email ? "（メール取得済み）" : ""}`, status: "pending",
              ...(email ? { email } : {}),
            });
            if (connErr) { console.error(`[connpass] Insert error for ${ownerNickname}:`, connErr.message); continue; }
            insertedTargets.push(ownerNickname);
            console.log(`[connpass] Inserted: ${ownerDisplay} email=${email || "none"}`);
          }
        }
      } catch (err) { console.error("[connpass] error:", err); }
    }

    // ── 専用ハンドラ到達確認ログ ──
    console.log('[discover] === dedicated handlers START ===');
    console.log('[discover] platforms:', JSON.stringify(platforms));
    console.log('[discover] has connpass:', platforms.includes('connpass'));
    console.log('[discover] has zenn:', platforms.includes('zenn'));
    console.log('[discover] has wantedly:', platforms.includes('wantedly'));
    console.log('[discover] limitReached:', limitReached, 'inserted:', insertedTargets.length, '/', remaining);
    console.log('[discover] TAVILY_API_KEY set:', !!process.env.TAVILY_API_KEY);
    console.log('[discover] GITHUB_TOKEN set:', !!process.env.GITHUB_TOKEN);

    // ── Zenn 専用ハンドラ（Tavily → GitHub API でメール取得）──
    console.log('[zenn] block executing, platforms includes zenn:', platforms.includes('zenn'));
    if (platforms.includes("zenn") && !limitReached && process.env.TAVILY_API_KEY) {
      try {
        const zennKeyword = searchQueries[0] || productDescription.slice(0, 40);
        const zennQueries = [
          `site:zenn.dev ${zennKeyword} 困ってる OR 試してみた OR 探してる`,
          `site:zenn.dev ${zennKeyword} 課題 OR 解決策`,
        ];
        for (const query of zennQueries) {
          if (limitReached) break;
          console.log(`[zenn] Tavily search: "${query}"`);
          const tavilyRes = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic", max_results: 8, include_domains: ["zenn.dev"] }),
            signal: AbortSignal.timeout(10000),
          });
          if (!tavilyRes.ok) continue;
          const tavilyData = await tavilyRes.json();
          const results = (tavilyData.results || []) as Array<Record<string, unknown>>;
          console.log(`[zenn] ${results.length} results`);
          for (const result of results) {
            if (insertedTargets.length >= remaining) { limitReached = true; break; }
            const url = (result.url as string) || "";
            if (!url.includes("zenn.dev")) continue;
            // Extract Zenn username from URL: zenn.dev/username/articles/...
            const zennMatch = url.match(/zenn\.dev\/([a-zA-Z0-9_-]+)/);
            if (!zennMatch) continue;
            const zennUsername = zennMatch[1];
            if (["articles", "books", "topics", "tech"].includes(zennUsername)) continue;
            const dedupKey = `zenn::${zennUsername.toLowerCase()}`;
            if (dedupSet.has(dedupKey)) continue;
            dedupSet.add(dedupKey);
            // GitHub経由でメール取得
            // ZennプロフィールページからGitHubユーザー名を確認（Zenn名≠GitHub名の場合に対応）
            let githubUsername = zennUsername;
            try {
              const profileRes = await fetch(`https://r.jina.ai/https://zenn.dev/${zennUsername}`, {
                headers: { Accept: "text/plain" }, signal: AbortSignal.timeout(5000),
              });
              if (profileRes.ok) {
                const profileText = await profileRes.text();
                const ghMatch = profileText.match(/github\.com\/([a-zA-Z0-9_-]+)/);
                if (ghMatch && ghMatch[1]) {
                  githubUsername = ghMatch[1];
                  console.log(`[zenn] GitHub username for ${zennUsername}: ${githubUsername}`);
                }
              }
            } catch { /* keep zennUsername as fallback */ }
            const ghEmail = await getEmailFromGitHub(githubUsername);
            console.log(`[zenn] ${zennUsername} → GitHub:${githubUsername} email:${ghEmail || "none"}`);
            const { error: zennErr } = await getSupabase().from("targets").insert({
              campaign_id: campaignId, platform: "zenn",
              username: zennUsername,
              profile_url: `https://zenn.dev/${zennUsername}`,
              post_url: url,
              post_content: ((result.content as string) || "").slice(0, 500),
              match_score: ghEmail ? 72 : 55,
              match_reason: `Zennエンジニア${ghEmail ? "（GitHub経由メール取得）" : ""}`,
              status: "pending",
              ...(ghEmail ? { email: ghEmail } : {}),
            });
            if (zennErr) { console.error(`[zenn] Insert error for ${zennUsername}:`, zennErr.message); continue; }
            insertedTargets.push(zennUsername);
            console.log(`[zenn] Inserted: ${zennUsername} email=${ghEmail || "none"}`);
          }
        }
      } catch (err) { console.error("[zenn] error:", err); }
    }

    // ── Wantedly 専用ハンドラ（Tavily → 企業websiteURL → Playwright フォーム送信）──
    console.log('[wantedly] block executing, platforms includes wantedly:', platforms.includes('wantedly'));
    if (platforms.includes("wantedly") && !limitReached && process.env.TAVILY_API_KEY) {
      try {
        // ── Step 1: Claudeでターゲット職種・業種を推論 ──
        let wantedlyQueries: string[] = [];
        let wantedlyTargetProfile: Record<string, unknown> | null = null;
        const productName = (campaign?.product_name as string) || productDescription.slice(0, 30);
        if (process.env.ANTHROPIC_API_KEY) {
          try {
            const inferRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 400,
                system: "You must respond with valid JSON only. No markdown, no explanation. Start with { and end with }.",
                messages: [{
                  role: "user",
                  content: `あなたはBtoBセールスの専門家です。
以下の商品・サービスを導入したい企業をWantedlyで探します。

商品: ${productName}
商品説明: ${productDescription}

以下をJSON形式で出力してください：
{
  "target_profile": {
    "industries": ["業種1", "業種2"],
    "company_size": "スタートアップ〜中小",
    "pain_points": ["課題1", "課題2"]
  },
  "wantedly_queries": [
    "検索ワード1",
    "検索ワード2",
    "検索ワード3"
  ],
  "reason": "なぜこの条件の会社が困っているか（1文）"
}

ルール：
- wantedly_queriesは採用職種名で（例：「カスタマーサポート」「営業企画」）
- 商品が解決する課題を抱えてそうな部門を採用している会社を狙う
- クエリは3〜5個`,
                }],
              }),
              signal: AbortSignal.timeout(10000),
            });
            if (inferRes.ok) {
              const inferData = await inferRes.json();
              const inferText = inferData.content?.[0]?.text || "";
              const jsonMatch = inferText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const rawQueries: string[] = Array.isArray(parsed.wantedly_queries) ? parsed.wantedly_queries : [];
                wantedlyTargetProfile = parsed.target_profile || {};
                const reason = (parsed.reason as string) || "";
                console.log(`[wantedly] Claude queries: ${rawQueries.join(", ")}`);
                console.log(`[wantedly] reason: ${reason}`);
                console.log(`[wantedly] industries: ${JSON.stringify(wantedlyTargetProfile?.industries)} size: ${(wantedlyTargetProfile as Record<string,unknown>)?.company_size}`);
                // wantedly_queriesをTavily検索クエリに変換（採用職種名 → サイト検索）
                wantedlyQueries = rawQueries.slice(0, 5).map((q: string) => `site:wantedly.com ${q} 採用 募集`);
                // target_profileとreasonをキャンペーンに保存（メッセージ生成にも活用）
                try {
                  // wantedly_target_profile カラムがない場合は ai_notes に JSON 保存
                  const updatePayload: Record<string, unknown> = { wantedly_reason: reason };
                  try { updatePayload.wantedly_target_profile = wantedlyTargetProfile; } catch { /* noop */ }
                  await getSupabase().from("campaigns").update(updatePayload).eq("id", campaignId);
                  console.log(`[wantedly] Saved target_profile to campaign ${campaignId}`);
                } catch { console.warn("[wantedly] Campaign update failed (column may not exist)"); }
              }
            }
          } catch (claudeErr) {
            console.warn("[wantedly] Claude inference failed, using fallback:", claudeErr);
          }
        }
        // フォールバック: プロダクト説明ベースのシンプルクエリ
        if (wantedlyQueries.length === 0) {
          const fallbackKw = searchQueries[0] || productDescription.slice(0, 30);
          wantedlyQueries = [
            `site:wantedly.com ${fallbackKw} 採用`,
            `site:wantedly.com/companies ${fallbackKw} 募集中`,
          ];
        }
        console.log(`[wantedly] queries (${wantedlyQueries.length}):`, wantedlyQueries);

        // ── Step 2: Tavilyで検索 ──
        for (const query of wantedlyQueries) {
          if (limitReached) break;
          console.log(`[wantedly] Tavily search: "${query}"`);
          const tavilyRes = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic", max_results: 8, include_domains: ["wantedly.com"] }),
            signal: AbortSignal.timeout(10000),
          });
          if (!tavilyRes.ok) continue;
          const tavilyData = await tavilyRes.json();
          const results = (tavilyData.results || []) as Array<Record<string, unknown>>;
          console.log(`[wantedly] ${results.length} results`);
          for (const result of results) {
            if (insertedTargets.length >= remaining) { limitReached = true; break; }
            const url = (result.url as string) || "";
            if (!url.includes("wantedly.com")) continue;
            // Extract company slug from URL: wantedly.com/companies/companyname
            const companyMatch = url.match(/wantedly\.com\/companies\/([a-zA-Z0-9_-]+)/);
            if (!companyMatch) continue;
            const companySlug = companyMatch[1];
            const dedupKey = `wantedly::${companySlug.toLowerCase()}`;
            if (dedupSet.has(dedupKey)) continue;
            dedupSet.add(dedupKey);

            // ── Jina Readerで企業ページから会社名・公式サイトURLを取得 ──
            const wantedlyPageUrl = `https://www.wantedly.com/companies/${companySlug}`;
            let companyName = companySlug; // フォールバック
            let officialWebsite: string | null = null;
            try {
              const jinaRes = await fetch(`https://r.jina.ai/${wantedlyPageUrl}`, {
                headers: { Accept: "text/plain" },
                signal: AbortSignal.timeout(8000),
              });
              if (jinaRes.ok) {
                const md = await jinaRes.text();
                // OGタイトル / h1 から会社名を取得
                // Jina Readerはページのtitleを先頭に出力する傾向がある
                const titleMatch = md.match(/^(?:Title:|#\s*)(.+)/m)
                  || md.match(/^(.{2,40}(?:株式会社|合同会社|Inc\.|Co\.,|Ltd\.|LLC)[^\n]*)/m)
                  || md.match(/^(.{2,40})\n/m);
                if (titleMatch) {
                  const raw = titleMatch[1].replace(/[|\-–—].*$/, "").replace(/Wantedly.*$/i, "").trim();
                  if (raw.length >= 2 && raw.length <= 50) companyName = raw;
                }
                // 公式サイトURLを抽出（wantedly/SNS/汎用ドメインを除外）
                const EXCLUDED = ["wantedly.com", "twitter.com", "x.com", "facebook.com", "instagram.com", "linkedin.com", "youtube.com", "line.me", "t.co", "apple.com", "google.com"];
                const urlPattern = /https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})[^\s"')>\]<]*/g;
                let m: RegExpExecArray | null;
                while ((m = urlPattern.exec(md)) !== null) {
                  const domain = m[1].toLowerCase();
                  if (!EXCLUDED.some(ex => domain.includes(ex))) {
                    officialWebsite = m[0].replace(/[.、。）\]]+$/, "");
                    break;
                  }
                }
                console.log(`[wantedly] Jina: name="${companyName}" site="${officialWebsite || "none"}"`);
              }
            } catch { console.log(`[wantedly] Jina failed for ${companySlug}, using slug`); }

            // フォールバック: Tavilyのcontentから公式サイトを補完
            const content = (result.content as string) || "";
            const title = (result.title as string) || "";
            if (!officialWebsite) {
              const fallbackMatch = content.match(/https?:\/\/(?!wantedly\.com)[a-zA-Z0-9.-]+\.[a-z]{2,}[^\s"')>]*/);
              officialWebsite = fallbackMatch ? fallbackMatch[0].replace(/[.、。）\]]+$/, "") : null;
            }

            // ── target_profileマッチでスコアリング ──
            // Wantedlyは「採用中の職種がターゲットに合致するか」で判定
            const searchText = `${title} ${content}`.toLowerCase();
            // Claude推論で生成したクエリキーワードとの合致度をチェック
            const matchedQueries = wantedlyQueries.filter(q => {
              const kw = q.replace(/site:wantedly\.com\S*\s*/g, "").replace(/採用|募集/g, "").trim().toLowerCase();
              return kw && searchText.includes(kw);
            });
            // 業種・規模マッチは target_profile から取得
            const targetIndustries: string[] = Array.isArray(wantedlyTargetProfile?.industries)
              ? wantedlyTargetProfile.industries as string[] : [];
            const industryMatch = targetIndustries.some(ind => searchText.includes(ind.toLowerCase()));
            // スコア計算: 職種マッチ(0-60) + 業種マッチ(20) + 公式サイトあり(20)
            const roleScore = Math.min(60, matchedQueries.length * 20);
            const industryScore = industryMatch ? 20 : 0;
            const websiteScore = officialWebsite ? 20 : 0;
            const wantedlyScore = roleScore + industryScore + websiteScore;
            const wantedlyPriority = wantedlyScore >= 70 ? "A" : wantedlyScore >= 50 ? "B" : "C";

            console.log(`[wantedly] ${companyName}: score=${wantedlyScore} (role=${roleScore} industry=${industryScore} web=${websiteScore}) priority=${wantedlyPriority}`);
            const { error: wantedlyErr } = await getSupabase().from("targets").insert({
              campaign_id: campaignId, platform: "wantedly",
              username: companyName,           // ← 正式会社名（Jina Readerから取得）
              profile_url: wantedlyPageUrl,
              post_url: url,
              website: officialWebsite,        // ← 公式サイトURL
              contact_url: officialWebsite,    // ← フォーム送信先（公式サイトのお問い合わせ）
              post_content: `${title}\n${content}`.slice(0, 500),
              match_score: wantedlyScore,
              priority: wantedlyPriority,
              match_reason: `Wantedly採用ページ合致（職種:${matchedQueries.length}件${industryMatch ? "・業種一致" : ""}${officialWebsite ? "・公式サイトあり" : ""}）`,
              status: "scored",         // Phase 4スコアリングをスキップ
              relevance_score: wantedlyScore, // relevance_score設定でPhase 4の二重スキップ保護
            });
            if (wantedlyErr) { console.error(`[wantedly] Insert error for ${companySlug}:`, wantedlyErr.message); continue; }
            insertedTargets.push(companyName);
            console.log(`[wantedly] Inserted: ${companyName} score=${wantedlyScore} site=${officialWebsite || "none"}`);
          }

        }
      } catch (err) { console.error("[wantedly] error:", err); }
    }

    // ── PR TIMES 専用ハンドラ（Tavily発見 → Jina Readerで企業名・URL抽出 → フォーム送信）──
    console.log('[prtimes] block executing, platforms includes prtimes:', platforms.includes('prtimes'));
    if (platforms.includes("prtimes") && !limitReached && process.env.TAVILY_API_KEY) {
      try {
        const prKeyword = searchQueries[0] || productDescription.slice(0, 40);
        const prTimesQueries = [
          `site:prtimes.jp ${prKeyword} 新サービス リリース`,
          `site:prtimes.jp ${prKeyword} 新規事業 開始`,
          `site:prtimes.jp ${prKeyword} ローンチ 募集`,
          `site:prtimes.jp ${prKeyword} βテスト ユーザー募集`,
        ];
        // PR TIMESページから企業名・URLを正確抽出（Jina Reader経由）
        const extractFromPRTimes = async (pageUrl: string): Promise<{ companyName: string | null; websiteUrl: string | null; summary: string }> => {
          try {
            const jinaRes = await fetch(`https://r.jina.ai/${pageUrl}`, {
              headers: { Accept: "text/plain" }, signal: AbortSignal.timeout(8000),
            });
            if (!jinaRes.ok) return { companyName: null, websiteUrl: null, summary: "" };
            const md = await jinaRes.text();
            // 企業名を抽出（株式会社/合同会社/有限会社を含む行）
            const lines = md.split("\n");
            let companyName: string | null = null;
            for (const line of lines) {
              const trimmed = line.trim();
              if ((trimmed.includes("株式会社") || trimmed.includes("合同会社") || trimmed.includes("有限会社")) && trimmed.length < 60) {
                // マークダウン記法・括弧を除去
                companyName = trimmed.replace(/[#*\[\]()（）|｜]/g, "").trim();
                break;
              }
            }
            // 企業URLを抽出（prtimes/twitter/facebook/SNS除外）
            const EXCLUDED_DOMAINS = ["prtimes.jp", "twitter.com", "x.com", "facebook.com", "instagram.com", "linkedin.com", "youtube.com", "note.com", "amazon", "apple.com", "google.com", "line.me", "t.co"];
            const urlPattern = /https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})[^\s"')>\]<]*/g;
            let websiteUrl: string | null = null;
            let m: RegExpExecArray | null;
            while ((m = urlPattern.exec(md)) !== null) {
              const domain = m[1].toLowerCase();
              if (!EXCLUDED_DOMAINS.some(ex => domain.includes(ex))) {
                websiteUrl = m[0].replace(/[.、。）\]]+$/, "");
                break;
              }
            }
            return { companyName, websiteUrl, summary: md.slice(0, 500) };
          } catch { return { companyName: null, websiteUrl: null, summary: "" }; }
        };

        for (const query of prTimesQueries) {
          if (limitReached) break;
          console.log(`[prtimes] query: "${query}"`);
          const tavilyRes = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: process.env.TAVILY_API_KEY, query,
              search_depth: "basic", max_results: 8,
              include_domains: ["prtimes.jp"],
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!tavilyRes.ok) { console.error(`[prtimes] Tavily error: ${tavilyRes.status}`); continue; }
          const tavilyData = await tavilyRes.json();
          const results = (tavilyData.results || []) as Array<Record<string, unknown>>;
          console.log(`[prtimes] ${results.length} results for "${query.slice(0, 50)}"`);
          for (const result of results) {
            if (insertedTargets.length >= remaining) { limitReached = true; break; }
            const url = (result.url as string) || "";
            // 個別プレスリリースURLのみ通過（/main/html/rd/p/ を含む）
            if (!url.includes("prtimes.jp/main/html/rd/p/")) continue;
            // Jina Readerでページ詳細取得
            const { companyName, websiteUrl, summary } = await extractFromPRTimes(url);
            // フォールバック: Tavilyのtitleから企業名を推定
            const title = (result.title as string) || "";
            const fallbackCompany = title.match(/株式会社[^\s、。）]+|[^\s、。（(]+(?:株式会社|合同会社|有限会社)/)?.[0]
              || title.replace(/【.+?】|「.+?」|\｜.+$/, "").trim().slice(0, 30);
            const finalCompanyName = companyName || fallbackCompany;
            if (!finalCompanyName) continue;
            const dedupKey = `prtimes::${finalCompanyName.toLowerCase()}`;
            if (dedupSet.has(dedupKey)) continue;
            dedupSet.add(dedupKey);
            // フォールバック: Tavilyのcontentから企業URLを補完
            const tavilyContent = (result.content as string) || "";
            const fallbackUrlMatch = tavilyContent.match(/https?:\/\/(?!prtimes\.jp|twitter\.com|t\.co)[a-zA-Z0-9.-]+\.[a-z]{2,}[^\s"')>\]<]*/);
            const finalWebsite = websiteUrl || (fallbackUrlMatch ? fallbackUrlMatch[0].replace(/[.、。）\]]+$/, "") : null);
            const finalSummary = summary || `${title}\n${tavilyContent}`.slice(0, 500);
            console.log(`[prtimes] found company: ${finalCompanyName} url: ${finalWebsite || "none"}`);
            console.log(`[prtimes] press release summary: ${finalSummary.slice(0, 100)}`);
            const { error: prErr } = await getSupabase().from("targets").insert({
              campaign_id: campaignId, platform: "prtimes",
              username: finalCompanyName,
              profile_url: url,
              post_url: url,
              website: finalWebsite,
              contact_url: finalWebsite,  // Playwright フォーム送信用
              post_content: finalSummary,
              // PR TIMES = 新規事業・顧客獲得フェーズ → 高スコアで固定
              // status='scored'にしてPhase 4の上書きをスキップ
              match_score: finalWebsite ? 82 : 65,
              priority: finalWebsite ? "A" : "B",
              match_reason: `PR TIMES新規事業プレスリリース${finalWebsite ? "（Webサイトあり）" : ""}`,
              ai_reason: "PR TIMESのプレスリリースは新規事業・新サービス開始の企業。顧客獲得フェーズにある可能性が高く接触タイミングが最適。",
              status: "scored",  // Phase 4スコアリングをスキップ（上書き防止）
            });
            if (prErr) { console.error(`[prtimes] Insert error for ${finalCompanyName}:`, prErr.message); continue; }
            insertedTargets.push(finalCompanyName);
            console.log(`[prtimes] Inserted: ${finalCompanyName} score=${finalWebsite ? 82 : 65} website=${finalWebsite || "none"}`);
          }
        }
      } catch (err) { console.error("[prtimes] error:", err); }
    }


    // Google Places API discovery (if "google_maps" is in selected platforms)
    console.log(`[google_maps] PRE-CHECK: platforms=${JSON.stringify(platforms)} limitReached=${limitReached} remaining=${remaining - insertedTargets.length}`);
    if (platforms.includes("google_maps") && !limitReached) {
      console.log("[google_maps] ENTERING google_maps handler");
      console.log("[google_maps] GOOGLE_PLACES_API_KEY set:", !!process.env.GOOGLE_PLACES_API_KEY);
      console.log("[google_maps] searchQueries:", searchQueries);
      if (!process.env.GOOGLE_PLACES_API_KEY) {
        console.error("[google_maps] GOOGLE_PLACES_API_KEY is not set — skipping");
      } else {
      try {
        // Generate industry + location queries via Claude based on product personas
        let b2bQueries: string[] = [];
        const personaLabels = Array.isArray(targetPersonas)
          ? targetPersonas.map(p => (p.label as string) || "").filter(Boolean).join(", ")
          : "";
        try {
          const b2bQueryRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY!,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 600,
              messages: [{
                role: "user",
                content: `プロダクト: ${productDescription.slice(0, 150)}
ターゲットペルソナ: ${personaLabels || "スタートアップ創業者, マーケター"}

このプロダクトを必要としている企業をGoogleマップで探すための検索クエリを5つ生成してください。
業種と地域（東京・大阪・渋谷など）を組み合わせた短いクエリにしてください。
例: "スタートアップ 東京", "マーケティング会社 渋谷", "IT企業 採用担当"
JSONのみ返してください: ["query1", "query2", "query3", "query4", "query5"]`,
              }],
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (b2bQueryRes.ok) {
            const b2bData = await b2bQueryRes.json();
            const raw = (b2bData.content?.[0]?.text || "").trim();
            const arrMatch = raw.match(/\[[\s\S]*\]/);
            if (arrMatch) b2bQueries = JSON.parse(arrMatch[0]);
          }
        } catch (qErr) { console.error("[google_maps] Query gen error:", qErr); }
        if (b2bQueries.length === 0) {
          // フォールバック: 地域×業種の多様なクエリ
          b2bQueries = [
            "スタートアップ 東京", "IT企業 渋谷", "マーケティング会社 大阪",
            "ウェブ制作会社 新宿", "コンサルティング 名古屋", "SaaS企業 福岡",
            "EC事業 横浜", "広告代理店 品川", "人材会社 池袋", "IT企業 札幌",
            "スタートアップ 大阪", "マーケティング 京都", "コンサル 仙台",
            "ウェブ開発 神戸", "IT企業 名古屋", "スタートアップ 福岡",
            "広告代理店 渋谷", "SaaS 東京", "EC企業 大阪", "営業支援 東京",
          ];
        }
        console.log(`[google_maps] Claude B2B queries:`, b2bQueries);
        for (const query of b2bQueries.slice(0, 10)) {
          if (limitReached || insertedTargets.length >= remaining) break;
          console.log(`[google_maps] calling Places API v1 with query: "${query}"`);
          const placesRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY || "",
              "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.formattedAddress,places.nationalPhoneNumber,places.id",
            },
            body: JSON.stringify({ textQuery: query, languageCode: "ja", maxResultCount: 20 }),
            signal: AbortSignal.timeout(10000),
          });
          console.log(`[google_maps] Places API v1 response status: ${placesRes.status}`);
          if (!placesRes.ok) {
            const errText = await placesRes.text().catch(() => "");
            console.error(`[google_maps] Places API v1 error: ${placesRes.status} — ${errText.slice(0, 200)}`);
            continue;
          }
          const placesData = await placesRes.json();
          const places = (placesData.places || []) as Array<Record<string, unknown>>;
          console.log(`[google_maps] Places API v1 count: ${places.length} for "${query}"`);
          if (places.length === 0) continue;
          for (const place of places.slice(0, 20)) {
            if (insertedTargets.length >= remaining) { limitReached = true; break; }
            // New Places API v1 field names
            const displayName = (place.displayName as Record<string, unknown>) || {};
            const name = (displayName.text as string) || "";
            if (!name) continue;
            // Debug: log Places API fields to diagnose missing website
            console.log(`[google_maps] place: ${name} websiteUri=${(place.websiteUri as string) ?? "MISSING"} phone=${(place.nationalPhoneNumber as string) ?? "MISSING"}`);
            const dedupKey = `google_maps::${name.toLowerCase()}`;
            if (dedupSet.has(dedupKey)) continue;
            dedupSet.add(dedupKey);
            const placeId = (place.id as string) || "";
            const mapsUrl = placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : "";
            const address = (place.formattedAddress as string) || "";
            const phone = (place.nationalPhoneNumber as string) || "";
            // Strip Google Maps tracking params (utm_source=G_Business etc.) before storing
            const rawWebsite = (place.websiteUri as string) || "";
            let website = rawWebsite;
            if (rawWebsite) {
              try {
                const wu = new URL(rawWebsite);
                if (wu.searchParams.has("utm_source")) website = wu.origin;
              } catch { /* keep raw */ }
              console.log(`[google_maps] ${name} → website: ${website}`);
            }
            // Hunter.io email finder
            let email = "";
            if (!process.env.HUNTER_API_KEY) {
              console.warn(`[google_maps] HUNTER_API_KEY not set — skipping email lookup for ${name}`);
            } else if (!website) {
              console.log(`[google_maps] No website for ${name} — cannot run Hunter.io`);
            } else {
              try {
                const domain = new URL(website).hostname.replace("www.", "");
                console.log(`[google_maps] Hunter.io lookup: ${name} → domain=${domain}`);
                const hunterRes = await fetch(
                  `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=3&api_key=${process.env.HUNTER_API_KEY}`,
                  { signal: AbortSignal.timeout(1500) }  // fail fast
                );
                if (hunterRes.ok) {
                  const hunterData = await hunterRes.json();
                  console.log(`[google_maps] Hunter raw response for ${domain}:`, JSON.stringify(hunterData).slice(0, 300));
                  const emails = (hunterData.data?.emails || []) as Array<{ value: string; confidence: number }>;
                  if (emails.length > 0) {
                    emails.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
                    email = emails[0].value || "";
                    console.log(`[google_maps] Hunter found email for ${domain}: ${email} (confidence: ${emails[0].confidence})`);
                  } else {
                    console.log(`[google_maps] Hunter: no emails found for ${domain}`);
                  }
                } else {
                  const errBody = await hunterRes.text().catch(() => "");
                  console.error(`[google_maps] Hunter HTTP ${hunterRes.status} for ${domain}: ${errBody.slice(0, 200)}`);
                }
              } catch (hunterErr) { console.error(`[google_maps] Hunter error:`, hunterErr); }
            }
            const { error: mapsInsertErr } = await getSupabase().from("targets").insert({
              campaign_id: campaignId, platform: "google_maps", username: name,
              profile_url: mapsUrl || website, post_url: mapsUrl || website,
              post_content: `${address} ${phone ? `📞 ${phone}` : ""}`.slice(0, 500),
              // B2B リード: initial score, Phase 4 will run B2B scoring
              match_score: email ? 70 : website ? 65 : 50,
              priority: "A", // default A; Phase 4 B2B scoring may upgrade/downgrade
              relevance_score: null, // null = Phase 4 will score with B2B prompt
              status: "pending",
              match_reason: `Googleマップ B2B: ${query.slice(0, 40)}`,
              ...(email ? { email } : {}),
              ...(phone ? { phone } : {}),
              // website のみ保存。contact_url は Firecrawl で後から取得するため null にする
              // （GoogleマップURLや website トップページを contact_url に入れると
              //   Playwright がフォームページではなく別ページに飛んでしまう）
              ...(website ? { website } : {}),
            });
            if (mapsInsertErr) { console.error(`[google_maps] Insert error: ${mapsInsertErr.message}`); continue; }
            insertedTargets.push(name);
            console.log(`[google_maps] ✅ Inserted: ${name} email=${email || "none"} phone=${phone || "none"} website=${website || "none"}`);          }
        } // end B2B queries loop
      } catch (err) { console.error("[google_maps] error:", err); }
      } // end GOOGLE_PLACES_API_KEY check
    }

    // ─── ProductHunt competitor comment discovery ───
    // Only run if user explicitly selected "producthunt_competitor" platform
    if (!limitReached && platforms.includes("producthunt_competitor") && process.env.TAVILY_API_KEY && process.env.ANTHROPIC_API_KEY) {
      try {
        console.log("[ph_competitor] Starting ProductHunt competitor discovery");
        // Step 1: Extract competitor names via Claude
        let competitorNames: string[] = [];
        const compRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001", max_tokens: 150,
            messages: [{ role: "user", content: `以下のプロダクト説明から、競合または類似ツールの名前を2〜3つ英語で抽出してください。\nプロダクト: ${productDescription.slice(0, 200)}\nJSONのみ返してください: ["CompetitorA", "CompetitorB"]` }],
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (compRes.ok) {
          const compData = await compRes.json();
          const raw = (compData.content?.[0]?.text || "").trim();
          const m = raw.match(/\[[\s\S]*\]/);
          if (m) competitorNames = JSON.parse(m[0]).filter((n: unknown) => typeof n === "string" && n.trim());
        }
        if (competitorNames.length === 0) competitorNames = ["Apollo.io", "Phantombuster"];
        console.log("[ph_competitor] Competitors:", competitorNames);

        // Step 2: Search for Japanese-language complaints about each competitor
        // Use Japanese complaint keywords to surface JP users switching away
        const jpComplaintTerms = "高い OR 乗り換え OR 解約 OR 代替 OR 困ってる OR 使いにくい OR alternative";
        for (const competitor of competitorNames.slice(0, 3)) {
          if (limitReached || insertedTargets.length >= remaining) break;

          // Two queries: Japanese-specific + English negative with JP signals
          const queries = [
            `"${competitor}" ${jpComplaintTerms} site:reddit.com OR site:twitter.com OR site:zenn.dev`,
            `site:producthunt.com "${competitor}" "too expensive" OR "switched" OR "alternative" OR "looking for" OR "wish it had" OR "missing"`,
          ];

          for (const phQuery of queries) {
            if (limitReached || insertedTargets.length >= remaining) break;
            const phRes = await fetch("https://api.tavily.com/search", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
              body: JSON.stringify({ query: phQuery, search_depth: "advanced", max_results: 6, include_answer: false, include_raw_content: false }),
              signal: AbortSignal.timeout(12000),
            });
            if (!phRes.ok) continue;
            const phData = await phRes.json();
            const phResults = filterFreshResults((phData.results || []) as Record<string, unknown>[], sixMonthsAgo);

            for (const result of phResults) {
              if (insertedTargets.length >= remaining) { limitReached = true; break; }
              const url = (result.url as string) || "";
              const content = ((result.content as string) || "").slice(0, 600);
              const title = (result.title as string) || "";

              // ── Filter: require Japanese characters OR explicit complaint signal ──
              const hasJapanese = /[\u3040-\u30ff\u4e00-\u9fff]/.test(content + title);
              const hasComplaintSignal = /expensive|too much|switched|alternative|looking for|乗り換え|高い|代替|解約/.test(content + title);
              if (!hasJapanese && !hasComplaintSignal) {
                console.log(`[ph_competitor] ⏭️ Skipping non-JP/non-complaint: ${url.slice(0, 60)}`);
                continue;
              }

              // ── Extract real commenter name from content, NOT from page slug ──
              // Priority: @mention in content → "by {Name}" pattern → title author → skip
              const mentionMatch = content.match(/@([a-zA-Z0-9_\u3040-\u30ff\u4e00-\u9fff]{2,30})/);
              const byMatch = content.match(/by\s+([A-Z][a-zA-Z]{1,20}(?:\s[A-Z][a-zA-Z]{1,20})?)/);
              const titleAuthor = title.match(/^([^|–\-:]+?)\s*(?:on|reviewed|says)/i);

              const username = mentionMatch
                ? mentionMatch[1].replace(/^@/, "").slice(0, 50)
                : byMatch
                  ? byMatch[1].replace(/\s/g, "_").slice(0, 50)
                  : titleAuthor
                    ? titleAuthor[1].trim().replace(/\s/g, "_").slice(0, 50)
                    : null;

              // Skip if we can't identify a real person (just the product page)
              if (!username) {
                console.log(`[ph_competitor] ⏭️ No commenter extractable from ${url.slice(0, 60)}`);
                continue;
              }

              // Skip if username looks like a product slug (all lowercase, contains dots/dashes = PH product page)
              if (/^[a-z0-9._-]+$/.test(username) && username.includes(".")) {
                console.log(`[ph_competitor] ⏭️ Looks like product slug, not person: ${username}`);
                continue;
              }

              const dedupKey = `producthunt_competitor::${username}::${competitor}`;
              if (dedupSet.has(dedupKey)) continue;
              dedupSet.add(dedupKey);

              const { error: phInsertErr } = await getSupabase().from("targets").insert({
                campaign_id: campaignId, platform: "producthunt_competitor",
                username, profile_url: url, post_url: url,
                post_content: `[${competitor}代替候補] ${content}`.slice(0, 500),
                match_score: hasJapanese ? 72 : 60, priority: "A", status: "pending",
                match_reason: `ProductHunt: ${competitor}への不満コメント投稿者`,
              });
              if (!phInsertErr) {
                insertedTargets.push(username);
                console.log(`[ph_competitor] ✅ ${username} (JP:${hasJapanese}) from ${competitor}`);
              }
            }
          }
        }
      } catch (phErr) { console.error("[ph_competitor] error:", phErr); }
    }

    // ─── Google Maps competitor review discovery ───
    // Only run if user explicitly selected "google_maps_review" platform
    if (!limitReached && platforms.includes("google_maps_review") && process.env.TAVILY_API_KEY && process.env.ANTHROPIC_API_KEY) {
      try {
        console.log("[maps_review] Starting competitor review discovery");
        // Step 1: Extract category keywords via Claude
        let categoryKeywords: string[] = [];
        const catRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001", max_tokens: 120,
            messages: [{ role: "user", content: `以下のプロダクト説明から、同じカテゴリの競合サービス会社をGoogleで探すための業種キーワードを2〜3つ日本語で抽出してください。\nプロダクト: ${productDescription.slice(0, 200)}\nJSONのみ: ["キーワード1", "キーワード2"]` }],
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (catRes.ok) {
          const catData = await catRes.json();
          const raw = (catData.content?.[0]?.text || "").trim();
          const m = raw.match(/\[[\s\S]*\]/);
          if (m) categoryKeywords = JSON.parse(m[0]).filter((k: unknown) => typeof k === "string" && k.trim());
        }
        if (categoryKeywords.length === 0) categoryKeywords = ["マーケティング支援会社", "営業代行"];
        console.log("[maps_review] Category keywords:", categoryKeywords);

        // Step 2: For each category, search for competitor negative reviews via Tavily
        for (const keyword of categoryKeywords.slice(0, 2)) {
          if (limitReached || insertedTargets.length >= remaining) break;
          const reviewQuery = `${keyword} 評判 OR レビュー (高い OR 効果なし OR 解約 OR 乗り換え OR おすすめ)`;
          const rvRes = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
            body: JSON.stringify({ query: reviewQuery, search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false }),
            signal: AbortSignal.timeout(12000),
          });
          if (!rvRes.ok) continue;
          const rvData = await rvRes.json();
          const rvResults = filterFreshResults((rvData.results || []) as Record<string, unknown>[], sixMonthsAgo);
          for (const result of rvResults) {
            if (insertedTargets.length >= remaining) { limitReached = true; break; }
            const url = (result.url as string) || "";
            const content = ((result.content as string) || "").slice(0, 500);
            const title = (result.title as string) || "";
            // Use title or domain as company name
            const domainMatch = url.match(/https?:\/\/(?:www\.)?([^/?#]+)/);
            const username = title.slice(0, 40) || (domainMatch ? domainMatch[1] : `review_${keyword.slice(0,10)}`);
            const dedupKey = `google_maps_review::${url}`;
            if (dedupSet.has(dedupKey)) continue;
            dedupSet.add(dedupKey);

            // Try Hunter.io for email if domain found
            let email = "";
            if (domainMatch && process.env.HUNTER_API_KEY) {
              try {
                const domain = domainMatch[1].replace("www.", "");
                const hRes = await fetch(`https://api.hunter.io/v2/domain-search?domain=${domain}&limit=1&api_key=${process.env.HUNTER_API_KEY}`, { signal: AbortSignal.timeout(4000) });
                if (hRes.ok) {
                  const hData = await hRes.json();
                  const emails = (hData.data?.emails || []) as Array<{ value: string }>;
                  if (emails.length > 0) email = emails[0].value;
                }
              } catch { /* skip */ }
            }

            const { error: rvInsertErr } = await getSupabase().from("targets").insert({
              campaign_id: campaignId, platform: "google_maps_review",
              username: username.slice(0, 80), profile_url: url, post_url: url,
              post_content: `[競合不満レビュー: ${keyword}] ${content}`.slice(0, 500),
              match_score: 70, priority: "A", status: "pending",
              match_reason: `競合サービス不満: ${keyword}`,
              ai_reason: "competitor_dissatisfied",
              ...(email ? { email } : {}),
            });
            if (!rvInsertErr) { insertedTargets.push(username.slice(0, 80)); console.log(`[maps_review] ✅ ${username} (keyword: ${keyword})`); }
          }
        }
      } catch (rvErr) { console.error("[maps_review] error:", rvErr); }
    }

    console.log(`[discover] Phase 2 complete: ${insertedTargets.length} targets inserted`);
    const discoveryResult = { targetsFound: insertedTargets.length };

    // ═══ PHASE 3: Extract contacts (inline) ═══

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
            const rawProfileUrl = buildProfileUrl(t.profile_url || "", t.platform, t.username);

            // place_id / Google Maps 系 URL を contact_url に保存しない
            const isPlaceIdUrl = (u: string) =>
              u.includes("place_id") ||
              u.includes("google.com/maps") ||
              u.includes("maps.google") ||
              u.includes("goo.gl");

            // google_maps プラットフォームは website を contact_url として使用
            let profileUrl: string;
            if (t.platform === "google_maps") {
              const ws = (t.website as string | null) || "";
              profileUrl = ws && !isPlaceIdUrl(ws) ? ws : "";
            } else {
              profileUrl = rawProfileUrl && !isPlaceIdUrl(rawProfileUrl) ? rawProfileUrl : "";
            }

            // contact_url が空の場合はスキップ（place_id URLを保存しない）
            if (!profileUrl) {
              // google_maps: website を contact_url に設定（Playwright がフォームを探す出発点として使用）
              // website もなければ "skip" センチネルで再処理を防ぐ
              const fallback = (t.website as string | null) && !isPlaceIdUrl((t.website as string)) 
                ? (t.website as string) 
                : "skip";
              console.log(`[contact] ${t.platform} ${t.username} — setting contact_url=${fallback} (place_id excluded)`);
              await getSupabase().from("targets").update({ contact_url: fallback }).eq("id", t.id);
              continue;
            }

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
    console.log("[discover] Phase 3 complete — contacts extracted");

    // ═══ PHASE 4: AI scoring (inline) ═══

    // Firecrawl deep extraction + Multi-factor AI scoring
    try {
      // Find targets that haven't been scored yet (no relevance_score)
      // Exclude google_maps targets — they are B2B leads, not individuals, no AI scoring needed
      const { data: scoringTargets, error: scoringQueryErr } = await getSupabase()
        .from("targets")
        .select("id, username, platform, post_url, post_content, profile_url, status")
        .eq("campaign_id", campaignId)
        .is("relevance_score", null)
        .neq("status", "scored")  // status='scored'はPhase 4をスキップ（Wantedly/PR TIMES等）
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
            const isGoogleMaps = t.platform === "google_maps";
            // Detect if this looks like a company/corporate post
            const looksLikeCompany = /株式会社|合同会社|公式|サービス|ソリューション|press|release/.test(enrichedContent.slice(0, 300));
            const isPersonalPlatform = ["note", "qiita", "zenn", "twitter", "reddit", "wantedly", "connpass"].includes(t.platform);

            // Signal-strength scoring prompt — unified for B2B and individual
            const scorePromptContent = `あなたはターゲット精度評価の専門家です。
以下のコンテンツを読み、この投稿者・企業が「${scoreProdDesc}」を今まさに必要としている確率を評価してください。

【コンテンツ】
${enrichedContent.slice(0, 500)}

【URL / 情報源】
${(t.profile_url as string) || t.platform}
${isGoogleMaps ? `【企業名】${t.username}` : `【投稿者】${t.username} (${t.platform})`}
${looksLikeCompany && !isGoogleMaps ? "⚠️ 企業・法人アカウントの可能性あり" : ""}

以下の基準でSからCの4段階で評価してください：

S（スコア90-100）: 課題を能動的に発信・解決策を探している
- 「困ってる」「探してる」「どうすれば」「おすすめ教えて」などの表現がある
- 具体的な痛みポイントが明記されている
- 質問投稿・相談投稿である

A（スコア70-89）: 関連ツールを比較・検討している
- 競合ツールを試用・レビューしている
- 同カテゴリの複数ツールを比較している
- 導入を具体的に検討している様子がある

B（スコア50-69）: 課題領域に関心があるが需要は不明
- テーマに関する情報収集をしている
- 関連する話題を投稿しているが課題は不明確

C（スコア0-49）: 需要シグナルなし
- 記者・研究者・競合他社と思われる
- キーワードが含まれるだけで課題感がない
- 解説記事・まとめ記事の筆者

以下のJSON形式のみで返答してください（他の文字は一切不要）：
{
  "tier": "S" | "A" | "B" | "C",
  "score": number,
  "q1_score": number,
  "q2_score": number,
  "q3_score": number,
  "signal": "需要シグナルの具体的な根拠を1文で",
  "recommended": true | false,
  "estimated_role": "職種または業種"
}

q1_score（課題の深さ 0-10）: 具体的な痛みポイントの明確さ
q2_score（試す意欲 0-10）: ツール導入・試用への積極性
q3_score（接触可能性 0-5）: DM・メール・フォームで連絡できる可能性
recommendedはS・Aの場合のみtrueにしてください。`;

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
- tierは必ずS/A/B/Cのいずれかにしてください。
- scoreはtierに対応した範囲内（S:90-100, A:70-89, B:50-69, C:0-49）にしてください。
- recommendedはS・Aの場合のみtrueにしてください。
- 「困っている」「探している」の直接的表現がない限りSにしないでください。
- 一般的な技術記事・PR記事・公式アカウントはCにしてください。`,
                messages: [{ role: "user", content: scorePromptContent }],
              }),
            });

            const scoreData = await scoreResponse.json();
            const rawScoreText = scoreData.content?.[0]?.text || "";
            const scoreMatch = rawScoreText.match(/\{[\s\S]*\}/);

            console.log(`[scoring] Raw response for ${t.username}:`, rawScoreText.slice(0, 200));

            let parsedScore: Record<string, unknown> | null = null;
            if (scoreMatch) {
              try {
                parsedScore = JSON.parse(scoreMatch[0]);
              } catch (parseErr) {
                console.error(`[scoring] JSON parse failed for ${t.username}:`, parseErr, "raw:", rawScoreText.slice(0, 200));
              }
            }

            if (parsedScore) {
              const score = parsedScore;
              const tier = (typeof score.tier === "string" && ["S","A","B","C"].includes(score.tier) ? score.tier : "C") as "S"|"A"|"B"|"C";
              const totalScore = Math.min(100, Math.max(0, typeof score.score === "number" ? score.score : 30));
              const signal = (typeof score.signal === "string" ? score.signal : "").slice(0, 200);
              const recommended = score.recommended === true;
              const q1 = Math.min(10, Math.max(0, typeof score.q1_score === "number" ? score.q1_score : 0));
              const q2 = Math.min(10, Math.max(0, typeof score.q2_score === "number" ? score.q2_score : 0));
              const q3 = Math.min(5,  Math.max(0, typeof score.q3_score === "number" ? score.q3_score : 0));
              const priority = tier;

              const baseUpdate = {
                match_score: totalScore,
                priority,
                ai_reason: signal,
                relevance_score: q1,
                q1_score: q1,
                q2_score: q2,
                q3_score: q3,
                estimated_role: (typeof score.estimated_role === "string" ? score.estimated_role : "不明").slice(0, 50),
                status: "scored",
              };

              if (!recommended) {
                console.log(`[scoring] ⏭️ ${t.username}: ${tier} (${totalScore}% q1=${q1} q2=${q2} q3=${q3}) — not recommended`);
                const { error: uErr } = await getSupabase().from("targets").update(baseUpdate).eq("id", t.id);
                if (uErr) console.error(`[scoring] DB update error (non-recommended) for ${t.username}:`, uErr);
              } else {
                console.log(`[scoring] ✅ ${t.username}: ${tier} (${totalScore}% q1=${q1} q2=${q2} q3=${q3}) — ${signal.slice(0, 60)}`);
                const { error: updateErr } = await getSupabase().from("targets").update(baseUpdate).eq("id", t.id);
                if (updateErr) console.error(`[scoring] DB update error for ${t.username}:`, updateErr);
              }
            } else {
              console.log(`[scoring] No valid JSON in response for ${t.username}, setting C`);
              await getSupabase().from("targets").update({ priority: "C", status: "scored", match_score: 0 }).eq("id", t.id);
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
    console.log("[discover] Phase 4 complete — scoring done");

    // ═══ FINAL: Mark campaign as completed ═══
    await getSupabase()
      .from("campaigns")
      .update({ status: "completed" })
      .eq("id", campaignId);
    console.log(`[discover] Campaign ${campaignId} marked as completed. Targets found: ${discoveryResult?.targetsFound || 0}`);

    return { success: true, campaignId, targetsFound: discoveryResult?.targetsFound || 0 };
    }); // end step.run("run-full-discovery")
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

        // required_keywords is now used for Tavily search queries only (injected above)

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
・150文字以内
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

// ── バックグラウンド一括送信 ─────────────────────────────────────────────────
export const bulkSendOutreach = inngest.createFunction(
  { id: "bulk-send-outreach", retries: 0, triggers: [{ event: "outreach/bulk-send" }] },
  async ({ event, step }: any) => {
    const { campaignId, targetIds, senderName, senderEmail, userEmail, userId: eventUserId, settings } = event.data as {
      campaignId: string;
      targetIds: string[];
      senderName: string;
      senderEmail: string;
      userEmail: string;
      userId: string | null;
      settings?: { userId?: string };
    };

    // デバッグ: 受け取った userId を確認
    console.log(`[bulk-send] START campaignId=${campaignId} targetIds.count=${(targetIds || []).length}`);
    console.log(`[bulk-send] userId from event:`, eventUserId);
    console.log(`[bulk-send] settings.userId:`, settings?.userId);

    // campaign.user_id をDBから取得（フォールバック用）
    const supabaseTop = getSupabase();
    const { data: campaignRow } = await supabaseTop
      .from("campaigns")
      .select("user_id")
      .eq("id", campaignId)
      .single();
    const campaignUserId = (campaignRow?.user_id as string) || null;

    // 優先順位: event.data.userId → event.data.settings.userId → campaign.user_id
    const resolvedUserId = eventUserId || settings?.userId || campaignUserId || null;
    console.log(`[bulk-send] resolved userId: ${resolvedUserId} (event=${eventUserId}, settings=${settings?.userId}, campaign=${campaignUserId})`);

    const successList: string[] = [];
    const failList: { name: string; error: string }[] = [];

    // 1件ずつ step.run で処理（各 step は独立してリトライ可能）
    for (const targetId of targetIds) {
      // Guard: skip if targetId is missing/invalid
      if (!targetId || typeof targetId !== "string" || targetId.length < 10) {
        console.error(`[bulk-send] Skipping invalid targetId: ${JSON.stringify(targetId)}`);
        failList.push({ name: targetId || "unknown", error: "無効なtargetId" });
        continue;
      }

      // Capture ID immutably to avoid Inngest step-replay closure issue
      const currentTargetId = String(targetId);

      const result = await step.run(`send-${currentTargetId}`, async () => {
        // ── step内でsupabaseを再生成（Inngestリプレイ時のクロージャ問題を回避）──
        const supabase = getSupabase();

        // ── 詳細デバッグ: targetId の値・型・長さを確認 ──
        console.log("[bulkSend] currentTargetId value:", currentTargetId, "type:", typeof currentTargetId, "length:", currentTargetId?.length);

        const { data: target, error: targetErr } = await supabase
          .from("targets")
          .select("*")
          .eq("id", currentTargetId)
          .single();

        // ── DB結果を全件ログ ──
        console.log("[bulkSend] DB result:", JSON.stringify(target), "error:", JSON.stringify(targetErr));

        if (targetErr) console.error(`[bulk-send] Target fetch error for "${currentTargetId}":`, targetErr.message);
        if (!target) {
          console.error(`[bulk-send] Target not found for id: "${currentTargetId}"`);
          // DBにあるターゲットのサンプルを確認（接続・テーブル自体の問題を検知）
          const { data: sampleTargets, error: sampleErr } = await supabase
            .from("targets")
            .select("id")
            .limit(5);
          console.log("[bulkSend] sample targets in DB:", JSON.stringify(sampleTargets), "sampleErr:", JSON.stringify(sampleErr));
          return { success: false, error: "ターゲット不明", name: currentTargetId };
        }
        // Full target log to diagnose field issues
        console.log(`[bulk-send] Target found:`, JSON.stringify({
          id: target.id, username: target.username, platform: target.platform,
          website: target.website, contact_url: target.contact_url, email: target.email,
        }));

        // ── Inngest → Railway 直接接続（Vercel経由をやめてタイムアウト回避）──
        const playwrightUrl = process.env.PLAYWRIGHT_SERVER_URL;
        const playwrightApiKey = process.env.PLAYWRIGHT_API_KEY;

        if (!playwrightUrl) {
          console.error("[bulk-send] PLAYWRIGHT_SERVER_URL not set");
          return { success: false, error: "Playwrightサーバー未設定", name: (target.username as string) || currentTargetId };
        }

        // メッセージをClaude で生成
        let outreachMessage = "";
        try {
          const { data: campaignRow } = await supabase.from("campaigns").select("*").eq("id", campaignId).single();
          const productDesc = (campaignRow?.product_description as string) || (campaignRow?.product_url as string) || "";
          const isPRTimes = (target.platform as string) === "prtimes";
          const promptContent = isPRTimes
            ? `あなたはビジネスメールのプロです。
以下の情報を元に、企業お問い合わせフォームへのメッセージを生成してください。

送信者: ${senderName}
自社サービス: ${productDesc}
送信先企業: ${target.username}
プレスリリース内容: ${(target.post_content as string || "").slice(0, 200)}

【ルール】
・書き出しは「${senderName}と申します。」
・相手のプレスリリース内容（新サービス・新規事業）に1文触れる
・自社サービスが役立てる理由を1文で簡潔に
・締めは「ご検討いただけますと幸いです。」または同等の丁寧な結び
・全体150〜200字（フォームの文字数制限を考慮）
・件名は不要、本文のみ
・売り込み色を抑えた提案型
・敬語・ビジネスメール文体

メッセージ本文のみ返してください。`
            : `あなたはB2Bセールスの専門家です。
以下の情報を元に、企業のお問い合わせフォームに送るメッセージを日本語で生成してください。

送信者: ${senderName}
自社サービス: ${productDesc}
送信先企業: ${target.username}
企業ウェブサイト: ${target.website}

【ルール】
・200文字以内
・自然な敬語
・売り込みは控えめに
・具体的な価値提案を1文
・問い合わせ・面談打診で締める

メッセージ本文のみ返してください。`;
          const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY!,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 400,
              messages: [{ role: "user", content: promptContent }],
            }),
            signal: AbortSignal.timeout(20000),
          });
          if (claudeRes.ok) {
            const cd = await claudeRes.json();
            outreachMessage = cd.content?.[0]?.text || "";
          }
        } catch (claudeErr) {
          console.warn("[bulk-send] Claude message generation failed:", claudeErr);
        }
        if (!outreachMessage) {
          outreachMessage = `${senderName}と申します。貴社のサービスに関心があり、ご連絡いたしました。一度お話しさせていただけますでしょうか。`;
        }
        console.log(`[bulk-send] Message for ${target.username}: ${outreachMessage.slice(0, 50)}...`);

        // ── クリック追跡: enable_tracking=true の場合、spark-ai.jp をトラッキングURLに置換 ──
        const enableTracking = (campaignRow as Record<string, unknown>)?.enable_tracking === true;
        const trackingUrl = `https://spark-ai.jp/api/track/${campaignId}/${currentTargetId}`;
        const finalMessage = enableTracking && outreachMessage.includes("spark-ai.jp")
          ? outreachMessage.replace(/spark-ai\.jp/g, trackingUrl)
          : outreachMessage;
        if (enableTracking && finalMessage !== outreachMessage) {
          console.log(`[bulk-send] ✅ Tracking URL injected for ${target.username}`);
        }

        // ── fire-and-forget: 応答を待たずに送信開始して即座に次へ ──
        console.log(`[bulk-send] fire-and-forget → Railway: ${playwrightUrl}/submit-contact-form for "${target.username}"`);
        fetch(`${playwrightUrl}/submit-contact-form`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": playwrightApiKey || "",
          },
          body: JSON.stringify({
            target_id: target.id,
            website_url: (() => {
              const ws = (target.website as string) || "";
              return ws &&
                !ws.includes("place_id") &&
                !ws.includes("google.com/maps") &&
                !ws.includes("maps.google") &&
                !ws.includes("goo.gl")
                ? ws : "";
            })(),
            contact_url: (target.contact_url as string) || null,
            message: finalMessage,
            sender_name: senderName,
            sender_email: senderEmail,
          }),
        }).catch((e: Error) => console.log(`[bulk-send] fire-and-forget error for "${target.username}": ${e.message}`));

        // 即座に成功扱い: Railwayの応答を待たない
        await supabase.from("targets").update({
          status: "contacted",
          contacted_at: new Date().toISOString(),
        }).eq("id", target.id);

        // sent_history に記録
        const cleanWebsiteUrl = (() => {
          const cu = (target.contact_url as string) || "";
          const ws = (target.website as string) || "";
          const isMapUrl = (u: string) =>
            u.includes("place_id") ||
            u.includes("google.com/maps") ||
            u.includes("maps.google") ||
            u.includes("goo.gl");
          if (cu && !isMapUrl(cu)) return cu;
          if (ws && !isMapUrl(ws)) return ws;
          return null;
        })();
        const { error: historyError } = await supabase.from("sent_history").insert({
          user_id: resolvedUserId,
          company_name: (target.username as string) || null,
          website_url: cleanWebsiteUrl,
          email: (target.email as string) || null,
          campaign_id: campaignId,
          send_method: "form-async",
          sent_at: new Date().toISOString(),
        });
        if (historyError) {
          console.error(`[bulk-send] sent_history insert error for "${target.username}":`, historyError.message, JSON.stringify(historyError));
        } else {
          console.log(`[bulk-send] sent_history inserted for "${target.username}" user_id=${resolvedUserId}`);
        }

        return {
          success: true,
          targetId: currentTargetId,
          name: (target.username as string) || currentTargetId,
          method: "form-async",
        };
      });

      if (result.success) {
        successList.push(result.name);
      } else {
        failList.push({ name: result.name, error: result.error || "不明" });
      }

      // 件間に2秒待機（Playwright サーバー負荷軽減）
      if (targetIds.indexOf(currentTargetId) < targetIds.length - 1) {
        await step.sleep(`wait-${currentTargetId}`, "2s");
      }
    }

    // 完了レポートメールを /api/send-report 経由で送信
    await step.run("send-report-email", async () => {
      const supabase = getSupabase(); // step内で再生成
      const apiBase = process.env.NEXT_PUBLIC_APP_URL || "https://spark-ai.jp";
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("name")
        .eq("id", campaignId)
        .single();
      const campaignName = (campaign?.name as string) || campaignId;

      await fetch(`${apiBase}/api/send-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail || senderEmail,
          campaignName,
          successCount: successList.length,
          failCount: failList.length,
        }),
        signal: AbortSignal.timeout(15000),
      }).catch((e: Error) => console.warn("[bulk-send] report email:", e.message));
    });

    return { success: successList.length, failed: failList.length };
  }
);
