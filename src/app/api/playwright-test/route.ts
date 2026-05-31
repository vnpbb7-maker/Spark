import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/playwright-test
 * Playwrightサーバーへのフォーム送信テスト用エンドポイント
 * 本番のbulk-submitと同じリクエスト形式を使う
 */
export async function POST(req: NextRequest) {
  const playwrightUrl = process.env.PLAYWRIGHT_SERVER_URL;
  const playwrightApiKey = process.env.PLAYWRIGHT_API_KEY;

  if (!playwrightUrl) {
    return NextResponse.json({ error: "PLAYWRIGHT_SERVER_URL not set" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    contact_url = "https://skillive.com/contact",
    website_url = "https://skillive.com",
    company_name = "スキルライブ株式会社（テスト）",
    sender_name = "鈴木 玲奈",
    sender_email = "vnp@skillive.com",
    message = "これはSPARK AIのテスト送信です。届いていれば成功です。",
    target_id = `test-${Date.now()}`,
  } = body;

  console.log(`[playwright-test] → ${contact_url} as "${company_name}"`);

  try {
    const res = await fetch(`${playwrightUrl}/submit-contact-form`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": playwrightApiKey || "",
      },
      body: JSON.stringify({
        target_id,
        website_url,
        contact_url,
        message,
        sender_name,
        sender_email,
        company_name,
      }),
      signal: AbortSignal.timeout(90000), // 90秒（テストなので待つ）
    });

    const text = await res.text();
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); }
    catch { data = { raw: text }; }

    console.log(`[playwright-test] result:`, JSON.stringify(data).slice(0, 300));

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      result: data,
    });
  } catch (err: unknown) {
    const e = err as Error;
    console.error("[playwright-test] error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
