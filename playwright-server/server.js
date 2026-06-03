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

// Railway healthcheck (root path)
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "spark-playwright" });
});

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

// ── Concurrency limiter: max 2 Chromium instances at once (Railway 512MB RAM)
let activeCount = 0;
const MAX_CONCURRENT = 2;
const waitQueue = []; // plain JS array of resolve callbacks

function acquireSlot() {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise(resolve => waitQueue.push(resolve));
}

function releaseSlot() {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift();
    if (next) next(); // hand slot directly to the next waiter
  } else {
    activeCount--;
  }
}

// お問い合わせフォーム自動送信エンドポイント
app.post("/submit-contact-form", authMiddleware, async (req, res) => {
  const { target_id, website_url, contact_url, message, sender_name, sender_email, company_name } = req.body;
  console.log("[form] Submitting contact form for:", contact_url || website_url);

  // Acquire concurrency slot before launching browser (prevents OOM on Railway 512MB)
  await acquireSlot();
  console.log(`[form] Acquired slot. Active: ${activeCount}/${MAX_CONCURRENT}, queued: ${waitQueue.length}`);

// ── シングルトンブラウザ: 起動コストを1回に抑える ──
// 1件ごとに chromium.launch() すると3-5秒かかるため
// プロセス起動時に1度だけ起動し、リクエストごとにコンテキストを作成・破棄する
const BROWSER_ARGS = [
  "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
  "--disable-gpu", "--no-first-run", "--no-zygote", "--single-process",
  "--disable-extensions",
  "--lang=ja-JP",
  "--accept-lang=ja-JP,ja,en",
];
const BROWSER_CONTEXT_OPTIONS = {
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  extraHTTPHeaders: { "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8" },
};

let sharedBrowser = null;
async function getSharedBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  console.log("[browser] Launching shared Chromium instance...");
  sharedBrowser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: BROWSER_ARGS,
  });
  sharedBrowser.on("disconnected", () => { sharedBrowser = null; console.log("[browser] Shared browser disconnected, will re-launch on next request"); });
  console.log("[browser] Shared Chromium ready");
  return sharedBrowser;
}

  const browser = await getSharedBrowser();
  let context;
  try {
    // リクエストごとに新しいコンテキストを作成（ブラウザは使い回す）
    // locale: 'ja-JP' → fill() が IME を経由せず日本語をそのまま入力
    context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);

    // Fix 1: Googleマップや無効なURLはコンタクトフォームではないのでスキップ
    const isInvalidContactUrl = (url) => {
      if (!url) return true;
      if (url.includes('google.com/maps')) return true;
      if (url.includes('goo.gl')) return true;
      if (url.includes('maps.app')) return true;
      if (url.includes('maps.google')) return true;
      return false;
    };

    // If contact_url is provided and valid, go directly — skip crawling
    if (contact_url && contact_url.startsWith("http") && !isInvalidContactUrl(contact_url)) {
      await page.goto(contact_url, { waitUntil: "domcontentloaded", timeout: 10000 });
      console.log("[form] Navigated directly to contact_url:", page.url());
    } else {
      if (isInvalidContactUrl(contact_url)) {
        console.log("[form] contact_url is a Maps/invalid URL, ignoring:", contact_url);
      }
      // 1. Navigate to root site
      await page.goto(website_url, { waitUntil: "domcontentloaded", timeout: 10000 });
      console.log("[form] Navigated to:", page.url());

      // 2. Try to find contact page link
      const contactLinks = await page.$$eval("a", (links) =>
        links
          .map((l) => ({ href: l.href, text: (l.textContent || "").toLowerCase().trim() }))
          .filter((l) => l.href && l.href.startsWith("http") && (
            l.text.includes("contact") || l.text.includes("お問い合わせ") ||
            l.text.includes("連絡") || l.text.includes("問合") || l.text.includes("inquiry")
          ))
      ).catch(() => []);

      if (contactLinks.length > 0) {
        console.log("[form] Found contact link:", contactLinks[0].href);
        await page.goto(contactLinks[0].href, { waitUntil: "domcontentloaded", timeout: 6000 });
        await page.waitForTimeout(800); // reduced from 1500
      }
    }

    // 3. フォームフィールドを検出して入力
    const nameSelectors = ['input[name*="name" i]','input[placeholder*="名前"]','input[placeholder*="氏名"]','input[id*="name" i]','input[autocomplete="name"]'];
    const emailSelectors = ['input[type="email"]','input[name*="email" i]','input[placeholder*="メール"]','input[placeholder*="mail" i]'];
    const messageSelectors = [
      // name属性
      'textarea[name*="message" i]',
      'textarea[name*="content" i]',
      'textarea[name*="body" i]',
      'textarea[name*="comment" i]',
      'textarea[name*="inquiry" i]',
      'textarea[name*="toiawase" i]',
      'textarea[name*="text" i]',
      'textarea[name*="msg" i]',
      'textarea[name*="detail" i]',
      'textarea[name*="description" i]',
      'textarea[name*="memo" i]',
      'textarea[name*="note" i]',
      'textarea[name*="question" i]',
      'textarea[name*="remarks" i]',
      'textarea[name*="naiyo" i]',
      // id属性
      'textarea[id*="message" i]',
      'textarea[id*="content" i]',
      'textarea[id*="inquiry" i]',
      'textarea[id*="body" i]',
      'textarea[id*="text" i]',
      'textarea[id*="detail" i]',
      // class属性
      'textarea[class*="message" i]',
      'textarea[class*="inquiry" i]',
      'textarea[class*="contact" i]',
      // placeholder（日本語）
      'textarea[placeholder*="お問い合わせ"]',
      'textarea[placeholder*="メッセージ"]',
      'textarea[placeholder*="内容"]',
      'textarea[placeholder*="ご質問"]',
      'textarea[placeholder*="ご要望"]',
      'textarea[placeholder*="お聞きしたい"]',
      'textarea[placeholder*="詳細"]',
      'textarea[placeholder*="具体的"]',
      // form内の任意 textarea
      'form textarea',
      // 最終手段
      'textarea',
    ];

    let filledName = false, filledEmail = false, filledMessage = false;

    for (const sel of nameSelectors) {
      try { await page.fill(sel, sender_name, { timeout: 2000 }); filledName = true; console.log("[form] Filled name:", sel); break; } catch {}
    }
    for (const sel of emailSelectors) {
      try { await page.fill(sel, sender_email, { timeout: 2000 }); filledEmail = true; console.log("[form] Filled email:", sel); break; } catch {}
    }
    for (const sel of messageSelectors) {
      try { await page.fill(sel, message, { timeout: 2000 }); filledMessage = true; console.log("[form] Filled message:", sel); break; } catch {}
    }

    // Fix 1: 会社名・電話・件名・部署など必須フィールドを追加入力
    const companySelectors = [
      'input[name*="company" i]', 'input[name*="organization" i]', 'input[name*="kaisha" i]',
      'input[placeholder*="会社名"]', 'input[placeholder*="企業名"]', 'input[placeholder*="組織名"]',
      'input[id*="company" i]',
    ];
    for (const sel of companySelectors) {
      try { await page.fill(sel, company_name || sender_name, { timeout: 1500 }); console.log('[form] Filled company:', sel); break; } catch {}
    }

    const phoneSelectors = [
      'input[name*="phone" i]', 'input[name*="tel" i]',
      'input[placeholder*="電話"]', 'input[placeholder*="TEL"]',
      'input[type="tel"]', 'input[id*="phone" i]', 'input[id*="tel" i]',
    ];
    for (const sel of phoneSelectors) {
      try { await page.fill(sel, '03-0000-0000', { timeout: 1500 }); console.log('[form] Filled phone:', sel); break; } catch {}
    }

    const subjectSelectors = [
      'input[name*="subject" i]', 'input[name*="title" i]',
      'input[placeholder*="件名"]', 'input[placeholder*="タイトル"]', 'input[placeholder*="Subject"]',
      'input[id*="subject" i]', 'input[id*="title" i]',
    ];
    for (const sel of subjectSelectors) {
      try { await page.fill(sel, 'Spark AIのご案内', { timeout: 1500 }); console.log('[form] Filled subject:', sel); break; } catch {}
    }

    const deptSelectors = [
      'input[name*="department" i]', 'input[name*="busho" i]',
      'input[placeholder*="部署"]', 'input[placeholder*="部門"]',
    ];
    for (const sel of deptSelectors) {
      try { await page.fill(sel, '営業部', { timeout: 1500 }); console.log('[form] Filled dept:', sel); break; } catch {}
    }

    // Fix 2: iframe内のフォームに対応
    if (!filledMessage) {
      console.log("[form] Trying iframe fallback for message...");
      const frames = page.frames();
      for (const frame of frames) {
        if (filledMessage) break;
        for (const sel of messageSelectors) {
          try {
            await frame.fill(sel, message, { timeout: 2000 });
            filledMessage = true;
            console.log("[form] Filled message in iframe via:", sel);
            // iframe内では name/email も埋める
            for (const ns of nameSelectors) {
              try { await frame.fill(ns, sender_name, { timeout: 1500 }); filledName = true; break; } catch {}
            }
            for (const es of emailSelectors) {
              try { await frame.fill(es, sender_email, { timeout: 1500 }); filledEmail = true; break; } catch {}
            }
            break;
          } catch {}
        }
      }
    }

    console.log(`[form] Fill results — name:${filledName} email:${filledEmail} message:${filledMessage}`);

    // フォールバック: contact_urlにtextareaがなければwebsite_urlトップから再探索
    if (!filledMessage && website_url && page.url() !== website_url) {
      console.log('[form] Fallback: contact_url had no form, trying website root...');
      try {
        await page.goto(website_url, { waitUntil: 'domcontentloaded', timeout: 10000 });

        // トップページからお問い合わせリンクを探す
        const contactLinks = await page.$$eval('a', links =>
          links
            .map(l => ({ href: l.href, text: (l.textContent || '').trim() }))
            .filter(l => l.href && l.href.startsWith('http') && (
              l.text.includes('お問い合わせ') ||
              l.text.includes('問い合わせ') ||
              l.text.includes('contact') ||
              l.text.includes('Contact') ||
              l.text.includes('inquiry') ||
              l.href.includes('contact') ||
              l.href.includes('inquiry') ||
              l.href.includes('toiawase')
            ))
        ).catch(() => []);

        if (contactLinks.length > 0) {
          console.log('[form] Fallback contact link found:', contactLinks[0].href);
          await page.goto(contactLinks[0].href, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await page.waitForTimeout(800);

          // 再度メッセージフィールドを探す
          for (const sel of messageSelectors) {
            try {
              await page.fill(sel, message, { timeout: 2000 });
              filledMessage = true;
              console.log('[form] Fallback filled message via:', sel);
              // name/email も再試行
              for (const ns of nameSelectors) {
                try { await page.fill(ns, sender_name, { timeout: 1500 }); filledName = true; break; } catch {}
              }
              for (const es of emailSelectors) {
                try { await page.fill(es, sender_email, { timeout: 1500 }); filledEmail = true; break; } catch {}
              }
              break;
            } catch {}
          }
        } else {
          console.log('[form] Fallback: no contact link found on root page');
        }
      } catch (fallbackErr) {
        console.warn('[form] Fallback error:', fallbackErr.message);
      }
    }

    // Fix 3: フィールドが見つからない場合のデバッグログ
    if (!filledMessage) {
      const textareas = await page.$$eval('textarea', els =>
        els.map(el => ({ name: el.name, id: el.id, placeholder: el.placeholder, className: el.className.slice(0, 80) }))
      ).catch(() => []);
      console.log('[form] Available textareas:', JSON.stringify(textareas));
      console.log('[form] Page URL:', page.url());
      console.log('[form] Page title:', await page.title().catch(() => '(error)'));
      throw new Error("メッセージフィールドが見つかりませんでした");
    }

    // 4. 送信ボタンをクリック
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("送信")',
      'button:has-text("Submit")',
      'button:has-text("送る")',
      'button:has-text("確認")',
      'button:has-text("次へ")',
      'button:has-text("進む")',
      'button:has-text("申し込む")',
      'button:has-text("問い合わせる")',
      'button:has-text("Send")',
      'button:has-text("お問い合わせ")',
      '[type="submit"]',
      '.submit',
      '.btn-submit',
      'button.submit',
      'input.submit',
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = await page.$(sel);
        if (!btn) continue;
        const isVisible = await btn.isVisible();
        if (!isVisible) { console.log('[form] Button not visible:', sel); continue; }
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(500); // クリック後のDOM更新を待つ
        submitted = true;
        console.log('[form] Submitted via:', sel);
        break;
      } catch (e) {
        console.log('[form] Submit failed for:', sel, e.message);
      }
    }

    // 送信ボタンが見つからない場合のデバッグ
    if (!submitted) {
      const buttons = await page.$$eval('button, input[type="submit"]', els =>
        els.map(el => ({
          type: el.type || '',
          text: el.textContent?.trim().slice(0, 40) || '',
          className: el.className.slice(0, 60),
          visible: el.offsetParent !== null,
        }))
      ).catch(() => []);
      console.log('[form] Available buttons:', JSON.stringify(buttons));
    }

    // Fix 2: disabled ボタンをJavaScriptで強制クリック
    if (!submitted) {
      try {
        submitted = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"], [type="submit"]'));
          const btn = btns.find(b => b.offsetParent !== null);
          if (btn) {
            btn.removeAttribute('disabled');
            btn.click();
            return true;
          }
          return false;
        });
        if (submitted) console.log('[form] Submitted via JS force click (disabled removed)');
      } catch (e) {
        console.log('[form] JS force click failed:', e.message);
      }
    }

    // Fix 3: form.submit() による最終フォールバック
    if (!submitted) {
      try {
        submitted = await page.evaluate(() => {
          const form = document.querySelector('form');
          if (form) { form.submit(); return true; }
          return false;
        });
        if (submitted) console.log('[form] Submitted via form.submit()');
        if (submitted) await page.waitForTimeout(300);
      } catch (e) {
        console.log('[form] form.submit() failed:', e.message);
      }
    }

    // ── 送信後の成否確認 ──
    let confirmationStatus = "unconfirmed"; // confirmed / unconfirmed / failed
    let confirmationReason = "";
    let screenshotUrl = null;

    if (submitted) {
      // 送信後800ms待機（ページ遷移・DOM更新を待つ）
      await page.waitForTimeout(800);

      const afterUrl = page.url();
      const afterTitle = await page.title().catch(() => "");

      // 1. URL遷移チェック
      const SUCCESS_URL_PATTERNS = /\/(thanks|thank[-_]?you|complete|done|confirmation|confirm|success|finished|sent|submitted|receipt)/i;
      if (SUCCESS_URL_PATTERNS.test(afterUrl)) {
        confirmationStatus = "confirmed";
        confirmationReason = `URL遷移: ${afterUrl}`;
        console.log(`[form] ✅ Confirmed by URL: ${afterUrl}`);
      }

      // 2. ページテキストチェック（URLで確認できなかった場合も実行）
      if (confirmationStatus !== "confirmed") {
        try {
          const bodyText = await page.evaluate(() => document.body?.innerText || "");
          const SUCCESS_TEXT_PATTERNS = /送信しました|ありがとうございます|送信が完了|お問い合わせを受け付|受付(?:いたし|まし)|完了しました|thank you|thanks for|message received|successfully sent|form submitted|we.*received|inquiry.*received/i;
          if (SUCCESS_TEXT_PATTERNS.test(bodyText)) {
            confirmationStatus = "confirmed";
            const matchSnippet = bodyText.match(SUCCESS_TEXT_PATTERNS)?.[0] || "";
            confirmationReason = `完了テキスト検出: "${matchSnippet}"`;
            console.log(`[form] ✅ Confirmed by text: "${matchSnippet}"`);
          }
        } catch (textErr) {
          console.log("[form] Text check error:", textErr.message);
        }
      }

      if (confirmationStatus === "unconfirmed") {
        confirmationReason = `送信ボタンはクリックしたが完了ページ・完了テキストを確認できず (URL: ${afterUrl})`;
        console.log(`[form] ⚠️ Unconfirmed: ${confirmationReason}`);
      }

      // 3. スクリーンショット撮影 → Supabase Storage に保存
      try {
        const screenshotBuffer = await page.screenshot({ type: "webp", quality: 70, fullPage: false });
        const fileName = `form-screenshots/${target_id}_${Date.now()}.webp`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from("outreach-screenshots")
          .upload(fileName, screenshotBuffer, { contentType: "image/webp", upsert: true });
        if (uploadErr) {
          console.log("[form] Screenshot upload error:", uploadErr.message);
        } else {
          const { data: publicUrlData } = supabase.storage.from("outreach-screenshots").getPublicUrl(fileName);
          screenshotUrl = publicUrlData?.publicUrl || null;
          console.log(`[form] 📷 Screenshot saved: ${screenshotUrl}`);
        }
      } catch (ssErr) {
        console.log("[form] Screenshot error:", ssErr.message);
      }
    } else {
      confirmationStatus = "failed";
      confirmationReason = "送信ボタンが見つからなかったか、クリックに失敗しました";
    }

    // Update Supabase target status
    if (target_id) {
      const newStatus = confirmationStatus === "confirmed" ? "contacted"
        : confirmationStatus === "unconfirmed" ? "contacted_unconfirmed"
        : "form_failed";
      const updatePayload = {
        contacted_at: new Date().toISOString(),
        status: newStatus,
        ai_reason: confirmationReason,
        ...(screenshotUrl ? { screenshot_url: screenshotUrl } : {}),
      };
      await supabase.from("targets").update(updatePayload).eq("id", target_id);
      console.log(`[form] DB updated: status=${newStatus} confirmation=${confirmationStatus}`);
    }

    res.json({
      success: submitted,
      confirmation: confirmationStatus,   // "confirmed" | "unconfirmed" | "failed"
      confirmationReason,
      screenshotUrl,
      filled: { name: filledName, email: filledEmail, message: filledMessage },
      submitted,
    });

  } catch (err) {
    console.error("[form] Error:", err.message);
    res.json({ success: false, error: err.message });
  } finally {
    // ブラウザは使い回すのでコンテキストのみ閉じる
    if (context) await context.close().catch(() => {});
    releaseSlot();
    console.log(`[form] Released slot. Active: ${activeCount}/${MAX_CONCURRENT}, queued: ${waitQueue.length}`);
  }
});

