export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    priceId: null,
    campaigns: 1,
    daily_limit: 10,
    platforms: ["reddit", "yahoo_qa", "note"],
    auto_comment: false,
  },
  starter: {
    name: "Starter",
    price: 29,
    priceId: process.env.STRIPE_STARTER_PRICE_ID || null,
    campaigns: 5,
    daily_limit: 100,
    platforms: ["reddit", "yahoo_qa", "note", "instagram", "quora", "twitter"],
    auto_comment: false,
  },
  growth: {
    name: "Growth",
    price: 99,
    priceId: process.env.STRIPE_GROWTH_PRICE_ID || null,
    campaigns: -1, // unlimited
    daily_limit: 1000,
    platforms: [
      "twitter", "reddit", "linkedin", "tiktok", "instagram", "facebook",
      "youtube", "note", "zenn", "qiita", "hatena", "yahoo_qa", "web",
      "quora", "stackoverflow",
    ],
    auto_comment: true,
  },
  agency: {
    name: "Agency",
    price: 999,
    priceId: process.env.STRIPE_AGENCY_PRICE_ID || null,
    campaigns: -1, // unlimited
    daily_limit: -1, // unlimited
    platforms: [
      "twitter", "reddit", "linkedin", "tiktok", "instagram", "facebook",
      "youtube", "note", "zenn", "qiita", "hatena", "yahoo_qa", "web",
      "quora", "stackoverflow",
    ],
    auto_comment: true,
  },
} as const;

export type PlanKey = keyof typeof PLANS;
