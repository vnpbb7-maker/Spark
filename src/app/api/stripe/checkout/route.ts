import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { PLANS, PlanKey } from "@/lib/stripe/client";

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { plan, successUrl, cancelUrl } = await req.json();

    const planKey = plan as PlanKey;
    const planConfig = PLANS[planKey];

    if (!planConfig) {
      return NextResponse.json(
        { error: `Invalid plan: ${plan}` },
        { status: 400 }
      );
    }

    if (!planConfig.priceId) {
      return NextResponse.json(
        { error: `No price configured for plan: ${plan}. Set STRIPE_${plan.toUpperCase()}_PRICE_ID env var.` },
        { status: 400 }
      );
    }

    const stripe = getStripe();

    // Check if user already has a Stripe customer ID
    const { data: existingCustomer } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = existingCustomer?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      success_url:
        successUrl ||
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard?success=true`,
      cancel_url:
        cancelUrl || `${process.env.NEXT_PUBLIC_SITE_URL}/pricing`,
      metadata: {
        user_id: user.id,
        plan: planKey,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json(
      { error: "Checkout failed", details: String(error) },
      { status: 500 }
    );
  }
}
