/* eslint-disable @typescript-eslint/no-explicit-any */
import { inngest } from "../client";

// @ts-ignore
export const discoverTargets = inngest.createFunction(
  { id: "discover-targets" },
  { event: "campaign/discover" },
  async ({ event }: any) => {
    return { success: true };
  }
);

// @ts-ignore
export const generateComments = inngest.createFunction(
  { id: "generate-comments" },
  { event: "campaign/generate" },
  async ({ event }: any) => {
    return { success: true };
  }
);

// @ts-ignore
export const postComments = inngest.createFunction(
  { id: "post-comments" },
  { event: "campaign/post" },
  async ({ event }: any) => {
    return { success: true };
  }
);

// @ts-ignore
export const monitorReplies = inngest.createFunction(
  { id: "monitor-replies" },
  { event: "campaign/monitor" },
  async ({ event }: any) => {
    return { success: true };
  }
);
