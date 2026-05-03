import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { comment_id } = await req.json();

  const playwrightUrl = process.env.PLAYWRIGHT_SERVER_URL;
  const playwrightKey = process.env.PLAYWRIGHT_API_KEY;

  if (!playwrightUrl) {
    return NextResponse.json(
      { success: false, error: "PLAYWRIGHT_SERVER_URL is not configured" },
      { status: 500 }
    );
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
    return NextResponse.json(
      { success: false, error: "Playwright server is unreachable" },
      { status: 502 }
    );
  }
}
