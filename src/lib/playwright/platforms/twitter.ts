import { getPage } from "../browser";
import { humanType, shortDelay, randomDelay } from "../human";

export async function postTwitterReply(
  tweetUrl: string,
  replyText: string,
  credentials: { username: string; password: string }
): Promise<boolean> {
  const page = await getPage();
  try {
    await page.goto("https://twitter.com/login");
    await page.waitForLoadState("networkidle");
    await shortDelay();

    await humanType(page, 'input[autocomplete="username"]', credentials.username);
    await page.click('[data-testid="LoginForm_Login_Button"]');
    await shortDelay();
    await humanType(page, 'input[type="password"]', credentials.password);
    await page.click('[data-testid="LoginForm_Login_Button"]');
    await page.waitForNavigation();

    await randomDelay(3000, 8000);
    await page.goto(tweetUrl);
    await page.waitForLoadState("networkidle");

    await shortDelay();
    await page.click('[data-testid="reply"]');
    await shortDelay();
    await humanType(page, '[data-testid="tweetTextarea_0"]', replyText);

    await shortDelay();
    await page.click('[data-testid="tweetButton"]');
    await page.waitForTimeout(3000);

    return true;
  } catch (error) {
    console.error("Twitter reply failed:", error);
    return false;
  } finally {
    await page.close();
  }
}
