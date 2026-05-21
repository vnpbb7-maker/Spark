import { createClient } from "@supabase/supabase-js";

export type Plan = "unlimited" | "growth" | "starter" | "free";

export interface PlanLimits {
  maxTargetsPerCampaign: number;
  maxCampaigns: number;
  maxSentPerDay: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  unlimited: { maxTargetsPerCampaign: 999999, maxCampaigns: 999999, maxSentPerDay: 999999 },
  growth:    { maxTargetsPerCampaign: 1000,   maxCampaigns: 999999, maxSentPerDay: 1000 },
  starter:   { maxTargetsPerCampaign: 100,    maxCampaigns: 20,     maxSentPerDay: 100 },
  free:      { maxTargetsPerCampaign: 10,     maxCampaigns: 3,      maxSentPerDay: 10 },
};

const ADMIN_EMAILS = ["skillive.info@gmail.com", "vnpbb7@gmail.com"];

export async function getUserPlan(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string
): Promise<{ plan: Plan; isAdmin: boolean; limits: PlanLimits }> {
  // Check profiles table first
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("plan, is_admin")
    .eq("id", userId)
    .maybeSingle();

  // Check auth.users email as fallback (admin email hardcoded for safety)
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email || "";
  const isAdminByEmail = ADMIN_EMAILS.includes(email);

  const isAdmin = isAdminByEmail || profile?.is_admin === true;
  const plan: Plan = isAdmin ? "unlimited" : ((profile?.plan as Plan) || "free");
  const limits = PLAN_LIMITS[plan];

  return { plan, isAdmin, limits };
}
