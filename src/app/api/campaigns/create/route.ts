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
      platforms,
      daily_limit,
      tone,
      auto_mode,
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
        platforms: platforms || [],
        daily_limit: daily_limit || 10,
        tone: tone || "casual",
        auto_mode: auto_mode || false,
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

    // Inngest: ターゲット発見ジョブを発火（失敗してもキャンペーン作成は成功させる）
    try {
      await inngest.send({
        name: "campaign/discover",
        data: { campaign_id: data.id },
      });
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
