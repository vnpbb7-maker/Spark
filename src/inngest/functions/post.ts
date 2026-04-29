import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export const postComments = inngest.createFunction(
  { id: "post-comments", name: "Post Comments" },
  { event: "campaign/post" },
  async ({ event, step }) => {
    const campaignId = event.data.campaign_id as string;

    const campaign = await step.run("get-campaign", async () => {
      const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", campaignId).single();
      return data;
    });
    if (!campaign || campaign.status !== "running") return { message: "Not running" };

    // Check daily post limit
    const todayPosted = await step.run("check-limit", async () => {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabaseAdmin.from("comments").select("*", { count: "exact", head: true })
        .eq("campaign_id", campaignId).gte("posted_at", `${today}T00:00:00Z`);
      return count || 0;
    });

    if (todayPosted >= campaign.daily_limit) return { message: "Daily limit reached" };

    // Get approved but not posted comments
    const comments = await step.run("get-approved", async () => {
      const { data } = await supabaseAdmin.from("comments").select("*, targets(*)")
        .eq("campaign_id", campaignId).eq("approved", true).is("posted_at", null).limit(5);
      return data || [];
    });

    let posted = 0;
    for (const comment of comments) {
      await step.run(`post-${comment.id}`, async () => {
        // Random delay (30-90s between posts)
        const delay = Math.random() * 60000 + 30000;
        await new Promise((r) => setTimeout(r, delay));

        const target = comment.targets as Record<string, string>;
        const platform = comment.platform;
        const creds = await supabaseAdmin.from("platform_credentials").select("credentials")
          .eq("user_id", campaign.user_id).eq("platform", platform).single();

        if (!creds.data) { console.error(`No creds for ${platform}`); return; }

        // Import and call platform function dynamically
        try {
          let success = false;
          const credentials = creds.data.credentials as Record<string, string>;
          const content = comment.content as string;
          const postUrl = target.post_url;

          // Dynamic import for platform modules
          switch (platform) {
            case "reddit": {
              const { postRedditComment } = await import("@/lib/playwright/platforms/reddit");
              success = await postRedditComment(postUrl, content, { username: credentials.username, password: credentials.password });
              break;
            }
            case "twitter": {
              const { postTwitterReply } = await import("@/lib/playwright/platforms/twitter");
              success = await postTwitterReply(postUrl, content, { username: credentials.username, password: credentials.password });
              break;
            }
            case "linkedin": {
              const { postLinkedInComment } = await import("@/lib/playwright/platforms/linkedin");
              success = await postLinkedInComment(postUrl, content, { email: credentials.email, password: credentials.password });
              break;
            }
            case "tiktok": {
              const { postTikTokComment } = await import("@/lib/playwright/platforms/tiktok");
              success = await postTikTokComment(postUrl, content, { username: credentials.username, password: credentials.password });
              break;
            }
            case "instagram": {
              const { postInstagramComment } = await import("@/lib/playwright/platforms/instagram");
              success = await postInstagramComment(postUrl, content, { username: credentials.username, password: credentials.password });
              break;
            }
            case "facebook": {
              const { postFacebookComment } = await import("@/lib/playwright/platforms/facebook");
              success = await postFacebookComment(postUrl, content, { email: credentials.email, password: credentials.password });
              break;
            }
          }

          if (success) {
            await supabaseAdmin.from("comments").update({ posted_at: new Date().toISOString() }).eq("id", comment.id);
            await supabaseAdmin.from("targets").update({ status: "posted", contacted_at: new Date().toISOString() }).eq("id", target.id);
            posted++;
          }
        } catch (e) { console.error("Post error:", e); }
      });
    }

    return { posted };
  }
);
