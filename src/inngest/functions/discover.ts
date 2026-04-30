import { inngest } from "../client";

export const discoverTargets = inngest.createFunction(
  { id: "discover-targets" },
  { event: "campaign/discover" },
  async ({ event, step }: any) => {
    const campaignId = event.data.campaign_id as string;
    return { success: true, campaignId };
  }
);
