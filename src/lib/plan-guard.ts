import { createClient } from "@supabase/supabase-js";
import { PLANS, PlanKey } from "@/lib/stripe/client";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getPlanForUser(userId: string) {
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan")
    .eq("user_id", userId)
    .eq("status", "active")
    .single();

  const planKey: PlanKey = (subscription?.plan as PlanKey) || "free";
  return PLANS[planKey] || PLANS.free;
}

export async function checkDailyLimit(campaignId: string, userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const plan = await getPlanForUser(userId);

  // Unlimited plan
  if (plan.daily_limit === -1) {
    return { allowed: true, remaining: -1 };
  }

  const today = new Date().toISOString().split("T")[0];
  const { count } = await supabase
    .from("targets")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .gte("created_at", today);

  const used = count || 0;
  const remaining = plan.daily_limit - used;

  return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
}
