import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  discoverTargets,
  generateComments,
  postComments,
  monitorReplies,
} from "@/inngest/functions/index";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    discoverTargets,
    generateComments,
    postComments,
    monitorReplies,
  ],
});
