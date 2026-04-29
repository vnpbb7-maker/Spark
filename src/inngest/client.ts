import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "spark",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
