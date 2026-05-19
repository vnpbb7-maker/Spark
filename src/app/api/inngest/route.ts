import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  discoverTargets,
  generateComments,
  postComments,
  monitorReplies,
  bulkSendOutreach,
} from "@/inngest/functions/index";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    discoverTargets,
    generateComments,
    postComments,
    monitorReplies,
    bulkSendOutreach,
  ],
});
