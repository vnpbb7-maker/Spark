import { inngest } from "../client";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export const discoverTargets = inngest.createFunction(
  { id: "discover-targets" },
  { event: "campaign/discover" },
  async ({ event, step }: any) => {
    const campaignId = event.data.campaign_id as string;

    const supabase = createClient(cookies());

    // 1. Get campaign
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();

    if (!campaign) return { error: "Campaign not found" };

    // 2. Check daily limit
    const today = new Date().toISOString().split("T")[0];
    const { count } = await supabase
      .from("targets")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .gte("created_at", today);

    if (count && count >= campaign.daily_limit) {
      return { error: "Daily limit reached" };
    }

    return { success: true, campaignId };
  }
);
