import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  await page.goto('http://localhost:5173');

  // Open settings
  await page.click('text="Connection"');

  // Select Local Server
  await page.selectOption('select', 'Local Server');

  // Clear and type URL
  await page.fill('input[placeholder="http://localhost:1234/v1"]', '');
  await page.type('input[placeholder="http://localhost:1234/v1"]', 'http://192.168.29.106:1234/v1');

  // Click Connect
  await page.click('button:has-text("Connect")');

  // Wait for result
  await page.waitForTimeout(2000);

  // Check connection status
  const badge = await page.locator('.badge').first().textContent();
  console.log('Connection Badge Text:', badge);

  await browser.close();
})();
