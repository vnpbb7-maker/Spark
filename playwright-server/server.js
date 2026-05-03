const express = require("express");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

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

    // ユーザーの認証情報を取得
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

    const credentials = creds.credentials;
    console.log(`Posting comment on ${platform} to ${target.post_url}`);

    // プラットフォーム別にコメント投稿
    let result;
    switch (platform) {
      case "reddit":
        result = await postRedditComment(credentials, target, comment);
        break;
      case "twitter":
        result = await postTwitterComment(credentials, target, comment);
        break;
      default:
        result = { success: false, error: `${platform} is not yet supported` };
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

    // Reddit ログイン
    await page.goto("https://www.reddit.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await randomDelay(2000, 3000);

    // ユーザー名入力
    await page.waitForSelector("#login-username", { timeout: 30000 });
    await humanType(page, "#login-username", credentials.username);
    await randomDelay(500, 1000);

    // パスワード入力
    await humanType(page, "#login-password", credentials.password);
    await randomDelay(500, 1000);

    // ログインボタン
    await page.click('button[type="submit"]');

    // ログイン完了待ち
    try {
      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
    } catch {
      // タイムアウトしても続行
    }

    // ログイン確認
    const currentUrl = page.url();
    console.log("After Reddit login URL:", currentUrl);

    if (currentUrl.includes("login")) {
      return { success: false, error: "Reddit login failed - check credentials" };
    }

    // 対象投稿に移動
    await randomDelay(2000, 3000);
    await page.goto(target.post_url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await randomDelay(1000, 2000);

    // コメント入力
    const commentBox = await page.$('[contenteditable="true"]');
    if (!commentBox) {
      const textarea = await page.$("textarea");
      if (textarea) {
        await textarea.click();
        for (const char of comment.content) {
          await page.keyboard.type(char, { delay: 30 + Math.random() * 50 });
        }
      } else {
        return { success: false, error: "Comment box not found" };
      }
    } else {
      await commentBox.click();
      for (const char of comment.content) {
        await page.keyboard.type(char, { delay: 30 + Math.random() * 50 });
      }
    }

    await randomDelay(1000, 2000);

    // 投稿ボタンクリック
    const submitBtn = await page.$('button:has-text("Comment")');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(3000);
    }

    return { success: true };
  } catch (err) {
    console.error("Reddit post error:", err.message);
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}

async function testRedditLogin(page, credentials) {
  try {
    page.setDefaultTimeout(60000);

    await page.goto("https://www.reddit.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await randomDelay(2000, 3000);

    await page.waitForSelector("#login-username", { timeout: 30000 });
    await humanType(page, "#login-username", credentials.username);
    await randomDelay(500, 1000);

    await humanType(page, "#login-password", credentials.password);
    await randomDelay(500, 1000);

    await page.click('button[type="submit"]');

    try {
      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
    } catch {}

    const currentUrl = page.url();
    console.log("After Reddit login URL:", currentUrl);

    if (currentUrl.includes("login")) {
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
    ],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    // Twitter ログイン
    await page.goto("https://twitter.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await randomDelay(2000, 4000);

    // ユーザー名入力
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 });
    await humanType(page, 'input[autocomplete="username"]', credentials.username);
    await randomDelay(500, 1000);

    // 「次へ」ボタン
    await page.keyboard.press("Enter");
    await randomDelay(1500, 2500);

    // パスワード入力
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    } catch {
      // 「不審なアクティビティ」画面が出た場合
      return { success: false, error: "Twitter security check triggered" };
    }

    await humanType(page, 'input[type="password"]', credentials.password);
    await randomDelay(500, 1000);
    await page.keyboard.press("Enter");

    // ログイン完了待ち
    try {
      await page.waitForNavigation({ timeout: 15000 });
    } catch {
      // タイムアウトしても続行
    }

    // ログイン失敗チェック
    const currentUrl = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("error")) {
      return { success: false, error: "Login failed - check username/password" };
    }

    await randomDelay(2000, 4000);
    await page.goto(target.post_url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(1000, 2000);

    // リプライボタンをクリック
    const replyButton = await page.$('[data-testid="reply"]');
    if (!replyButton) {
      return { success: false, error: "Reply button not found" };
    }
    await replyButton.click();
    await randomDelay(1000, 2000);

    // コメント入力
    await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 });
    for (const char of comment.content) {
      await page.keyboard.type(char, { delay: 40 + Math.random() * 80 });
    }
    await randomDelay(1000, 2000);

    // 投稿ボタン
    await page.click('[data-testid="tweetButton"]');
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
