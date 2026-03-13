---
name: playwright-cli
description: >
  Use this skill whenever the user wants to automate a browser, scrape web content, take
  screenshots or PDFs of pages, fill out forms, click through UI flows, or run end-to-end
  tests — without using an MCP server. This skill drives Playwright directly from the
  bash_tool via Node.js scripts. Trigger whenever the user says things like "open this
  URL", "screenshot this page", "scrape this site", "automate this form", "test this UI",
  "extract data from", "click through", "check if this page works", or any task that
  requires real browser interaction. Prefer this skill over web_fetch when JavaScript
  rendering, authentication, interaction, or visual output is needed.
---

# Playwright CLI Skill

Drive a real Chromium browser from the bash_tool using Playwright (Node.js). No MCP server needed.

---

## 1. Environment Setup

Always run this check first. It's fast and idempotent.

```bash
# Check Node + npx availability
node --version && npx --version

# Check if playwright is available; install if not
if ! npx playwright --version 2>/dev/null; then
  echo "Installing Playwright..."
  npm install -D playwright 2>&1 | tail -5
  npx playwright install chromium 2>&1 | tail -10
fi
```

If `npm install` fails due to network restrictions, inform the user that Playwright must be pre-installed in their environment.

**Working directory:** Write scripts to `/tmp/pw-scripts/` and run from there. For E2E test specs, use the project's `tests/e2e/` directory structure.

---

## 2. Script Patterns

Write a Node.js script, save it, run it with `node`. Always use these boilerplate patterns:

### Boilerplate (all scripts)

```js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // --- your task here ---
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
```

### Screenshot

```js
await page.goto('https://example.com', { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/pw-scripts/screenshot.png', fullPage: true });
console.log('Screenshot saved.');
```

### PDF

```js
await page.goto('https://example.com', { waitUntil: 'networkidle' });
await page.pdf({ path: '/tmp/pw-scripts/output.pdf', format: 'A4' });
console.log('PDF saved.');
```

### Web Scraping

```js
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

// Wait for a key element if needed
await page.waitForSelector('.content', { timeout: 10000 });

const data = await page.evaluate(() => {
  // Run in browser context — return serialisable data
  return Array.from(document.querySelectorAll('h2')).map(el => el.textContent.trim());
});

console.log(JSON.stringify(data, null, 2));
```

### Form Fill & Click

```js
await page.goto('https://example.com/login');
await page.fill('#username', 'myuser');
await page.fill('#password', 'mypass');
await page.click('button[type="submit"]');
await page.waitForNavigation({ waitUntil: 'networkidle' });
console.log('Current URL:', page.url());
```

### UI Test (assertion-style)

```js
await page.goto('https://example.com');
const title = await page.title();
console.assert(title.includes('Example'), `Unexpected title: ${title}`);

const btn = await page.$('button.cta');
console.assert(btn !== null, 'CTA button not found');
console.log('PASS');
```

### E2E Test with Playwright Test Runner

For structured E2E tests, use the Playwright test runner:

```bash
# Run all E2E tests in a directory
cd tests/e2e/dashboard && npx playwright test --reporter=line

# Run a specific test file
npx playwright test workflow-graph-colors.spec.ts --reporter=line

# Run tests matching a pattern
npx playwright test -g "green nodes" --reporter=line

# Run with visible browser (debug)
npx playwright test --headed --reporter=line

# View test trace on failure
npx playwright show-trace test-results/*/trace.zip
```

---

## 3. Dashboard-Specific Patterns

For testing the System Health Dashboard (localhost:3032):

### Navigate to UKB Workflow Modal

```js
await page.goto('http://localhost:3032');
// Click the "UKB Workflows" card to open the modal
await page.click('text=UKB Workflows');
// Wait for graph nodes to render
await page.waitForSelector('[data-testid^="workflow-node-"]', { timeout: 15000 });
```

### Check Node Status (green/running/pending)

```js
const node = await page.locator('[data-testid="workflow-node-semantic_analysis"]');
const status = await node.getAttribute('data-status');
console.log(`semantic_analysis status: ${status}`);
// Expected: 'completed' (green), 'running' (blue), 'pending' (gray)
```

### Inject Workflow Progress (for testing)

```js
const fs = require('fs');
const progressPath = '/Users/Q284340/Agentic/coding/.data/workflow-progress.json';
fs.writeFileSync(progressPath, JSON.stringify({
  workflowId: 'wf_test',
  workflowName: 'wave-analysis',
  status: 'running',
  progress: {
    completedSteps: ['wave1'],
    currentWave: 2,
    totalWaves: 4,
    currentStepName: 'wave2_analyze',
    currentSubstepId: 'wave2_analyze',
    startTime: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
  },
  config: { singleStepMode: true, mockLLM: true },
  stepsDetail: [{ name: 'wave1', status: 'completed', duration: 120 }],
}, null, 2));
```

---

## 4. Workflow

1. **Understand the task** — URL, goal, any credentials or selectors needed.
2. **Setup** — Run the environment check (Section 1).
3. **Write script** — Save to `/tmp/pw-scripts/pw_task.js` using Write tool or heredoc.
4. **Run** — `node /tmp/pw-scripts/pw_task.js`
5. **Handle output** — If screenshots/PDFs produced, tell user the file path.
6. **Iterate** — If selectors fail, inspect the page HTML first:
   ```bash
   # Quick DOM dump for debugging
   node -e "
   const {chromium} = require('playwright');
   (async()=>{
     const b = await chromium.launch({headless:true});
     const p = await b.newPage();
     await p.goto('URL_HERE', {waitUntil:'domcontentloaded'});
     console.log(await p.content());
     await b.close();
   })();" 2>/dev/null | head -200
   ```

---

## 5. Tips & Gotchas

| Situation | Solution |
|---|---|
| Page content loads late (JS-rendered) | Use `waitUntil: 'networkidle'` or `page.waitForSelector()` |
| Need to extract structured data | Use `page.evaluate()` — runs in browser context |
| Need to capture network responses | Use `page.on('response', ...)` before `goto` |
| Anti-bot / CAPTCHA | Inform user — automation cannot reliably bypass these |
| Large pages for PDF | Add `printBackground: true` to pdf options |
| File downloads | Set `context = browser.newContext({ acceptDownloads: true })` |
| Auth via cookies/session | Use `context.addCookies([...])` before navigation |
| Screenshots of specific element | `const el = await page.$('.selector'); await el.screenshot({path: '...'})` |
| Dashboard not responding | Check `curl -s http://localhost:3032` first, rebuild if needed |

---

## 6. Output

- **Screenshots/PDFs:** Save to `/tmp/pw-scripts/` and tell user the path.
- **Scraped data:** Print to stdout (JSON preferred), then summarise key findings for the user.
- **Test results:** Print PASS/FAIL per assertion, summarise at end.
- **Errors:** Always include the URL, the failing selector or step, and the raw error message.
