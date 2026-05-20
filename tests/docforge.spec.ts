import { test, expect, type Page, type Route } from '@playwright/test';

/* ============================================================
 * Shared selectors (kept in one place to keep tests readable
 * and to make UI refactors easy to absorb).
 * ============================================================ */
const SEL = {
  title:            (p: Page) => p.locator('.logo-text'),
  footer:           (p: Page) => p.locator('.app-footer'),
  headerBadge:      (p: Page) => p.locator('.app-header .badge'),
  toast:            (p: Page) => p.locator('.toast-notification'),
  connectionToggle: (p: Page) => p.getByRole('button', { name: 'Connection' }),
  providerSelect:   (p: Page) => p.locator('.connection-panel select').first(),
  baseUrlInput:     (p: Page) => p.locator('.connection-panel input[type="text"]').first(),
  apiKeyInput:      (p: Page) => p.locator('.connection-panel input[type="password"]'),
  fallbackUrlInput: (p: Page) => p.locator('.connection-panel input[placeholder="http://localhost:1234/v1"]'),
  connectBtn:       (p: Page) => p.locator('.connection-panel button').filter({ hasText: /^(Connect|Connected)$/ }),
  projectName:      (p: Page) => p.locator('input[placeholder="e.g. Payment Gateway"]'),
  creatorName:      (p: Page) => p.locator('input[placeholder="e.g. John Doe"]'),
  fileInput:        (p: Page) => p.locator('input[type="file"][multiple]'),
  fileItems:        (p: Page) => p.locator('.file-item'),
  modeBulk:         (p: Page) => p.locator('input[name="processingMode"][value="bulk"]'),
  modeSemantic:     (p: Page) => p.locator('input[name="processingMode"][value="semantic"]'),
  autoApprove:      (p: Page) => p.locator('label', { hasText: /Auto-Approve Pre-Processed Context/ }).locator('input[type="checkbox"]'),
  processBtn:       (p: Page) => p.getByRole('button', { name: /Analyse & Process/i }),
  stopBtn:          (p: Page) => p.getByRole('button', { name: /Stop Processing/i }),
  progressBar:      (p: Page) => p.locator('.progress-container'),
  progressText:     (p: Page) => p.locator('.progress-text'),
  downloadDocx:     (p: Page) => p.getByRole('button', { name: /Download DOCX/i }),
  downloadPdf:      (p: Page) => p.getByRole('button', { name: /Download PDF/i }),
  continueBtn:      (p: Page) => p.getByRole('button', { name: /Continue to Final Generation/i }),
  downloadCtxBtn:   (p: Page) => p.getByRole('button', { name: /Download Pre-Processed Context/i }),
  uploadCtxBtn:     (p: Page) => p.getByRole('button', { name: /Upload Modified Context/i }),
};

/* ============================================================
 * Mock helpers — every test that exercises the pipeline routes
 * LLM traffic through these so no real model is ever invoked.
 * ============================================================ */

/** Build an OpenAI-compatible chat completion JSON body. */
const chatCompletionBody = (content: string) =>
  JSON.stringify({
    id: 'mock-cmpl',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });

/** Fulfill /v1/models (used by the connection check). */
const fulfillModels = (route: Route, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: status === 200
      ? JSON.stringify({ data: [{ id: 'mock-model' }] })
      : JSON.stringify({ error: 'mock failure' }),
  });

/**
 * Install a default LLM mock that returns `content` for every
 * /chat/completions call. Optionally delay each response (used by
 * the Abort test to keep the call in-flight while we click Stop).
 */
async function mockLlmCompletions(
  page: Page,
  content: string,
  opts: { delayMs?: number } = {},
) {
  await page.route('**/chat/completions*', async (route) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: chatCompletionBody(content),
    });
  });
}

/** Upload an in-memory text file (no disk fixture required). */
async function uploadInMemoryFile(page: Page, name: string, body: string) {
  await SEL.fileInput(page).setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(body, 'utf-8'),
  });
}

/* ============================================================
 * Global hook — every test starts on a clean home page.
 * ============================================================ */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/* ============================================================
 * Suite 1 — Base UI & Form Validation
 * ============================================================ */
