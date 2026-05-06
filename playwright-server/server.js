const express = require("express");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ヘルスチェック
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "spark-playwright" });
});

// バージョン確認
app.get("/version", (req, res) => {
  res.json({ version: "1.1.0", routes: ["/health", "/post-comment", "/test-connection"] });
});

// APIキー認証ミドルウェア
function authMiddleware(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.PLAYWRIGHT_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// コメント投稿エンドポイント
app.post("/post-comment", authMiddleware, async (req, res) => {
  const { comment_id } = req.body;

  try {
    // commentsテーブルからコメント取得
    const { data: comment } = await supabase
      .from("comments")
      .select("*, targets(*), campaigns(*)")
      .eq("id", comment_id)
      .single();

    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    const target = comment.targets;
    const campaign = comment.campaigns;
    const platform = comment.platform;

    console.log(`[post-comment] Platform: ${platform}, Target: @${target.username}, URL: ${target.post_url}`);

    let result;

    if (platform === "twitter") {
      // Twitter: まずAPI（環境変数ベース）を試す → 失敗したらPlaywright
      const apiResult = await postWithTwitterAPI(target.post_url, comment.content);
      if (apiResult.success) {
        result = apiResult;
        console.log(`[post-comment] Twitter API success: tweetId=${result.tweetId}`);
      } else {
        console.log(`[post-comment] Twitter API failed: ${apiResult.error}, trying Playwright...`);
        // Playwright fallback: 認証情報が必要
        const { data: creds } = await supabase
          .from("platform_credentials")
          .select("credentials")
          .eq("user_id", campaign.user_id)
          .eq("platform", platform)
          .single();

        if (!creds) {
          await updateCommentStatus(comment_id, "failed", `Twitter API: ${apiResult.error}. Playwright: 認証情報なし`);
          return res.status(400).json({ error: `Twitter API failed: ${apiResult.error}. No Playwright credentials.` });
        }
        result = await postTwitterComment(creds.credentials, target, comment);
      }
    } else {
      // 他のプラットフォーム: 認証情報が必要
      const { data: creds } = await supabase
        .from("platform_credentials")
        .select("credentials")
        .eq("user_id", campaign.user_id)
        .eq("platform", platform)
        .single();

      if (!creds) {
        await updateCommentStatus(comment_id, "failed", "認証情報が見つかりません");
        return res.status(400).json({ error: "No credentials found" });
      }

      switch (platform) {
        case "reddit":
          result = await postRedditComment(creds.credentials, target, comment);
          break;
        default:
          result = { success: false, error: `${platform} is not yet supported` };
      }
    }

    if (result.success) {
      await updateCommentStatus(comment_id, "posted");
      await supabase
        .from("targets")
        .update({ status: "contacted" })
        .eq("id", target.id);
      console.log(`✅ Comment posted successfully on ${platform}`);
    } else {
      await updateCommentStatus(comment_id, "failed", result.error);
      console.error(`❌ Failed to post: ${result.error}`);
    }

    res.json(result);
  } catch (err) {
    console.error("Post comment error:", err);
    await updateCommentStatus(comment_id, "failed", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 接続テストエンドポイント
app.post("/test-connection", authMiddleware, async (req, res) => {
  const { platform, credentials } = req.body;

  try {
    const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-default-browser-check",
      "--safebrowsing-disable-auto-update",
    ],
  });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    let result;
    switch (platform) {
      case "reddit":
        result = await testRedditLogin(page, credentials);
        break;
      case "twitter":
        result = await testTwitterLogin(page, credentials);
        break;
      default:
        result = { success: false, error: `${platform} test not implemented` };
    }

    await browser.close();
    res.json(result);
  } catch (err) {
    console.error("Connection test error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- Reddit ----

async function postRedditComment(credentials, target, comment) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-default-browser-check",
      "--safebrowsing-disable-auto-update",
    ],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    const result = await postToReddit(page, target.post_url, comment.content, credentials);
    return result;
  } catch (err) {
    console.error("Reddit post error:", err.message);
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}

async function postToReddit(page, postUrl, commentText, credentials) {
  try {
    page.setDefaultTimeout(60000);

    // セッションクッキーがあればそれを使う
    if (credentials.session_cookie) {
      console.log("Using session cookie for Reddit");
      await page.context().addCookies([
        {
          name: "reddit_session",
          value: credentials.session_cookie,
          domain: ".reddit.com",
          path: "/",
        },
      ]);

      // ログインページをスキップして直接投稿ページへ
      await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      const url = page.url();
      console.log("Direct navigation URL:", url);

      if (!url.includes("reddit.com/login")) {
        // セッション有効 → コメント投稿処理へ
        return await writeRedditComment(page, commentText);
      }
      console.log("Session cookie expired, falling back to login");
    }

    // 通常のログイン処理
    await page.goto("https://www.reddit.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await randomDelay(2000, 3000);

    console.log("Reddit login page loaded:", page.url());

    const inputs = await page.$$("input");
    console.log("Input count:", inputs.length);

    // ユーザー名入力
    const usernameSelectors = [
      'input[name="username"]',
      'input[id="login-username"]',
      'input[placeholder*="username" i]',
      'input[autocomplete="username"]',
      'input[type="text"]',
    ];

    let usernameInput = null;
    for (const sel of usernameSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        usernameInput = sel;
        console.log("Username selector found:", sel);
        break;
      } catch {}
    }

    if (!usernameInput) {
      return { success: false, error: "Username input not found" };
    }

    await humanType(page, usernameInput, credentials.username);
    await randomDelay(500, 1000);

    // パスワード入力
    const passwordSelectors = [
      'input[name="password"]',
      'input[id="login-password"]',
      'input[type="password"]',
    ];

    let passwordInput = null;
    for (const sel of passwordSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        passwordInput = sel;
        console.log("Password selector found:", sel);
        break;
      } catch {}
    }

    if (!passwordInput) {
      return { success: false, error: "Password input not found" };
    }

    await humanType(page, passwordInput, credentials.password);
    await randomDelay(500, 1000);

    // ログインボタン
    const loginSelectors = [
      'button[type="submit"]',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'button:has-text("Sign In")',
    ];

    let clicked = false;
    for (const sel of loginSelectors) {
      try {
        await page.click(sel, { timeout: 3000 });
        clicked = true;
        console.log("Login button clicked:", sel);
        break;
      } catch {}
    }

    if (!clicked) {
      await page.keyboard.press("Enter");
      console.log("Pressed Enter for login");
    }

    await randomDelay(5000, 8000);

    const currentUrl = page.url();
    console.log("Full URL after login:", currentUrl);

    const isStillOnLogin = currentUrl.includes("reddit.com/login") &&
                           !currentUrl.includes("reddit.com/login/success");

    if (isStillOnLogin) {
      console.log("Page title:", await page.title());
      console.log("Page URL:", page.url());

      const pageContent = await page.content();
      const lc = pageContent.toLowerCase();
      console.log("Has CAPTCHA:", lc.includes("captcha"));
      console.log("Has error:", lc.includes("incorrect") || lc.includes("wrong"));
      console.log("Has verification:", lc.includes("verify") || lc.includes("verification"));
      console.log("Page content (first 500):", pageContent.slice(0, 500));

      return { success: false, error: "Reddit login failed - still on login page" };
    }

    // 投稿ページに移動
    await randomDelay(1000, 2000);
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    return await writeRedditComment(page, commentText);
  } catch (err) {
    console.error("Reddit post error:", err.message);
    return { success: false, error: err.message };
  }
}

async function writeRedditComment(page, commentText) {
  await randomDelay(2000, 3000);

  // ページのタイトルとURLを確認
  console.log("Post page URL:", page.url());
  console.log("Post page title:", await page.title());

  // コメントボックスを探す前にページをスクロール
  await page.evaluate(() => window.scrollTo(0, 500));
  await randomDelay(1000, 2000);

  // 利用可能なinput/textareaを確認
  const textareas = await page.$$("textarea");
  console.log("Textarea count:", textareas.length);

  const contentEditables = await page.$$('[contenteditable="true"]');
  console.log("ContentEditable count:", contentEditables.length);

  // 新しいReddit UIのセレクター
  const commentSelectors = [
    '[placeholder="What are your thoughts?"]',
    '[placeholder="Add a comment"]',
    '[data-testid="comment-submission-form-textarea"]',
    ".public-DraftEditor-content",
    '[contenteditable="true"]',
    "textarea",
    "#comment-textarea",
    '[name="comment"]',
    "shreddit-composer",
  ];

  let commentBox = null;
  for (const sel of commentSelectors) {
    try {
      commentBox = await page.waitForSelector(sel, { timeout: 3000 });
      console.log("Comment box found:", sel);
      break;
    } catch {
      console.log("Selector not found:", sel);
    }
  }

  if (!commentBox) {
    // ページ内の全要素を確認
    const allInputs = await page.$$eval(
      "input, textarea, [contenteditable]",
      (els) =>
        els.map((el) => ({
          tag: el.tagName,
          type: el.type || "",
          placeholder: el.placeholder || "",
          contenteditable: el.contentEditable || "",
          id: el.id || "",
          name: el.name || "",
        }))
    );
    console.log("All inputs:", JSON.stringify(allInputs));
    return { success: false, error: "Comment box not found" };
  }

  await commentBox.click();
  await randomDelay(500, 1000);

  for (const char of commentText) {
    await page.keyboard.type(char, { delay: 30 + Math.random() * 60 });
  }

  await randomDelay(1000, 2000);

  const submitSelectors = [
    'button:has-text("Comment")',
    'button[type="submit"]',
    'button:has-text("Reply")',
  ];

  for (const sel of submitSelectors) {
    try {
      await page.click(sel, { timeout: 3000 });
      console.log("Submit clicked:", sel);
      break;
    } catch {}
  }

  await page.waitForTimeout(3000);
  console.log("Comment posted successfully");

  return { success: true };
}

async function testRedditLogin(page, credentials) {
  try {
    page.setDefaultTimeout(60000);

    await page.goto("https://www.reddit.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await randomDelay(2000, 3000);

    console.log("Reddit login page loaded:", page.url());

    const usernameSelectors = [
      'input[name="username"]',
      'input[id="login-username"]',
      'input[placeholder*="username" i]',
      'input[autocomplete="username"]',
      'input[type="text"]',
    ];

    let usernameInput = null;
    for (const sel of usernameSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        usernameInput = sel;
        break;
      } catch {}
    }

    if (!usernameInput) {
      return { success: false, error: "Username input not found" };
    }

    await humanType(page, usernameInput, credentials.username);
    await randomDelay(500, 1000);

    const passwordSelectors = [
      'input[name="password"]',
      'input[id="login-password"]',
      'input[type="password"]',
    ];

    let passwordInput = null;
    for (const sel of passwordSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        passwordInput = sel;
        break;
      } catch {}
    }

    if (!passwordInput) {
      return { success: false, error: "Password input not found" };
    }

    await humanType(page, passwordInput, credentials.password);
    await randomDelay(500, 1000);

    const loginSelectors = [
      'button[type="submit"]',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'button:has-text("Sign In")',
    ];

    let clicked = false;
    for (const sel of loginSelectors) {
      try {
        await page.click(sel, { timeout: 3000 });
        clicked = true;
        break;
      } catch {}
    }

    if (!clicked) {
      await page.keyboard.press("Enter");
    }

    await randomDelay(5000, 8000);

    const currentUrl = page.url();
    console.log("Full URL after login:", currentUrl);

    const isStillOnLogin = currentUrl.includes("reddit.com/login") &&
                           !currentUrl.includes("reddit.com/login/success");

    if (isStillOnLogin) {
      const pageContent = await page.content();
      console.log("Page title:", await page.title());
      console.log("Has CAPTCHA:", pageContent.includes("captcha") || pageContent.includes("CAPTCHA"));
      console.log("Has error msg:", pageContent.includes("incorrect") || pageContent.includes("error"));

      return { success: false, error: "ユーザー名またはパスワードが正しくありません" };
    }

    return { success: true, message: "Redditログイン成功" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---- Twitter ----

// ヘルパー：ランダム遅延
function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ヘルパー：人間らしいタイピング
async function humanType(page, selector, text) {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char, { delay: 40 + Math.random() * 80 });
  }
}

// ---- Twitter API ----

async function postWithTwitterAPI(postUrl, commentText) {
  try {
    const twitterApiKey = process.env.TWITTER_API_KEY;
    const twitterApiSecret = process.env.TWITTER_API_SECRET;
    const twitterAccessToken = process.env.TWITTER_ACCESS_TOKEN;
    const twitterAccessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

    if (!twitterApiKey || !twitterApiSecret || !twitterAccessToken || !twitterAccessTokenSecret) {
      return { success: false, error: "Twitter API credentials not configured" };
    }

    // ツイートIDをURLから抽出
    const tweetIdMatch = postUrl.match(/status\/(\d+)/);
    if (!tweetIdMatch) {
      return { success: false, error: "Could not extract tweet ID from URL" };
    }
    const tweetId = tweetIdMatch[1];

    // OAuth 1.0a署名を生成
    const oauth = generateOAuthHeader("POST", "https://api.twitter.com/2/tweets", {
      apiKey: twitterApiKey,
      apiSecret: twitterApiSecret,
      accessToken: twitterAccessToken,
      accessTokenSecret: twitterAccessTokenSecret,
    });

    // Twitter API v2でリプライ投稿
    const response = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: oauth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: commentText,
        reply: {
          in_reply_to_tweet_id: tweetId,
        },
      }),
    });

    const data = await response.json();
    console.log("Twitter API response:", JSON.stringify(data));

    if (response.ok && data.data?.id) {
      return { success: true, tweetId: data.data.id };
    } else {
      return { success: false, error: data.detail || JSON.stringify(data) };
    }
  } catch (err) {
    console.error("Twitter API error:", err.message);
    return { success: false, error: err.message };
  }
}

