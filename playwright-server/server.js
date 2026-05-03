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

    // Reddit ログイン
    await page.goto("https://www.reddit.com/login", {
      waitUntil: "networkidle",
    });
    await page.fill('input[name="username"]', credentials.username);
    await page.fill('input[name="password"]', credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // ログイン確認
    const loginFailed = await page.$('text="Incorrect username or password"');
    if (loginFailed) {
      return { success: false, error: "Reddit login failed" };
    }

    // 投稿ページに移動
    await page.goto(target.post_url, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    // コメント入力
    const commentBox = await page.$('[contenteditable="true"]');
    if (!commentBox) {
      // 別のセレクタを試す
      const textarea = await page.$("textarea");
      if (textarea) {
        await textarea.fill(comment.content);
      } else {
        return { success: false, error: "Comment box not found" };
      }
    } else {
      await commentBox.click();
      await page.keyboard.type(comment.content, { delay: 30 });
    }

    // ランダム遅延（30〜90秒の代わりにテスト用に短く）
    const delay = Math.floor(Math.random() * 3000) + 1000;
    await page.waitForTimeout(delay);

    // 投稿ボタンクリック
    const submitBtn = await page.$('button:has-text("Comment")');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(3000);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}

async function testRedditLogin(page, credentials) {
  try {
    await page.goto("https://www.reddit.com/login", {
      waitUntil: "networkidle",
    });
    await page.fill('input[name="username"]', credentials.username);
    await page.fill('input[name="password"]', credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    const loginFailed = await page.$('text="Incorrect username or password"');
    if (loginFailed) {
      return { success: false, error: "ユーザー名またはパスワードが正しくありません" };
    }

    return { success: true, message: "Redditログイン成功" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---- Twitter ----

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

    // Twitter ログイン
    await page.goto("https://twitter.com/i/flow/login", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);

    // ユーザー名入力
    const usernameInput = await page.$('input[autocomplete="username"]');
    if (usernameInput) {
      await usernameInput.fill(credentials.username);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);
    }

    // パスワード入力
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.fill(credentials.password);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);
    }

    // 投稿に移動
    await page.goto(target.post_url, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    // リプライ入力
    const replyBox = await page.$('[data-testid="tweetTextarea_0"]');
    if (!replyBox) {
      return { success: false, error: "Reply box not found" };
    }
    await replyBox.click();
    await page.keyboard.type(comment.content, { delay: 50 });

    // ランダム遅延
    const delay = Math.floor(Math.random() * 3000) + 1000;
    await page.waitForTimeout(delay);

    // 投稿
    const replyBtn = await page.$('[data-testid="tweetButtonInline"]');
    if (replyBtn) {
      await replyBtn.click();
      await page.waitForTimeout(3000);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}

async function testTwitterLogin(page, credentials) {
  try {
    await page.goto("https://twitter.com/i/flow/login", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);

    const usernameInput = await page.$('input[autocomplete="username"]');
    if (usernameInput) {
      await usernameInput.fill(credentials.username);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);
    }

    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.fill(credentials.password);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);
    }

    // ログイン後のURLを確認
    const url = page.url();
    if (url.includes("/home") || url.includes("/compose")) {
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
