import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const getSupabaseAdmin = () =>
  createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaign_id: string; target_id: string }> }
) {
  const { campaign_id, target_id } = await params;
  const supabase = getSupabaseAdmin();

  // クリックを記録（非同期・失敗しても続行）
  supabase.from("conversions").insert({
    campaign_id,
    target_id,
    ip_address: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "",
    user_agent: req.headers.get("user-agent") || "",
  }).then(({ error }) => {
    if (error) console.error("[track] insert error:", error.message);
    else console.log(`[track] click recorded campaign=${campaign_id} target=${target_id}`);
  });

  // キャンペーンのproduct_urlにリダイレクト
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("product_url")
    .eq("id", campaign_id)
    .single();

  const redirectUrl = (campaign?.product_url as string) || "https://spark-ai.jp";
  return NextResponse.redirect(redirectUrl, 302);
}
