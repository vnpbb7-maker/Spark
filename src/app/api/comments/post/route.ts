import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { comment_id } = await req.json();

  const playwrightUrl = process.env.PLAYWRIGHT_SERVER_URL;
  const playwrightKey = process.env.PLAYWRIGHT_API_KEY;

  // Playwrightサーバーが未設定の場合は承認のみ（投稿はキューに入る）
  if (!playwrightUrl) {
    console.log("PLAYWRIGHT_SERVER_URL not set, comment approved but not posted:", comment_id);
    return NextResponse.json({
      success: true,
      queued: true,
      message: "承認しました。投稿サーバー設定後に自動投稿されます。",
    });
  }

  try {
    const res = await fetch(`${playwrightUrl}/post-comment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": playwrightKey || "",
      },
      body: JSON.stringify({ comment_id }),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Playwright server error:", err);
    return NextResponse.json({
      success: true,
      queued: true,
      message: "承認しました。投稿サーバーに接続できなかったため、後で自動投稿されます。",
    });
  }
}
