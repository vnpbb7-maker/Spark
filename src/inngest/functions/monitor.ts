import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { getPage } from "@/lib/playwright/browser";

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const monitorResponses = inngest.createFunction(
  { id: "monitor-responses", name: "Monitor Responses" },
  { cron: "*/15 * * * *" }, // Every 15 minutes
  async ({ step }) => {
    // Get posted comments without responses
    const comments = await step.run("get-unresponded", async () => {
      const { data } = await supabaseAdmin.from("comments").select("*, targets(*)")
        .not("posted_at", "is", null).is("responded_at", null).limit(20);
      return data || [];
    });

    let responded = 0;
    let converted = 0;

    for (const comment of comments) {
      await step.run(`check-${comment.id}`, async () => {
        const target = comment.targets as Record<string, string>;
        if (!target.post_url) return;

        try {
          const page = await getPage();
          await page.goto(target.post_url);
          await page.waitForLoadState("networkidle");

          // Try to find new replies (platform-specific selectors)
          const pageContent = await page.textContent("body");
          await page.close();

          if (!pageContent) return;

          // Use Claude to check if there's a new response
          const msg = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514", max_tokens: 300,
            system: `ページ内容から以下を判定しJSONのみ返してください：
1. 我々のコメント「${comment.content}」に対する返信があるか
2. 返信内容
3. βユーザー化の意向があるか

{"has_response":true/false,"response_text":"返信内容","has_conversion_intent":true/false}`,
            messages: [{ role: "user", content: pageContent.slice(0, 3000) }],
          });

          const tb = msg.content.find((b) => b.type === "text");
          if (!tb || tb.type !== "text") return;
          let js = tb.text.trim();
          const m = js.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (m) js = m[1].trim();
          const parsed = JSON.parse(js);

          if (parsed.has_response) {
            await supabaseAdmin.from("comments").update({
              response_text: parsed.response_text,
              responded_at: new Date().toISOString(),
            }).eq("id", comment.id);

            const newStatus = parsed.has_conversion_intent ? "converted" : "responded";
            await supabaseAdmin.from("targets").update({ status: newStatus }).eq("id", target.id);

            responded++;
            if (parsed.has_conversion_intent) converted++;
          }
        } catch (e) {
          console.error("Monitor error:", e);
        }
      });
    }

    return { checked: comments.length, responded, converted };
  }
);
