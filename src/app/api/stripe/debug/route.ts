import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PLANS } from "@/lib/stripe/client";

export async function GET() {
  const checks: Record<string, unknown> = {};

  // 1. Env vars
  checks.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ? `set (${process.env.STRIPE_SECRET_KEY.slice(0, 7)}...)` : "NOT SET";
  checks.STRIPE_STARTER_PRICE_ID = process.env.STRIPE_STARTER_PRICE_ID || "NOT SET";
  checks.STRIPE_GROWTH_PRICE_ID = process.env.STRIPE_GROWTH_PRICE_ID || "NOT SET";
  checks.STRIPE_AGENCY_PRICE_ID = process.env.STRIPE_AGENCY_PRICE_ID || "NOT SET";
  checks.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "NOT SET";

  // 2. Plans config
  checks.plans = {
    starter_priceId: PLANS.starter.priceId || "null",
    growth_priceId: PLANS.growth.priceId || "null",
    agency_priceId: PLANS.agency.priceId || "null",
  };

  // 3. Auth
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    checks.auth = user ? `OK (${user.email})` : `no user: ${authError?.message || "not logged in"}`;

    if (user) {
      // 4. Subscriptions table
      const { data, error: subError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      checks.subscription = subError ? `ERROR: ${subError.message}` : data || "no record";
    }
  } catch (e) {
    checks.auth = `EXCEPTION: ${String(e)}`;
  }

  // 5. Stripe import
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const balance = await stripe.balance.retrieve();
    checks.stripe = `OK (${balance.available?.[0]?.currency || "connected"})`;
  } catch (e) {
    checks.stripe = `ERROR: ${String(e)}`;
  }

  return NextResponse.json(checks, { status: 200 });
}
