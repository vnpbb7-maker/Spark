import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { email, campaignName, successCount, failCount } = await req.json().catch(() => ({}));

  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  // 完了サマリーをログ出力（Vercelログで確認可能）
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[send-report] 📊 一括送信完了レポート`);
  console.log(`[send-report] キャンペーン: ${campaignName || "不明"}`);
  console.log(`[send-report] 送信先メール: ${email}`);
  console.log(`[send-report] 日時: ${new Date().toLocaleString("ja-JP")}`);
  console.log(`[send-report] ✅ 送信成功: ${successCount ?? 0}件`);
  console.log(`[send-report] ❌ 送信失敗: ${failCount ?? 0}件`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // RESEND_API_KEY が設定されていれば Resend でメール送信
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: "Spark AI <noreply@spark-ai.jp>",
          to: [email],
          subject: `【Spark AI】送信完了 ✅${successCount ?? 0}件成功 / ❌${failCount ?? 0}件失敗`,
          text: [
            `【Spark AI】一括送信完了レポート`,
            ``,
            `キャンペーン: ${campaignName || "不明"}`,
            `送信日時: ${new Date().toLocaleString("ja-JP")}`,
            ``,
            `━━━━━━━━━━━━━━`,
            `✅ 送信成功: ${successCount ?? 0}件`,
            `❌ 送信失敗: ${failCount ?? 0}件`,
            `━━━━━━━━━━━━━━`,
            ``,
            `Spark AI https://spark-ai.jp`,
          ].join("\n"),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        console.log("[send-report] ✅ Resend email sent to:", email);
        return NextResponse.json({ sent: true, method: "resend" });
      }
      const err = await res.text().catch(() => "");
      console.error("[send-report] Resend error:", res.status, err.slice(0, 200));
    } catch (e) {
      console.error("[send-report] Resend fetch error:", e);
    }
  } else {
    console.log("[send-report] RESEND_API_KEY not set — email skipped (report logged above)");
  }

  // メール送信できなくても「完了」として返す（ジョブ自体は成功）
  return NextResponse.json({ sent: false, logged: true, message: "レポートはVercelログに記録されました" });
}