function generateOAuthHeader(method, url, credentials) {
  const oauthParams = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  // シグネチャベース文字列を生成
  const paramString = Object.keys(oauthParams)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(oauthParams[key])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString),
  ].join("&");

  // 署名キーを生成
  const signingKey = `${encodeURIComponent(credentials.apiSecret)}&${encodeURIComponent(credentials.accessTokenSecret)}`;

  // HMAC-SHA1署名
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  oauthParams.oauth_signature = signature;

  // Authorizationヘッダーを生成
  const authHeader =
    "OAuth " +
    Object.keys(oauthParams)
      .map((key) => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
      .join(", ");

  return authHeader;
}

async function postTwitterComment(credentials, target, comment) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-default-browser-check",
      "--safebrowsing-disable-auto-update",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });

    // webdriver検出を回避
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    const attemptLogin = async () => {
      // Twitter ログイン
      await page.goto("https://twitter.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await randomDelay(3000, 5000);

      // ユーザー名入力
      await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 });
      await randomDelay(500, 1000);
      const usernameInput = await page.$('input[autocomplete="username"]');
      if (usernameInput) {
        await usernameInput.hover();
        await randomDelay(300, 600);
        await usernameInput.click();
        await randomDelay(200, 400);
      }
      for (const char of credentials.username) {
        await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
      }
      await randomDelay(800, 1500);

      // 「次へ」ボタン
      await page.keyboard.press("Enter");
      await randomDelay(2000, 3500);

      // セキュリティチェック検出
      const pageContent = await page.content();
      if (pageContent.toLowerCase().includes("suspicious") || pageContent.toLowerCase().includes("verify your identity")) {
        return { success: false, error: "Twitter security check triggered" };
      }

      // パスワード入力
      try {
        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      } catch {
        return { success: false, error: "Twitter security check triggered - password field not found" };
      }

      await randomDelay(500, 1000);
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.hover();
        await randomDelay(300, 600);
        await passwordInput.click();
        await randomDelay(200, 400);
      }
      for (const char of credentials.password) {
        await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
      }
      await randomDelay(800, 1500);
      await page.keyboard.press("Enter");

      // ログイン完了待ち
      try {
        await page.waitForNavigation({ timeout: 15000 });
      } catch {
        // タイムアウトしても続行
      }

      return null; // success
    };

    // ログイン試行（リトライ付き）
    let loginError = await attemptLogin();
    if (loginError) {
      console.log("First login attempt failed, retrying in 30s...");
      await page.waitForTimeout(30000);
      loginError = await attemptLogin();
      if (loginError) return loginError;
    }

    // ログイン失敗チェック
    const currentUrl = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("error")) {
      return { success: false, error: "Login failed - check username/password" };
    }

    await randomDelay(3000, 5000);

    // ツイートページへ移動
    await page.goto(target.post_url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(2000, 3000);

    // ページをスクロール
    await page.evaluate(() => window.scrollBy(0, 200 + Math.random() * 300));
    await randomDelay(1000, 2000);

    // リプライボタンをクリック
    const replyButton = await page.$('[data-testid="reply"]');
    if (!replyButton) {
      return { success: false, error: "Reply button not found" };
    }
    await replyButton.hover();
    await randomDelay(500, 1000);
    await replyButton.click();
    await randomDelay(1500, 2500);

    // コメント入力
    await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 });
    await randomDelay(500, 1000);
    for (const char of comment.content) {
      await page.keyboard.type(char, { delay: 40 + Math.random() * 80 });
    }
    await randomDelay(1500, 2500);

    // 投稿ボタン
    const tweetBtn = await page.$('[data-testid="tweetButton"]');
    if (tweetBtn) {
      await tweetBtn.hover();
      await randomDelay(300, 600);
      await tweetBtn.click();
    }
    await page.waitForTimeout(3000);

    return { success: true };
  } catch (err) {
    console.error("Twitter post error:", err.message);
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}

