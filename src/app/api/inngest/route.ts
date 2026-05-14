import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  discoverTargets,
  generateComments,
  postComments,
  monitorReplies,
} from "@/inngest/functions/index";

export const maxDuration = 300; // Allow up to 5 minutes for Inngest step execution

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    discoverTargets,
    generateComments,
    postComments,
    monitorReplies,
  ],
});
