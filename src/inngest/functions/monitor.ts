import { inngest } from "../client";

export const monitorReplies = inngest.createFunction(
  { id: "monitor-replies" },
  { event: "campaign/monitor" },
  async ({ event, step }: any) => {
    return { success: true };
  }
);
