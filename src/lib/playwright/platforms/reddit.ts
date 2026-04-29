import { getPage } from "../browser";
import { humanType, shortDelay, randomDelay, humanScroll, randomMouseMove } from "../human";

export async function postRedditComment(
  postUrl: string,
  commentText: string,
  credentials: { username: string; password: string }
): Promise<boolean> {
  const page = await getPage();
  try {
    await page.goto("https://www.reddit.com/login");
    await shortDelay();
    await humanType(page, "#loginUsername", credentials.username);
    await humanType(page, "#loginPassword", credentials.password);
    await shortDelay();
    await page.click('button[type="submit"]');
    await page.waitForNavigation();

    await randomDelay(3000, 8000);
    await page.goto(postUrl);
    await page.waitForLoadState("networkidle");
    await humanScroll(page);

    await shortDelay();
    const editor = await page.waitForSelector(".public-DraftEditor-content", { timeout: 10000 });
    if (editor) {
      await humanType(page, ".public-DraftEditor-content", commentText);
    }

    await shortDelay();
    await randomMouseMove(page);
    await page.click('[data-testid="comment-submit-button"]');
    await page.waitForTimeout(3000);

    return true;
  } catch (error) {
    console.error("Reddit comment failed:", error);
    return false;
  } finally {
    await page.close();
  }
}
