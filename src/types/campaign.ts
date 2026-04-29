export type Persona = {
  name: string;
  description: string;
  pain_points: string[];
  where_to_find: {
    twitter: string[];
    reddit: string[];
    linkedin: string[];
    tiktok: string[];
    instagram: string[];
    facebook: string[];
  };
  keywords: string[];
};

export type AnalysisResult = {
  core_value: string;
  problem_solved: string;
  personas: Persona[];
  recommended_platforms: string[];
  positioning: string;
};

export type CampaignSettings = {
  platforms: string[];
  daily_limit: number;
  tone: "casual" | "professional" | "empathetic";
  auto_mode: boolean;
};
