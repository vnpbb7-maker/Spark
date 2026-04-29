import { Page } from "playwright";

/**
 * ランダム待機（デフォルト: 30〜90秒）
 */
export async function randomDelay(min = 30000, max = 90000) {
  const delay = Math.random() * (max - min) + min;
  await new Promise((r) => setTimeout(r, delay));
}

/**
 * 短いランダム待機（操作間・1〜3秒）
 */
export async function shortDelay() {
  const delay = Math.random() * 2000 + 1000;
  await new Promise((r) => setTimeout(r, delay));
}

/**
 * 人間っぽいタイピング（40〜120ms/文字）
 */
export async function humanType(page: Page, selector: string, text: string) {
  await page.click(selector);
  await shortDelay();
  for (const char of text) {
    await page.type(selector, char, {
      delay: Math.random() * 80 + 40,
    });
    // 稀にタイピングを一時停止（考えてる風）
    if (Math.random() < 0.05) {
      await new Promise((r) => setTimeout(r, Math.random() * 1500 + 500));
    }
  }
}

/**
 * ランダムなマウス移動
 */
export async function randomMouseMove(page: Page) {
  const x = Math.random() * 1200 + 100;
  const y = Math.random() * 600 + 100;
  await page.mouse.move(x, y, { steps: 10 });
}

/**
 * スクロール（人間っぽく）
 */
export async function humanScroll(page: Page) {
  await page.evaluate(() => {
    window.scrollBy({
      top: Math.random() * 300 + 100,
      behavior: "smooth",
    });
  });
}
