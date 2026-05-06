import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await request.json();
    const {
      product_url,
      product_description,
      target_personas,
      analysis_cache,
      copied_from,
      platforms,
      daily_limit,
      tone,
      auto_mode,
      target_language,
      required_keywords,
      min_match_score,
    } = body;

    if (!product_description) {
      return NextResponse.json(
        { error: "プロダクト説明が必要です" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        user_id: user.id,
        product_url: product_url || null,
        product_description,
        target_personas,
        analysis_cache: analysis_cache || target_personas || null,
        copied_from: copied_from || null,
        platforms: platforms || [],
        daily_limit: daily_limit || 10,
        tone: tone || "casual",
        auto_mode: auto_mode || false,
        target_language: target_language || "ja",
        required_keywords: required_keywords || "",
        min_match_score: min_match_score || 60,
        status: "running",
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { error: "キャンペーンの保存に失敗しました" },
        { status: 500 }
      );
    }

    // If copied from an existing campaign, copy targets and comments
    if (copied_from) {
      try {
        const { data: srcTargets } = await supabase
          .from("targets")
          .select("*, comments(*)")
          .eq("campaign_id", copied_from)
          .limit(100);

        if (srcTargets && srcTargets.length > 0) {
          for (const t of srcTargets) {
            const { data: newTarget } = await supabase
              .from("targets")
              .insert({
                campaign_id: data.id,
                platform: t.platform,
                username: t.username,
                profile_url: t.profile_url,
                post_url: t.post_url,
                post_content: t.post_content,
                match_score: t.match_score,
                match_reason: t.match_reason,
                priority: t.priority,
                ai_reason: t.ai_reason,
                estimated_age: t.estimated_age,
                estimated_role: t.estimated_role,
                email: t.email,
                phone: t.phone,
                website: t.website,
                contact_url: t.contact_url,
                status: t.status || "pending",
              })
              .select()
              .single();

            if (newTarget && t.comments) {
              const comments = t.comments as Array<Record<string, unknown>>;
              for (const c of comments) {
                await supabase.from("comments").insert({
                  target_id: newTarget.id,
                  campaign_id: data.id,
                  platform: c.platform,
                  content: c.content,
                  approach: c.approach,
                  approved: false,
                });
              }
            }
          }
          console.log(`Copied ${srcTargets.length} targets from campaign ${copied_from}`);
        }
      } catch (copyErr) {
        console.error("Copy targets error (non-blocking):", copyErr);
      }
    }

    // Inngest: ターゲット発見ジョブを発火（失敗してもキャンペーン作成は成功させる）
    try {
      console.log("[create] Sending inngest campaign/discover for:", data.id, "copied_from:", copied_from || "none");
      await inngest.send({
        name: "campaign/discover",
        data: { campaign_id: data.id },
      });
      console.log("[create] Inngest send success");
    } catch (inngestError) {
      console.error("Inngest send error (non-blocking):", inngestError);
    }

    return NextResponse.json({ id: data.id, redirect: `/campaigns/${data.id}` });
  } catch (error) {
    console.error("Campaign create error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `キャンペーンの作成に失敗しました: ${message}` },
      { status: 500 }
    );
  }
}
