export type Persona = {
  // New behavioral-based fields
  label: string;
  pain_scene: string;
  current_workaround: string;
  reddit_communities: string[];
  twitter_keywords: string[];
  real_tweet_example: string;
  message_angle: string;
  avoid_phrases: string[];
  discovery_signals: string[];
  // Legacy compat (optional, for old cached data)
  name?: string;
  description?: string;
  pain_points?: string[];
  where_to_find?: Record<string, string[]>;
  keywords?: string[];
};

export type AnalysisResult = {
  core_value?: string;
  problem_solved?: string;
  personas: Persona[];
  recommended_platforms: string[];
  positioning?: string;
};

export type CampaignSettings = {
  platforms: string[];
  daily_limit: number;
  tone: "casual" | "professional" | "empathetic";
  auto_mode: boolean;
  target_language?: string;
  required_keywords?: string;
  min_match_score?: number;
};
