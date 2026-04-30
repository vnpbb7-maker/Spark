import { inngest } from "../client";

export const generateComments = inngest.createFunction(
  { id: "generate-comments" },
  { event: "campaign/generate" },
  async ({ event, step }: any) => {
    const campaignId = event.data.campaign_id as string;
    return { success: true, campaignId };
  }
);
