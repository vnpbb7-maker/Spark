import { getPage } from "../browser";
import { humanType, shortDelay, randomDelay } from "../human";

export async function postTikTokComment(
  videoUrl: string,
  commentText: string,
  credentials: { username: string; password: string }
): Promise<boolean> {
  const page = await getPage();
  try {
    await page.goto("https://www.tiktok.com/login");
    await shortDelay();
    await page.click('[data-e2e="channel-item"]');
    await shortDelay();
    await humanType(page, 'input[name="username"]', credentials.username);
    await humanType(page, 'input[type="password"]', credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForNavigation();

    await randomDelay(3000, 8000);
    await page.goto(videoUrl);
    await page.waitForLoadState("networkidle");

    await shortDelay();
    await page.click('[data-e2e="comment-input"]');
    await humanType(page, '[data-e2e="comment-input"]', commentText);
    await shortDelay();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);

    return true;
  } catch (error) {
    console.error("TikTok comment failed:", error);
    return false;
  } finally {
    await page.close();
  }
}
