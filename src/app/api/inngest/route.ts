import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { discoverTargets } from "@/inngest/functions/discover";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [discoverTargets],
});
