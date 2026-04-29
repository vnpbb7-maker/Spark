import { getPage } from "../browser";
import { humanType, shortDelay, randomDelay } from "../human";

export async function postInstagramComment(
  postUrl: string,
  commentText: string,
  credentials: { username: string; password: string }
): Promise<boolean> {
  const page = await getPage();
  try {
    await page.goto("https://www.instagram.com/accounts/login/");
    await page.waitForLoadState("networkidle");
    await shortDelay();
    await humanType(page, 'input[name="username"]', credentials.username);
    await humanType(page, 'input[name="password"]', credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    await shortDelay();
    try { await page.click('button:has-text("後で")'); } catch { /* ignore */ }

    await randomDelay(3000, 8000);
    await page.goto(postUrl);
    await page.waitForLoadState("networkidle");
    await shortDelay();

    await page.click('textarea[placeholder="コメントを追加..."]');
    await humanType(page, 'textarea[placeholder="コメントを追加..."]', commentText);
    await shortDelay();
    await page.click('button:has-text("投稿する")');
    await page.waitForTimeout(3000);

    return true;
  } catch (error) {
    console.error("Instagram comment failed:", error);
    return false;
  } finally {
    await page.close();
  }
}
