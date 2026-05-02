import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { PLANS, PlanKey } from "@/lib/stripe/client";

export async function POST(req: Request) {
  try {
    // 1. Check Stripe key
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("STRIPE_SECRET_KEY is not set");
      return NextResponse.json(
        { error: "決済システムの設定が完了していません。管理者にお問い合わせください。" },
        { status: 503 }
      );
    }

    // 2. Auth check
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    // 3. Parse request
    const { plan, successUrl, cancelUrl } = await req.json();
    const planKey = plan as PlanKey;
    const planConfig = PLANS[planKey];

    if (!planConfig) {
      return NextResponse.json(
        { error: `無効なプラン: ${plan}` },
        { status: 400 }
      );
    }

    if (!planConfig.priceId) {
      console.error(`Price ID not set for plan: ${plan}. Need STRIPE_${plan.toUpperCase()}_PRICE_ID`);
      return NextResponse.json(
        { error: `${planConfig.name}プランの料金設定が完了していません。管理者にお問い合わせください。` },
        { status: 503 }
      );
    }

    // 4. Init Stripe
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // 5. Get or create customer
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

    // 6. Create checkout session
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
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `チェックアウトの作成に失敗しました: ${message}` },
      { status: 500 }
    );
  }
}
