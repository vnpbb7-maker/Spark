import { inngest } from "../client";

export const postComments = inngest.createFunction(
  { id: "post-comments" },
  { event: "campaign/post" },
  async ({ event, step }: any) => {
    const campaignId = event.data.campaign_id as string;
    return { success: true, campaignId };
  }
);