test.describe('Suite 1: Base UI & Form Validation', () => {

  test('renders title, footer disclaimer and disabled process button on load', async ({ page }) => {
    // Title + footer
    await expect(page).toHaveTitle(/DocForge/i);
    await expect(SEL.title(page)).toHaveText(/DocForge/);
    await expect(SEL.footer(page)).toBeVisible();
    await expect(SEL.footer(page)).toContainText(/Designed & Built by Shanky Robot/i);
    // Disclaimer copy that warns users to review [CLARIFICATION NEEDED] tags
    await expect(SEL.footer(page)).toContainText(/CLARIFICATION NEEDED/i);

    // Process button must be disabled until at least one file is uploaded
    await expect(SEL.processBtn(page)).toBeDisabled();
  });

  test('enables process button after filling form and uploading a file', async ({ page }) => {
    await SEL.projectName(page).fill('Payment Gateway');
    await SEL.creatorName(page).fill('Jane Analyst');

    // Upload a tiny in-memory .txt fixture
    await uploadInMemoryFile(page, 'requirements.txt', 'hello world');

    // The file chip shows up
    await expect(SEL.fileItems(page).first()).toContainText('requirements.txt');

    // And the process button is now enabled
    await expect(SEL.processBtn(page)).toBeEnabled();
  });
});

/* ============================================================
 * Suite 2 — Connection Logic & Fallback Mocking
 * ============================================================ */
test.describe('Suite 2: Connection Logic & Fallback Mocking', () => {

  test('A: Local Server connects and badge shows "Connected to Local Server"', async ({ page }) => {
    await page.route('**/v1/models', (route) => fulfillModels(route, 200));

    await SEL.connectionToggle(page).click();
    await SEL.providerSelect(page).selectOption('Local Server');
    await SEL.baseUrlInput(page).fill('http://localhost:1234/v1');
    await SEL.connectBtn(page).click();

    await expect(SEL.headerBadge(page)).toHaveClass(/badge-success/);
    await expect(SEL.headerBadge(page)).toContainText(/Connected/i);
  });

  test('B: External fails with 500, Local fallback succeeds → "Connected (Local Only)"', async ({ page }) => {
    await page.route('**://api.openai.com/**/models', (route) => fulfillModels(route, 500));
    await page.route('**://localhost:1234/**/models', (route) => fulfillModels(route, 200));

    await SEL.connectionToggle(page).click();
    await SEL.providerSelect(page).selectOption('OpenAI');

    await expect(SEL.baseUrlInput(page)).toHaveValue(/openai\.com/);

    await SEL.apiKeyInput(page).fill('sk-mock-key');
    await SEL.fallbackUrlInput(page).fill('http://localhost:1234/v1');

    await SEL.connectBtn(page).click();

    await expect(SEL.headerBadge(page)).toHaveClass(/badge-success/);
    await expect(SEL.headerBadge(page)).toContainText(/Local Only/i);
  });
});

/* ============================================================
 * Suite 3 — Hardware Guardrail (OOM Prevention, Bulk Mode)
 * ============================================================ */
test.describe('Suite 3: Hardware Guardrail (OOM Prevention)', () => {

  test('blocks comprehensive mode when compiled context + template exceed 28,000 characters', async ({ page }) => {
    // Strategy: mock the LLM to return a 30,000-char string for Stage 1
    // (pre-processing). This makes compiledMarkdown alone exceed the
    // compiledMarkdown.length + parsedTemplate.length > 28,000 guard in
    // processor.ts without needing a large source file, so Stage 1 finishes
    // instantly (single chunk) and the guardrail fires in Stage 3 immediately.
    const overLimitResponse = 'X'.repeat(30_000);
    await mockLlmCompletions(page, overLimitResponse);

    await SEL.projectName(page).fill('OOM Test');
    await SEL.creatorName(page).fill('Guardrail Bot');

    // Tiny source file → single pre-processing chunk, no timeout risk.
    await uploadInMemoryFile(page, 'tiny.txt', 'small content');

    await SEL.modeBulk(page).check();
    await SEL.processBtn(page).click();

    // Assert against body to avoid races with conditionally-mounted elements.
    await expect(page.locator('body')).toContainText(
      /Source data is too large for Comprehensive Mode/i,
      { timeout: 15_000 },
    );

    // Download buttons must never appear — the guardrail aborted generation.
    await expect(SEL.downloadDocx(page)).toHaveCount(0);
    await expect(SEL.downloadPdf(page)).toHaveCount(0);
  });
});


/* ============================================================
 * Suite 4 — Happy-Path Semantic Pipeline (fully mocked)
 * ============================================================ */
test.describe('Suite 4: Happy Path — Semantic Pipeline', () => {

  test('runs end-to-end with mocked LLM, locks Auto-Approve, shows progress + downloads', async ({ page }) => {
    const mockSection = '## Mock Section\n\nThis is mocked content. [CLARIFICATION NEEDED: Testing]';
    await mockLlmCompletions(page, mockSection);

    await SEL.projectName(page).fill('Happy Path');
    await SEL.creatorName(page).fill('QA Bot');
    await uploadInMemoryFile(page, 'source.txt', 'A short business requirement.');

    await SEL.modeSemantic(page).check();
    const autoApprove = SEL.autoApprove(page);
    await autoApprove.check();
    await expect(autoApprove).toBeChecked();

    await SEL.processBtn(page).click();
    await expect(autoApprove).toBeDisabled();

    await expect(SEL.progressBar(page)).toBeVisible();
    await expect(SEL.progressText(page)).toContainText(/⏱️/);

    await expect(SEL.downloadDocx(page)).toBeVisible({ timeout: 30_000 });
    await expect(SEL.downloadPdf(page)).toBeVisible();
  });
});

