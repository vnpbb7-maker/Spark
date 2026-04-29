import { getPage } from "../browser";
import { humanType, shortDelay, randomDelay, humanScroll } from "../human";

export async function postFacebookComment(
  postUrl: string,
  commentText: string,
  credentials: { email: string; password: string }
): Promise<boolean> {
  const page = await getPage();
  try {
    await page.goto("https://www.facebook.com/login");
    await humanType(page, "#email", credentials.email);
    await humanType(page, "#pass", credentials.password);
    await page.click('[name="login"]');
    await page.waitForNavigation();

    await randomDelay(3000, 8000);
    await page.goto(postUrl);
    await page.waitForLoadState("networkidle");
    await humanScroll(page);

    await shortDelay();
    await page.click('[data-testid="UFI2CommentBox/root"]');
    await humanType(page, '[data-testid="UFI2CommentBox/root"]', commentText);
    await shortDelay();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);

    return true;
  } catch (error) {
    console.error("Facebook comment failed:", error);
    return false;
  } finally {
    await page.close();
  }
}
