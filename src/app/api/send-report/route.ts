import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function sendViaGmailMcp(
  toEmail: string,
  subject: string,
  body: string
): Promise<{ sent: boolean }> {
  const mcpUrl = process.env.GMAIL_MCP_URL || "";
  console.log("[send-report] GMAIL_MCP_URL:", mcpUrl || "NOT SET");
  console.log("[send-report] Sending report to:", toEmail);

  if (!mcpUrl || !process.env.ANTHROPIC_API_KEY) {
    console.warn("[send-report] GMAIL_MCP_URL or ANTHROPIC_API_KEY not configured — skipping report email");
    return { sent: false };
  }

  try {
    // Anthropic API 経由で Gmail MCP を呼び出す（submit-form と同じパターン）
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Send an email to ${toEmail} with subject "${subject}" and body:\n\n${body}\n\nUse the Gmail tool to send it. Reply only with {"sent": true} after sending.`,
        }],
        mcp_servers: [{ type: "url", url: mcpUrl, name: "gmail-mcp" }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (res.ok) {
      const data = await res.json();
      const text = (data.content?.[0]?.text || "").toLowerCase();
      if (text.includes("sent") || text.includes("true")) {
        console.log("[send-report] Report email sent to:", toEmail);
        return { sent: true };
      }
      console.warn("[send-report] Claude responded but no sent=true:", text.slice(0, 100));
    } else {
      const errText = await res.text().catch(() => "");
      console.error("[send-report] Anthropic API error:", res.status, errText.slice(0, 200));
    }
  } catch (e) {
    console.error("[send-report] Gmail MCP error:", e);
  }
  return { sent: false };
}

export async function POST(req: NextRequest) {
  const { email, campaignName, successCount, failCount } = await req.json().catch(() => ({}));

  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const reportBody = [
    `【Spark AI】一括送信完了レポート`,
    ``,
    `キャンペーン: ${campaignName || "不明"}`,
    `送信日時: ${new Date().toLocaleString("ja-JP")}`,
    ``,
    `━━━━━━━━━━━━━━`,
    `✅ 送信成功: ${successCount || 0}件`,
    `❌ 送信失敗: ${failCount || 0}件`,
    `━━━━━━━━━━━━━━`,
    ``,
    `---`,
    `Spark AI https://spark-ai.jp`,
  ].join("\n");

  const { sent } = await sendViaGmailMcp(
    email,
    `【Spark AI】送信完了 ✅${successCount}件成功 / ❌${failCount}件失敗`,
    reportBody
  );

  return NextResponse.json({ sent });
}