// 公式サイトからお問い合わせリンクを探すエンドポイント（fix-contact-url のフォールバック）
app.post("/find-contact-link", authMiddleware, async (req, res) => {
  const { website_url } = req.body;
  if (!website_url) return res.status(400).json({ error: "website_url required" });

  console.log("[find-contact] Crawling:", website_url);
  const browser = await getSharedBrowser();
  let context;
  try {
    context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);

    await page.goto(website_url, { waitUntil: "domcontentloaded", timeout: 12000 });

    // お問い合わせリンクを探す（テキスト・href両方でチェック）
    const contactLink = await page.evaluate(() => {
      const KEYWORDS_TEXT = ["お問い合わせ", "問い合わせ", "contact", "Contact", "inquiry", "Inquiry", "相談", "資料請求"];
      const KEYWORDS_HREF = ["/contact", "/inquiry", "/inquire", "/form", "/support", "/お問い合わせ", "/toiawase", "/request"];
      const EXCLUDED = ["twitter.com", "x.com", "facebook.com", "instagram.com", "linkedin.com", "youtube.com"];
      const IMAGE_RE = /\.(png|jpg|jpeg|gif|svg|webp|ico|bmp)(\?.*)?$/i;

      const links = Array.from(document.querySelectorAll("a[href]"));
      const safe = (u) => {
        if (!u || IMAGE_RE.test(u)) return false;
        try { return !EXCLUDED.some(ex => new URL(u, location.href).hostname.includes(ex)); } catch { return false; }
      };
      const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };

      // テキストマッチ優先
      for (const a of links) {
        const text = (a.textContent || "").trim();
        const href = a.getAttribute("href") || "";
        const full = abs(href);
        if (!full || !safe(full)) continue;
        if (KEYWORDS_TEXT.some(k => text.includes(k))) return full;
      }
      // hrefパスマッチ
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        const full = abs(href);
        if (!full || !safe(full)) continue;
        if (KEYWORDS_HREF.some(k => full.includes(k))) return full;
      }
      return null;
    });

    console.log("[find-contact] Found:", contactLink || "none");
    res.json({ contactUrl: contactLink || null });
  } catch (err) {
    console.error("[find-contact] Error:", err.message);
    res.json({ contactUrl: null, error: err.message });
  } finally {
    if (context) await context.close().catch(() => {});
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
