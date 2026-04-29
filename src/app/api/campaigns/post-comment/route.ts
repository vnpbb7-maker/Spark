import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { randomDelay } from "@/lib/playwright/human";
import { postRedditComment } from "@/lib/playwright/platforms/reddit";
import { postTwitterReply } from "@/lib/playwright/platforms/twitter";
import { postLinkedInComment } from "@/lib/playwright/platforms/linkedin";
import { postTikTokComment } from "@/lib/playwright/platforms/tiktok";
import { postInstagramComment } from "@/lib/playwright/platforms/instagram";
import { postFacebookComment } from "@/lib/playwright/platforms/facebook";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const { comment_id } = await request.json();

    // Get comment + target
    const { data: comment } = await supabase.from("comments").select("*, targets(*)").eq("id", comment_id).single();
    if (!comment) return NextResponse.json({ error: "コメントが見つかりません" }, { status: 404 });

    const target = (comment as Record<string, unknown>).targets as Record<string, string>;
    const platform = comment.platform as string;
    const postUrl = target.post_url;

    // Get credentials
    const { data: cred } = await supabase.from("platform_credentials").select("credentials").eq("user_id", user.id).eq("platform", platform).single();
    if (!cred) return NextResponse.json({ error: `${platform}の認証情報が設定されていません` }, { status: 400 });

    const credentials = cred.credentials as Record<string, string>;

    // Random delay for bot avoidance
    await randomDelay(5000, 15000);

    // Post based on platform
    let success = false;
    const content = comment.content as string;
    switch (platform) {
      case "reddit": success = await postRedditComment(postUrl, content, { username: credentials.username, password: credentials.password }); break;
      case "twitter": success = await postTwitterReply(postUrl, content, { username: credentials.username, password: credentials.password }); break;
      case "linkedin": success = await postLinkedInComment(postUrl, content, { email: credentials.email, password: credentials.password }); break;
      case "tiktok": success = await postTikTokComment(postUrl, content, { username: credentials.username, password: credentials.password }); break;
      case "instagram": success = await postInstagramComment(postUrl, content, { username: credentials.username, password: credentials.password }); break;
      case "facebook": success = await postFacebookComment(postUrl, content, { email: credentials.email, password: credentials.password }); break;
    }

    if (success) {
      await supabase.from("comments").update({ posted_at: new Date().toISOString() }).eq("id", comment_id);
      await supabase.from("targets").update({ status: "posted", contacted_at: new Date().toISOString() }).eq("id", target.id);
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: "投稿に失敗しました" }, { status: 500 });
    }
  } catch (error) {
    console.error("Post comment error:", error);
    return NextResponse.json({ error: "投稿実行に失敗しました" }, { status: 500 });
  }
}
