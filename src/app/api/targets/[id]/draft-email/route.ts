import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: targetId } = await params;
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    // Get target with campaign info
    const { data: target } = await supabase
      .from("targets")
      .select("*, campaigns(*)")
      .eq("id", targetId)
      .single();

    if (!target) {
      return NextResponse.json(
        { error: "ターゲットが見つかりません" },
        { status: 404 }
      );
    }

    const campaign = target.campaigns as Record<string, unknown>;
    if (campaign.user_id !== user.id) {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const email = target.email as string;
    if (!email || email.startsWith("Twitter:")) {
      return NextResponse.json(
        { error: "このターゲットにはメールアドレスがありません" },
        { status: 400 }
      );
    }

    // Generate personalized email with Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        temperature: 0.7,
        system: `You are a Japanese business email writer. Write natural, warm, non-salesy emails.
Always respond with JSON: {"subject": "件名", "body": "本文"}
The email should:
- Reference the recipient's specific post/activity
- Be genuine and personal, not corporate
- Explain why they'd be a perfect beta tester
- Keep it concise (under 200 words)
- Use polite Japanese (です/ます調)
- Include a clear call to action`,
        messages: [
          {
            role: "user",
            content: `以下の情報でβテスト招待メールを作成してください。

宛先: @${target.username} (${target.platform})
相手の投稿内容: ${(target.post_content as string || "").slice(0, 300)}
AI分析: ${target.ai_reason || ""}
プロダクト: ${campaign.product_description || campaign.product_url || ""}

JSONで返してください: {"subject": "件名", "body": "本文"}`,
          },
        ],
      }),
    });

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return NextResponse.json(
        { error: "メール生成に失敗しました" },
        { status: 500 }
      );
    }

    const emailContent = JSON.parse(jsonMatch[0]);
    const subject = emailContent.subject || "βテストのご案内";
    const body = emailContent.body || "";

    // Create mailto link (universal, no Gmail API needed)
    const mailtoUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // Update target to mark email was drafted
    await supabase
      .from("targets")
      .update({ status: "email_drafted" })
      .eq("id", targetId);

    return NextResponse.json({
      success: true,
      email_to: email,
      subject,
      body,
      draft_url: mailtoUrl,
    });
  } catch (e) {
    console.error("Draft email error:", e);
    return NextResponse.json(
      { error: "メール下書き作成に失敗しました" },
      { status: 500 }
    );
  }
}
