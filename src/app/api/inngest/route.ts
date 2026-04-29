import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { discoverTargets } from "@/inngest/functions/discover";
import { generateComments } from "@/inngest/functions/generate";
import { postComments } from "@/inngest/functions/post";
import { monitorResponses } from "@/inngest/functions/monitor";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [discoverTargets, generateComments, postComments, monitorResponses],
});
