import { getPage } from "../browser";
import { humanType, shortDelay, randomDelay, humanScroll } from "../human";

export async function postLinkedInComment(
  postUrl: string,
  commentText: string,
  credentials: { email: string; password: string }
): Promise<boolean> {
  const page = await getPage();
  try {
    await page.goto("https://www.linkedin.com/login");
    await humanType(page, "#username", credentials.email);
    await humanType(page, "#password", credentials.password);
    await page.click('[type="submit"]');
    await page.waitForNavigation();

    await randomDelay(3000, 8000);
    await page.goto(postUrl);
    await page.waitForLoadState("networkidle");
    await humanScroll(page);

    await shortDelay();
    await page.click(".comment-button");
    await shortDelay();
    await humanType(page, ".ql-editor", commentText);

    await shortDelay();
    await page.click(".comments-comment-box__submit-button");
    await page.waitForTimeout(3000);

    return true;
  } catch (error) {
    console.error("LinkedIn comment failed:", error);
    return false;
  } finally {
    await page.close();
  }
}
