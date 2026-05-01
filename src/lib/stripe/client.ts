export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    priceId: null,
    campaigns: 1,
    daily_limit: 10,
    platforms: ["twitter", "reddit"],
    auto_comment: false,
  },
  starter: {
    name: "Starter",
    price: 99,
    priceId: process.env.STRIPE_STARTER_PRICE_ID || null,
    campaigns: 3,
    daily_limit: 50,
    platforms: ["twitter", "reddit"],
    auto_comment: false,
  },
  growth: {
    name: "Growth",
    price: 299,
    priceId: process.env.STRIPE_GROWTH_PRICE_ID || null,
    campaigns: 10,
    daily_limit: 200,
    platforms: ["twitter", "reddit", "linkedin", "tiktok", "instagram", "facebook"],
    auto_comment: true,
  },
  agency: {
    name: "Agency",
    price: 999,
    priceId: process.env.STRIPE_AGENCY_PRICE_ID || null,
    campaigns: -1, // unlimited
    daily_limit: -1, // unlimited
    platforms: ["twitter", "reddit", "linkedin", "tiktok", "instagram", "facebook"],
    auto_comment: true,
  },
} as const;

export type PlanKey = keyof typeof PLANS;
