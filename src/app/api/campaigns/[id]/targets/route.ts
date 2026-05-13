import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params;

    // Auth check
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getAdminSupabase();

    // Fetch campaign (verify ownership)
    const { data: campaign, error: campErr } = await admin
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("user_id", user.id)
      .single();

    if (campErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Fetch targets with service role (bypasses RLS)
    const { data: targets, error: tgtErr } = await admin
      .from("targets")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("match_score", { ascending: false })
      .limit(100);

    if (tgtErr) {
      console.error("[campaign API] targets error:", tgtErr.message);
    }

    console.log(`[campaign API] campaign=${campaignId.slice(0, 8)} targets=${targets?.length || 0}`);

    return NextResponse.json({
      campaign,
      targets: targets || [],
    });
  } catch (err) {
    console.error("[campaign API] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