async function testTwitterLogin(page, credentials) {
  try {
    page.setDefaultTimeout(60000);

    await page.goto("https://twitter.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await randomDelay(2000, 4000);

    await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 });
    await humanType(page, 'input[autocomplete="username"]', credentials.username);
    await randomDelay(500, 1000);
    await page.keyboard.press("Enter");
    await randomDelay(1500, 2500);

    try {
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    } catch {
      return { success: false, error: "セキュリティチェックが発生しました。手動でログインしてください。" };
    }

    await humanType(page, 'input[type="password"]', credentials.password);
    await randomDelay(500, 1000);
    await page.keyboard.press("Enter");

    try {
      await page.waitForNavigation({ timeout: 15000 });
    } catch {}

    // ログイン後のURLを確認
    const url = page.url();
    if (url.includes("/home") || url.includes("/compose") || !url.includes("login")) {
      return { success: true, message: "Twitterログイン成功" };
    }

    return { success: false, error: "ログインに失敗した可能性があります" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---- Helpers ----

async function updateCommentStatus(commentId, status, errorMessage = null) {
  const update = { status };
  if (status === "posted") {
    update.posted_at = new Date().toISOString();
  }
  if (errorMessage) {
    update.error_message = errorMessage;
  }
  await supabase.from("comments").update(update).eq("id", commentId);
}

// ---- Start Server ----

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`🎭 Playwright server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