/* ============================================================
 * Suite 5 — Human-In-The-Loop (HITL) Pause State
 * ============================================================ */
test.describe('Suite 5: Human-In-The-Loop Pause State', () => {

  test('pauses after pre-processing when Auto-Approve is OFF', async ({ page }) => {
    await mockLlmCompletions(page, '## Pre-Processing notes\n\nMocked deep analysis.');

    await SEL.projectName(page).fill('HITL Project');
    await SEL.creatorName(page).fill('Reviewer');
    await uploadInMemoryFile(page, 'hitl.txt', 'Some source data.');

    await SEL.modeSemantic(page).check();

    const autoApprove = SEL.autoApprove(page);
    await autoApprove.uncheck();
    await expect(autoApprove).not.toBeChecked();

    await SEL.processBtn(page).click();

    await expect(SEL.downloadCtxBtn(page)).toBeVisible({ timeout: 30_000 });
    await expect(SEL.uploadCtxBtn(page)).toBeVisible();
    await expect(SEL.continueBtn(page)).toBeVisible();

    await expect(SEL.continueBtn(page)).toContainText(/Continue to Final Generation/i);

    await expect(SEL.progressBar(page)).toHaveCount(0);
    await expect(autoApprove).toBeEnabled();
  });
});

/* ============================================================
 * Suite 6 — Abort Controller (Stop Button)
 * ============================================================ */
test.describe('Suite 6: Abort Controller', () => {

  test('stops in-flight generation, hides Stop, and shows halted toast', async ({ page }) => {
    await mockLlmCompletions(page, 'mock', { delayMs: 5_000 });

    await SEL.projectName(page).fill('Abort Project');
    await SEL.creatorName(page).fill('Stopper');
    await uploadInMemoryFile(page, 'abort.txt', 'Some content to process.');

    await SEL.modeSemantic(page).check();
    await SEL.autoApprove(page).check();

    await SEL.processBtn(page).click();

    const stop = SEL.stopBtn(page);
    await expect(stop).toBeVisible();
    await expect(SEL.progressBar(page)).toBeVisible();

    await stop.click();

    await expect(SEL.toast(page)).toContainText(/Processing Halted/i);

    await expect(stop).toHaveCount(0);
    await expect(SEL.progressBar(page)).toHaveCount(0);
    await expect(SEL.processBtn(page)).toBeEnabled();

    await expect(SEL.downloadDocx(page)).toHaveCount(0);
    await expect(SEL.downloadPdf(page)).toHaveCount(0);
  });
});

/* ============================================================
 * Suite 7 — Advanced Edge Cases & Error Handling
 * ============================================================ */
test.describe('Suite 7: Advanced Edge Cases', () => {

  test('auto-aborts if user alters text inputs during active generation', async ({ page }) => {
    // 5-second delay to give us time to tamper with the inputs
    await mockLlmCompletions(page, 'mock', { delayMs: 5_000 });

    await SEL.projectName(page).fill('Initial Project');
    await SEL.creatorName(page).fill('Analyst');
    await uploadInMemoryFile(page, 'tamper.txt', 'Source text.');
    await SEL.modeSemantic(page).check();
    await SEL.autoApprove(page).check();

    // Start processing
    await SEL.processBtn(page).click();
    await expect(SEL.progressBar(page)).toBeVisible();

    // TAMPER: Change the project name while it is running
    await SEL.projectName(page).fill('Changed Project Name');

    // Assertion: The useEffect should catch the dependency change and auto-abort
    await expect(SEL.toast(page)).toContainText(/Inputs modified during generation/i);
    
    // UI resets
    await expect(SEL.progressBar(page)).toHaveCount(0);
    await expect(SEL.processBtn(page)).toBeEnabled();
  });

  test('surfaces an error text if LLM network crashes mid-generation', async ({ page }) => {
    // Force the LLM to return a 500 Internal Server Error
    await page.route('**/chat/completions*', (route) => 
      route.fulfill({ status: 500, body: 'Internal Server Error' })
    );

    await SEL.projectName(page).fill('Crash Test');
    await SEL.creatorName(page).fill('Analyst');
    await uploadInMemoryFile(page, 'crash.txt', 'Source text.');
    
    await SEL.processBtn(page).click();

    // FIX: Assert the user-visible error text appears instead of a strict CSS toast class
    await expect(page.getByText(/Processing Failed/i)).toBeVisible();
    await expect(SEL.progressBar(page)).toHaveCount(0);
  });
});