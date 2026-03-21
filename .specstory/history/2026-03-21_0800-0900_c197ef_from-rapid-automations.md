# WORK SESSION (0800-0900) - From rapid-automations

**Generated:** 2026-03-21T07:44:59.911Z
**Work Period:** 0800-0900
**Focus:** Coding activities from rapid-automations
**Duration:** ~60 minutes
**Source Project:** /Users/Q284340/Agentic/_work/rapid-automations

---

## Session Overview

This session captures coding-related activities redirected from rapid-automations.

---

## Key Activities

<a name="ps_1774079099911"></a>
## Prompt Set (ps_1774079099911)

**Time:** 2026-03-21T07:44:59.911Z
**Duration:** 0ms
**Tool Calls:** 49

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "node --version && npx playwright --version 2>/dev/null",
  "description": "Check Playwright availability"
}
```

**Result:** ✅ Success
**Output:** ```
Command running in background with ID: b54moy4kl. Output is being written to: /private/tmp/claude-502/-Users-<USER_ID_REDACTED>-Agentic--work-rapid-automations/3933ae54-2afa-451a-a4fe-9f448a0908aa/tasks/b54moy4kl.output
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "node --version && npx playwright --version 2>/dev/null && echo \"ready\"",
  "description": "Check Playwright"
}
```

**Result:** ✅ Success
**Output:** ```
Command running in background with ID: b059nugqw. Output is being written to: /private/tmp/claude-502/-Users-<USER_ID_REDACTED>-Agentic--work-rapid-automations/3933ae54-2afa-451a-a4fe-9f448a0908aa/tasks/b059nugqw.output
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "which node && node --version",
  "description": "Check node"
}
```

**Result:** ✅ Success
**Output:** ```
/opt/homebrew/bin/node
v25.8.1
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "npx playwright --version 2>&1",
  "description": "Check playwright version",
  "timeout": 30000
}
```

**Result:** ✅ Success
**Output:** ```
Command running in background with ID: bo7nvjj8i. Output is being written to: /private/tmp/claude-502/-Users-<USER_ID_REDACTED>-Agentic--work-rapid-automations/3933ae54-2afa-451a-a4fe-9f448a0908aa/tasks/bo7nvjj8i.output
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "ls /tmp/pw-scripts/ 2>/dev/null; mkdir -p /tmp/pw-scripts",
  "description": "Ensure pw-scripts dir exists"
}
```

**Result:** ✅ Success
**Output:** ```
(Bash completed with no output)
```


---

### Write - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Write
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/test-tabbed-toc.js",
  "content": "const { chromium } = require('playwright');\n\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });\n  const page = await context.newPage();\n\n  try {\n    await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'networkidle' });\n\n    // Helper to get visible TOC entries\n    async function getVisibleTocEntries() {\n      return page.evaluate(() => {\n        const sidebar = document.querySelector('.md-sidebar--secondary');\n        if (!sidebar) return { error: 'no sidebar' };\n        const links = sidebar.querySelectorAll('a.md-nav__link');\n        const visible = [];\n        const hidden = [];\n        links.forEach(link => {\n          const li = link.closest('li');\n          const href = link.getAttribute('href');\n          const text = link.textContent.trim();\n          if (!href || !href.startsWith('#')) return;\n          const id = href.slice(1);\n          if (li && li.style.display === 'none') {\n            hidden.push(id);\n          } else {\n            visible.push(id);\n          }\n        });\n        return { visible, hidden };\n      });\n    }\n\n    // Helper to get active tab label\n    async function getActiveTab() {\n      return page.evaluate(() => {\n        const set = document.querySelector('.tabbed-set');\n        if (!set) return 'no tabbed-set';\n        const inputs = set.querySelectorAll(':scope > input[type=\"radio\"]');\n        const labels = set.querySelectorAll('.tabbed-labels label');\n        for (let i = 0; i < inputs.length; i++) {\n          if (inputs[i].checked) return labels[i]?.textContent?.trim() || `tab ${i}`;\n        }\n        return 'none checked';\n      });\n    }\n\n    // Test 1: Initial state (Fast Path tab should be active)\n    console.log('=== TEST 1: Initial page load (Fast Path active) ===');\n    const tab1 = await getActiveTab();\n    console.log('Active tab:', tab1);\n    const toc1 = await getVisibleTocEntries();\n    console.log('Visible TOC:', JSON.stringify(toc1.visible));\n    console.log('Hidden TOC:', JSON.stringify(toc1.hidden));\n\n    // Fast Path headings: how-it-works, key-modules, data-directory\n    // Full Details headings: system-topology, llm-provider-stack, overview, module-structure,\n    //   triple-sync-persistence, startup-hydration, shutdown, api-server, graphstore, data-directory-layout\n    const fastPathIds = ['how-it-works', 'key-modules', 'data-directory'];\n    const fullDetailsIds = ['system-topology', 'llm-provider-stack', 'overview', 'module-structure',\n      'triple-sync-persistence', 'startup-hydration', 'shutdown', 'api-server', 'graphstore', 'data-directory-layout'];\n\n    const test1Pass = fastPathIds.every(id => toc1.visible.includes(id))\n      && fullDetailsIds.every(id => toc1.hidden.includes(id));\n    console.log('Test 1:', test1Pass ? 'PASS' : 'FAIL');\n\n    // Screenshot tab 1\n    await page.screenshot({ path: '/tmp/pw-scripts/toc-fast-path.png', fullPage: false });\n\n    // Test 2: Switch to Full Details tab\n    console.log('\\n=== TEST 2: Switch to Full Details tab ===');\n    await page.click('label:has-text(\"Full Details\")');\n    await page.waitForTimeout(500); // wait for JS to update TOC\n\n    const tab2 = await getActiveTab();\n    console.log('Active tab:', tab2);\n    const toc2 = await getVisibleTocEntries();\n    console.log('Visible TOC:', JSON.stringify(toc2.visible));\n    console.log('Hidden TOC:', JSON.stringify(toc2.hidden));\n\n    const test2Pass = fullDetailsIds.every(id => toc2.visible.includes(id))\n      && fastPathIds.every(id => toc2.hidden.includes(id));\n    console.log('Test 2:', test2Pass ? 'PASS' : 'FAIL');\n\n    // Screenshot tab 2\n    await page.screenshot({ path: '/tmp/pw-scripts/toc-full-details.png', fullPage: false });\n\n    // Test 3: Switch back to Fast Path\n    console.log('\\n=== TEST 3: Switch back to Fast Path ===');\n    await page.click('label:has-text(\"Fast Path\")');\n    await page.waitForTimeout(500);\n\n    const toc3 = await getVisibleTocEntries();\n    const test3Pass = fastPathIds.every(id => toc3.visible.includes(id))\n      && fullDetailsIds.every(id => toc3.hidden.includes(id));\n    console.log('Test 3:', test3Pass ? 'PASS' : 'FAIL');\n\n    // Overall\n    console.log('\\n=== OVERALL ===');\n    console.log(test1Pass && test2Pass && test3Pass ? 'ALL PASS' : 'SOME FAILED');\n\n  } catch (err) {\n    console.error('Error:', err.message);\n    process.exit(1);\n  } finally {\n    await browser.close();\n  }\n})();\n"
}
```

**Result:** ❌ Error
**Output:** ```
PreToolUse:Write hook error: [node <AWS_SECRET_REDACTED>ns/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js]: 🚫 **CONSTRAINT VIOLATION DETECTED - EXECUTION BLOCKED**

The following constraint violations must be corrected before proceeding:

**1. ERROR [no-console-log]: Use Logger.log() instead of console.log for better log management**
   🔍 Pattern: `console\.log`

Please modify your request to comply with these constraints and try again.
To override a constraint, i
...[truncated]
```


---

### Write - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Write
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/test-tabbed-toc.js",
  "content": "// OVERRIDE_CONSTRAINT: no-console-log\n// This is a throwaway test script in /tmp, not project code\nconst { chromium } = require('playwright');\n\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });\n  const page = await context.newPage();\n\n  try {\n    await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'networkidle' });\n\n    async function getVisibleTocEntries() {\n      return page.evaluate(() => {\n        const sidebar = document.querySelector('.md-sidebar--secondary');\n        if (!sidebar) return { error: 'no sidebar' };\n        const links = sidebar.querySelectorAll('a.md-nav__link');\n        const visible = [];\n        const hidden = [];\n        links.forEach(link => {\n          const li = link.closest('li');\n          const href = link.getAttribute('href');\n          if (!href || !href.startsWith('#')) return;\n          const id = href.slice(1);\n          if (li && li.style.display === 'none') {\n            hidden.push(id);\n          } else {\n            visible.push(id);\n          }\n        });\n        return { visible, hidden };\n      });\n    }\n\n    async function getActiveTab() {\n      return page.evaluate(() => {\n        const set = document.querySelector('.tabbed-set');\n        if (!set) return 'no tabbed-set';\n        const inputs = set.querySelectorAll(':scope > input[type=\"radio\"]');\n        const labels = set.querySelectorAll('.tabbed-labels label');\n        for (let i = 0; i < inputs.length; i++) {\n          if (inputs[i].checked) return labels[i]?.textContent?.trim() || 'tab ' + i;\n        }\n        return 'none checked';\n      });\n    }\n\n    const fastPathIds = ['how-it-works', 'key-modules', 'data-directory'];\n    const fullDetailsIds = ['system-topology', 'llm-provider-stack', 'overview', 'module-structure',\n      'triple-sync-persistence', 'startup-hydration', 'shutdown', 'api-server', 'graphstore', 'data-directory-layout'];\n\n    // Test 1: Initial load (Fast Path)\n    process.stdout.write('=== TEST 1: Fast Path tab active ===\\n');\n    const tab1 = await getActiveTab();\n    process.stdout.write('Active tab: ' + tab1 + '\\n');\n    const toc1 = await getVisibleTocEntries();\n    process.stdout.write('Visible: ' + JSON.stringify(toc1.visible) + '\\n');\n    process.stdout.write('Hidden: ' + JSON.stringify(toc1.hidden) + '\\n');\n    const t1 = fastPathIds.every(id => toc1.visible.includes(id))\n      && fullDetailsIds.every(id => toc1.hidden.includes(id));\n    process.stdout.write('Test 1: ' + (t1 ? 'PASS' : 'FAIL') + '\\n');\n\n    await page.screenshot({ path: '/tmp/pw-scripts/toc-fast-path.png', fullPage: false });\n\n    // Test 2: Switch to Full Details\n    process.stdout.write('\\n=== TEST 2: Full Details tab active ===\\n');\n    await page.click('label:has-text(\"Full Details\")');\n    await page.waitForTimeout(500);\n    const tab2 = await getActiveTab();\n    process.stdout.write('Active tab: ' + tab2 + '\\n');\n    const toc2 = await getVisibleTocEntries();\n    process.stdout.write('Visible: ' + JSON.stringify(toc2.visible) + '\\n');\n    process.stdout.write('Hidden: ' + JSON.stringify(toc2.hidden) + '\\n');\n    const t2 = fullDetailsIds.every(id => toc2.visible.includes(id))\n      && fastPathIds.every(id => toc2.hidden.includes(id));\n    process.stdout.write('Test 2: ' + (t2 ? 'PASS' : 'FAIL') + '\\n');\n\n    await page.screenshot({ path: '/tmp/pw-scripts/toc-full-details.png', fullPage: false });\n\n    // Test 3: Switch back\n    process.stdout.write('\\n=== TEST 3: Switch back to Fast Path ===\\n');\n    await page.click('label:has-text(\"Fast Path\")');\n    await page.waitForTimeout(500);\n    const toc3 = await getVisibleTocEntries();\n    const t3 = fastPathIds.every(id => toc3.visible.includes(id))\n      && fullDetailsIds.every(id => toc3.hidden.includes(id));\n    process.stdout.write('Test 3: ' + (t3 ? 'PASS' : 'FAIL') + '\\n');\n\n    process.stdout.write('\\n' + (t1 && t2 && t3 ? 'ALL PASS' : 'SOME FAILED') + '\\n');\n\n  } catch (err) {\n    process.stderr.write('Error: ' + err.message + '\\n');\n    process.exit(1);\n  } finally {\n    await browser.close();\n  }\n})();\n"
}
```

**Result:** ✅ Success
**Output:** ```
File created successfully at: /tmp/pw-scripts/test-tabbed-toc.js
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "node /tmp/pw-scripts/test-tabbed-toc.js 2>&1",
  "description": "Run Playwright test for tabbed TOC",
  "timeout": 30000
}
```

**Result:** ❌ Error
**Output:** ```
Exit code 1
node:internal/modules/cjs/loader:1478
  throw err;
  ^

Error: Cannot find module 'playwright'
Require stack:
- /private/tmp/pw-scripts/test-tabbed-toc.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1475:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1048:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1072:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1093:12)
    at Module._load (node:internal
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "cd /tmp/pw-scripts && npm install playwright 2>&1 | tail -5",
  "description": "Install playwright in /tmp/pw-scripts",
  "timeout": 60000
}
```

**Result:** ✅ Success
**Output:** ```
Command running in background with ID: bjw80rch3. Output is being written to: /private/tmp/claude-502/-Users-<USER_ID_REDACTED>-Agentic--work-rapid-automations/3933ae54-2afa-451a-a4fe-9f448a0908aa/tasks/bjw80rch3.output
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "cd /tmp/pw-scripts && npm ls playwright 2>/dev/null && node test-tabbed-toc.js 2>&1",
  "description": "Check if playwright installed, then run test",
  "timeout": 60000
}
```

**Result:** ❌ Error
**Output:** ```
Exit code 1
/private/tmp/pw-scripts
└── (empty)
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "find /Users/<USER_ID_REDACTED> -maxdepth 4 -name \"playwright\" -path \"*/node_modules/*\" -type d 2>/dev/null | head -5",
  "description": "Find existing playwright installation",
  "timeout": 10000
}
```

**Result:** ✅ Success
**Output:** ```
/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules/playwright
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "cd /Users/<USER_ID_REDACTED>/Agentic/coding && node /tmp/pw-scripts/test-tabbed-toc.js 2>&1",
  "description": "Run test with coding project's playwright",
  "timeout": 30000
}
```

**Result:** ❌ Error
**Output:** ```
Exit code 1
node:internal/modules/cjs/loader:1478
  throw err;
  ^

Error: Cannot find module 'playwright'
Require stack:
- /private/tmp/pw-scripts/test-tabbed-toc.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1475:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1048:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1072:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1093:12)
    at Module._load (node:internal
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node /tmp/pw-scripts/test-tabbed-toc.js 2>&1",
  "description": "Run with NODE_PATH pointing to playwright",
  "timeout": 30000
}
```

**Result:** ✅ Success
**Output:** ```
Command running in background with ID: bxds3rtsd. Output is being written to: /private/tmp/claude-502/-Users-<USER_ID_REDACTED>-Agentic--work-rapid-automations/3933ae54-2afa-451a-a4fe-9f448a0908aa/tasks/bxds3rtsd.output
```


---

### ToolSearch - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** ToolSearch
**Input:** ```json
{
  "query": "select:TaskOutput",
  "max_results": 1
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "tool_reference",
    "tool_name": "TaskOutput"
  }
]
```


---

### TaskOutput - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** TaskOutput
**Input:** ```json
{
  "task_id": "bxds3rtsd",
  "block": true,
  "timeout": 30000
}
```

**Result:** ❌ Error
**Output:** ```
<tool_use_error>No task found with ID: bxds3rtsd</tool_use_error>
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node /tmp/pw-scripts/test-tabbed-toc.js 2>&1",
  "description": "Run playwright test with NODE_PATH",
  "timeout": 30000
}
```

**Result:** ✅ Success
**Output:** ```
Command running in background with ID: bo71ptg9u. Output is being written to: /private/tmp/claude-502/-Users-<USER_ID_REDACTED>-Agentic--work-rapid-automations/3933ae54-2afa-451a-a4fe-9f448a0908aa/tasks/bo71ptg9u.output
```


---

### TaskOutput - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** TaskOutput
**Input:** ```json
{
  "task_id": "bo71ptg9u",
  "block": true,
  "timeout": 30000
}
```

**Result:** ✅ Success
**Output:** ```
<retrieval_status>success</retrieval_status>

<task_id>bo71ptg9u</task_id>

<task_type>local_bash</task_type>

<status>failed</status>

<exit_code>1</exit_code>

<output>
Error: page.goto: Timeout 30000ms exceeded.
Call log:
[2m  - navigating to "http://127.0.0.1:8000/integrations/okb/architecture.html", waiting until "networkidle"[22m
</output>
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "lsof -ti :8000 | xargs kill 2>/dev/null; sleep 1 && python3 -m mkdocs serve --dev-addr 127.0.0.1:8000 > /dev/null 2>&1 &\nsleep 3 && curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/",
  "description": "Restart MkDocs server and verify",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
200
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node /tmp/pw-scripts/test-tabbed-toc.js 2>&1",
  "description": "Run playwright TOC test",
  "timeout": 30000
}
```

**Result:** ✅ Success
**Output:** ```
Command running in background with ID: bzl1quffp. Output is being written to: /private/tmp/claude-502/-Users-<USER_ID_REDACTED>-Agentic--work-rapid-automations/3933ae54-2afa-451a-a4fe-9f448a0908aa/tasks/bzl1quffp.output
```


---

### TaskOutput - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** TaskOutput
**Input:** ```json
{
  "task_id": "bzl1quffp",
  "block": true,
  "timeout": 30000
}
```

**Result:** ✅ Success
**Output:** ```
<retrieval_status>success</retrieval_status>

<task_id>bzl1quffp</task_id>

<task_type>local_bash</task_type>

<status>failed</status>

<exit_code>1</exit_code>

<output>
Error: page.goto: Timeout 30000ms exceeded.
Call log:
[2m  - navigating to "http://127.0.0.1:8000/integrations/okb/architecture.html", waiting until "networkidle"[22m
</output>
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/test-tabbed-toc.js",
  "limit": 15
}
```

**Result:** ✅ Success
**Output:** ```
     1→// OVERRIDE_CONSTRAINT: no-console-log
     2→// This is a throwaway test script in /tmp, not project code
     3→const { chromium } = require('playwright');
     4→
     5→(async () => {
     6→  const browser = await chromium.launch({ headless: true });
     7→  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
     8→  const page = await context.newPage();
     9→
    10→  try {
    11→    await page.goto('http://127.0.0.1:8000/integrations/okb/archi
...[truncated]
```


---

### Edit - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Edit
**Input:** ```json
{
  "replace_all": false,
  "file_path": "/tmp/pw-scripts/test-tabbed-toc.js",
  "old_string": "    await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'networkidle' });",
  "new_string": "    await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n    await page.waitForSelector('.tabbed-set', { timeout: 5000 });\n    await page.waitForTimeout(500); // let tabbed-toc.js run"
}
```

**Result:** ✅ Success
**Output:** ```
The file /tmp/pw-scripts/test-tabbed-toc.js has been updated successfully.
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node /tmp/pw-scripts/test-tabbed-toc.js 2>&1",
  "description": "Run playwright TOC test with fixed wait",
  "timeout": 30000
}
```

**Result:** ✅ Success
**Output:** ```
=== TEST 1: Fast Path tab active ===
Active tab: Fast Path
Visible: ["how-it-works","key-modules","data-directory","system-topology","llm-provider-stack","overview","module-structure","triple-sync-persistence","startup-hydration","shutdown","api-server","graphstore","data-directory-layout"]
Hidden: []
Test 1: FAIL

=== TEST 2: Full Details tab active ===
Active tab: Full Details
Visible: ["how-it-works","key-modules","data-directory","system-topology","llm-provider-stack","overview","module-stru
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage();\n  \n  // Collect console messages\n  page.on('console', msg => process.stdout.write('CONSOLE [' + msg.type() + ']: ' + msg.text() + '\\n'));\n  page.on('pageerror', err => process.stdout.write('PAGE ERROR: ' + err.message + '\\n'));\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  // Check if our script loaded\n  const result = await page.evaluate(() => {\n    const scripts = Array.from(document.querySelectorAll('script'));\n    const tocScript = scripts.find(s => s.src && s.src.includes('tabbed-toc'));\n    \n    // Check DOM structure\n    const set = document.querySelector('.tabbed-set');\n    const inputs = set ? set.querySelectorAll(':scope > input[type=\\\"radio\\\"]') : [];\n    const blocks = set ? set.querySelectorAll(':scope > .tabbed-content > .tabbed-block') : [];\n    \n    return {\n      scriptFound: !!tocScript,\n      scriptSrc: tocScript?.src || 'none',\n      tabbedSetFound: !!set,\n      inputCount: inputs.length,\n      blockCount: blocks.length,\n      firstInputChecked: inputs[0]?.checked,\n      blockHeadings: Array.from(blocks).map((b, i) => {\n        const hs = b.querySelectorAll('h1,h2,h3,h4,h5,h6');\n        return { block: i, ids: Array.from(hs).map(h => h.id) };\n      }),\n    };\n  });\n  \n  process.stdout.write(JSON.stringify(result, null, 2) + '\\n');\n  await browser.close();\n})();\n\" 2>&1",
  "description": "Debug JS execution and DOM structure",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
CONSOLE [log]: Enabled live reload
{
  "scriptFound": true,
  "scriptSrc": "http://127.0.0.1:8000/javascripts/tabbed-toc.js",
  "tabbedSetFound": true,
  "inputCount": 2,
  "blockCount": 2,
  "firstInputChecked": true,
  "blockHeadings": [
    {
      "block": 0,
      "ids": [
        "how-it-works",
        "key-modules",
        "data-directory"
      ]
    },
    {
      "block": 1,
      "ids": [
        "system-topology",
        "llm-provider-stack",
        "overview",
        "module-st
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage();\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  const result = await page.evaluate(() => {\n    // Check the TOC nav\n    const toc = document.querySelector('.md-nav--secondary');\n    if (!toc) return { error: 'no toc' };\n    \n    // Check for links\n    const links = toc.querySelectorAll('a.md-nav__link');\n    const linkData = Array.from(links).map(a => {\n      const li = a.closest('li');\n      return {\n        href: a.getAttribute('href'),\n        display: li ? li.style.display : 'no-li',\n        liTag: li ? li.tagName : 'none',\n      };\n    });\n    \n    return { tocFound: true, linkCount: links.length, links: linkData };\n  });\n  \n  process.stdout.write(JSON.stringify(result, null, 2) + '\\n');\n  await browser.close();\n})();\n\" 2>&1",
  "description": "Debug TOC link structure",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
{
  "tocFound": true,
  "linkCount": 13,
  "links": [
    {
      "href": "#how-it-works",
      "display": "",
      "liTag": "LI"
    },
    {
      "href": "#key-modules",
      "display": "",
      "liTag": "LI"
    },
    {
      "href": "#data-directory",
      "display": "",
      "liTag": "LI"
    },
    {
      "href": "#system-topology",
      "display": "none",
      "liTag": "LI"
    },
    {
      "href": "#llm-provider-stack",
      "display": "none",
      "liTag": "LI"
    },
   
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  function getToc() {\n    return page.evaluate(() => {\n      const toc = document.querySelector('.md-nav--secondary');\n      const links = toc.querySelectorAll('a.md-nav__link');\n      const visible = [], hidden = [];\n      links.forEach(a => {\n        const li = a.closest('li');\n        const id = a.getAttribute('href').slice(1);\n        if (li && li.style.display === 'none') hidden.push(id);\n        else visible.push(id);\n      });\n      return { visible, hidden };\n    });\n  }\n  \n  // Test 1: Fast Path active\n  const t1 = await getToc();\n  process.stdout.write('Fast Path tab - Visible: ' + JSON.stringify(t1.visible) + '\\n');\n  process.stdout.write('Fast Path tab - Hidden: ' + JSON.stringify(t1.hidden) + '\\n');\n  await page.screenshot({ path: '/tmp/pw-scripts/toc-fast-path.png' });\n  \n  // Test 2: Switch to Full Details\n  await page.click('label:has-text(\\\"Full Details\\\")');\n  await page.waitForTimeout(500);\n  const t2 = await getToc();\n  process.stdout.write('Full Details tab - Visible: ' + JSON.stringify(t2.visible) + '\\n');\n  process.stdout.write('Full Details tab - Hidden: ' + JSON.stringify(t2.hidden) + '\\n');\n  await page.screenshot({ path: '/tmp/pw-scripts/toc-full-details.png' });\n  \n  // Test 3: Switch back\n  await page.click('label:has-text(\\\"Fast Path\\\")');\n  await page.waitForTimeout(500);\n  const t3 = await getToc();\n  process.stdout.write('Back to Fast Path - Visible: ' + JSON.stringify(t3.visible) + '\\n');\n  \n  const pass1 = t1.visible.length === 3 && t1.hidden.length === 10;\n  const pass2 = t2.visible.length === 10 && t2.hidden.length === 3;\n  const pass3 = t3.visible.length === 3 && t3.hidden.length === 10;\n  process.stdout.write('\\\\nTest 1 (Fast Path): ' + (pass1 ? 'PASS' : 'FAIL') + '\\\\n');\n  process.stdout.write('Test 2 (Full Details): ' + (pass2 ? 'PASS' : 'FAIL') + '\\\\n');\n  process.stdout.write('Test 3 (Switch back): ' + (pass3 ? 'PASS' : 'FAIL') + '\\\\n');\n  process.stdout.write(pass1 && pass2 && pass3 ? '\\\\nALL PASS\\\\n' : '\\\\nSOME FAILED\\\\n');\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Run final playwright TOC verification test",
  "timeout": 30000
}
```

**Result:** ✅ Success
**Output:** ```
Fast Path tab - Visible: ["how-it-works","key-modules","data-directory"]
Fast Path tab - Hidden: ["system-topology","llm-provider-stack","overview","module-structure","triple-sync-persistence","startup-hydration","shutdown","api-server","graphstore","data-directory-layout"]
Full Details tab - Visible: ["system-topology","llm-provider-stack","overview","module-structure","triple-sync-persistence","startup-hydration","shutdown","api-server","graphstore","data-directory-layout"]
Full Details tab - 
...[truncated]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/toc-fast-path.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>3u/4iJ/7tdvOnlv1fd
...[truncated]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/toc-full-details.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>3u/4iJ/7tdvOnlv1fd
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  // Screenshot just the right sidebar for Fast Path\n  const sidebar = await page.locator('.md-sidebar--secondary');\n  await sidebar.screenshot({ path: '/tmp/pw-scripts/sidebar-fast.png' });\n  \n  // Switch to Full Details\n  await page.click('label:has-text(\\\"Full Details\\\")');\n  await page.waitForTimeout(500);\n  await sidebar.screenshot({ path: '/tmp/pw-scripts/sidebar-full.png' });\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Screenshot just the sidebar for each tab",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
(Bash completed with no output)
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/sidebar-fast.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>qqSmXbt2vG7cuHHWrF
...[truncated]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/sidebar-full.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>qqSmXbt2vG7cuHHWrF
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  // Get the TOC text content for Fast Path\n  const tocFast = await page.evaluate(() => {\n    const nav = document.querySelector('.md-nav--secondary');\n    if (!nav) return 'no nav';\n    // Get visible text\n    const items = nav.querySelectorAll('li');\n    return Array.from(items).map(li => {\n      const a = li.querySelector('a');\n      const display = li.style.display;\n      const text = a ? a.textContent.trim() : '';\n      return (display === 'none' ? '[HIDDEN] ' : '[VISIBLE] ') + text;\n    }).filter(s => s.length > 10);\n  });\n  process.stdout.write('Fast Path TOC:\\\\n');\n  tocFast.forEach(t => process.stdout.write('  ' + t + '\\\\n'));\n  \n  // Clip just the right portion of the page\n  await page.screenshot({ path: '/tmp/pw-scripts/page-fast.png', clip: { x: 1050, y: 80, width: 550, height: 600 } });\n  \n  // Switch to Full Details\n  await page.click('label:has-text(\\\"Full Details\\\")');\n  await page.waitForTimeout(500);\n  \n  const tocFull = await page.evaluate(() => {\n    const nav = document.querySelector('.md-nav--secondary');\n    const items = nav.querySelectorAll('li');\n    return Array.from(items).map(li => {\n      const a = li.querySelector('a');\n      const display = li.style.display;\n      const text = a ? a.textContent.trim() : '';\n      return (display === 'none' ? '[HIDDEN] ' : '[VISIBLE] ') + text;\n    }).filter(s => s.length > 10);\n  });\n  process.stdout.write('\\\\nFull Details TOC:\\\\n');\n  tocFull.forEach(t => process.stdout.write('  ' + t + '\\\\n'));\n  \n  await page.screenshot({ path: '/tmp/pw-scripts/page-full.png', clip: { x: 1050, y: 80, width: 550, height: 600 } });\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Detailed TOC visibility check with sidebar screenshots",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
Fast Path TOC:
  [VISIBLE] How it works
  [VISIBLE] Key modules
  [VISIBLE] Data directory
  [HIDDEN] System Topology
  [HIDDEN] LLM Provider Stack
  [HIDDEN] Overview
  [HIDDEN] Module Structure
  [HIDDEN] Triple-Sync Persistence
  [HIDDEN] Startup Hydration
  [HIDDEN] Shutdown
  [HIDDEN] API Server
  [HIDDEN] GraphStore
  [HIDDEN] Data Directory Layout

Full Details TOC:
  [HIDDEN] How it works
  [HIDDEN] Key modules
  [HIDDEN] Data directory
  [VISIBLE] System Topology
  [VISIBLE] LLM Provide
...[truncated]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/page-fast.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>yBJCCCGeP3I5QgghXE
...[truncated]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/page-full.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>nfT0dEEIIYTkP3Q5hB
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  // Check computed styles on hidden li\n  const result = await page.evaluate(() => {\n    const nav = document.querySelector('.md-nav--secondary');\n    const items = nav.querySelectorAll('li');\n    return Array.from(items).slice(3, 6).map(li => {\n      const a = li.querySelector('a');\n      const computed = window.getComputedStyle(li);\n      return {\n        text: a?.textContent?.trim(),\n        inlineDisplay: li.style.display,\n        computedDisplay: computed.display,\n        computedVisibility: computed.visibility,\n        classes: li.className,\n        parentTag: li.parentElement?.tagName,\n        parentClasses: li.parentElement?.className,\n      };\n    });\n  });\n  process.stdout.write(JSON.stringify(result, null, 2) + '\\\\n');\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Check computed display styles on hidden TOC items",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "text": "System Topology",
    "inlineDisplay": "none",
    "computedDisplay": "none",
    "computedVisibility": "collapse",
    "classes": "md-nav__item",
    "parentTag": "UL",
    "parentClasses": "md-nav__list"
  },
  {
    "text": "LLM Provider Stack",
    "inlineDisplay": "none",
    "computedDisplay": "none",
    "computedVisibility": "collapse",
    "classes": "md-nav__item",
    "parentTag": "UL",
    "parentClasses": "md-nav__list"
  },
  {
    "text": "Overview",
    "inline
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  // Screenshot just the secondary nav element\n  const nav = await page.locator('nav.md-nav--secondary');\n  await nav.screenshot({ path: '/tmp/pw-scripts/nav-fast.png' });\n  \n  await page.click('label:has-text(\\\"Full Details\\\")');\n  await page.waitForTimeout(500);\n  await nav.screenshot({ path: '/tmp/pw-scripts/nav-full.png' });\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Screenshot the nav element directly for both tabs",
  "timeout": 15000
}
```

**Result:** ❌ Error
**Output:** ```
Exit code 1
node:internal/process/promises:332
    triggerUncaughtException(err, true /* fromPromise */);
    ^

locator.screenshot: Error: strict mode violation: locator('nav.md-nav--secondary') resolved to 2 elements:
    1) <nav aria-label="Table of contents" class="md-nav md-nav--secondary">…</nav> aka getByLabel('Navigation').getByText('Table of contents How it')
    2) <nav aria-label="Table of contents" class="md-nav md-nav--secondary">…</nav> aka getByRole('navigation', { name: 'Table of
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  // Screenshot the right sidebar\n  const sidebar = await page.locator('.md-sidebar--secondary').first();\n  await sidebar.screenshot({ path: '/tmp/pw-scripts/nav-fast.png' });\n  \n  await page.click('label:has-text(\\\"Full Details\\\")');\n  await page.waitForTimeout(500);\n  await sidebar.screenshot({ path: '/tmp/pw-scripts/nav-full.png' });\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Screenshot sidebar for both tabs",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
(Bash completed with no output)
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/nav-fast.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>MXr06MaNGxshYiVGhb
...[truncated]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/nav-full.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>MXr06MaNGxshYiVGhb
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  // Full page screenshot - Fast Path\n  await page.screenshot({ path: '/tmp/pw-scripts/full-fast.png', fullPage: false });\n  \n  // Switch to Full Details\n  await page.click('label:has-text(\\\"Full Details\\\")');\n  await page.waitForTimeout(500);\n  await page.screenshot({ path: '/tmp/pw-scripts/full-details.png', fullPage: false });\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Full viewport screenshots for both tabs",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
(Bash completed with no output)
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/full-fast.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>aondS4PEfFamZsFqaL
...[truncated]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/full-details.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>aondS4PEfFamZsFqaL
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  // Get the exact structure of the TOC HTML\n  const tocHtml = await page.evaluate(() => {\n    const nav = document.querySelector('.md-sidebar--secondary nav.md-nav--secondary');\n    if (!nav) return 'no nav';\n    // Get the inner HTML, but simplified\n    const ul = nav.querySelector('ul.md-nav__list');\n    if (!ul) return 'no ul';\n    \n    function dump(el, depth) {\n      let result = '';\n      const indent = '  '.repeat(depth);\n      if (el.tagName === 'LI') {\n        const a = el.querySelector(':scope > a');\n        const display = el.style.display;\n        const href = a ? a.getAttribute('href') : '';\n        const text = a ? a.textContent.trim() : '';\n        const vis = display === 'none' ? 'HIDDEN' : 'VISIBLE';\n        result += indent + '<li ' + vis + '> ' + href + ' ' + text + '\\\\n';\n      } else if (el.tagName === 'UL') {\n        result += indent + '<ul>\\\\n';\n      }\n      for (const child of el.children) {\n        result += dump(child, depth + 1);\n      }\n      if (el.tagName === 'UL') {\n        result += indent + '</ul>\\\\n';\n      }\n      return result;\n    }\n    return dump(ul, 0);\n  });\n  process.stdout.write(tocHtml);\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Dump TOC HTML structure with visibility",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
<ul>
  <li VISIBLE> #how-it-works How it works
  <li VISIBLE> #key-modules Key modules
  <li VISIBLE> #data-directory Data directory
      <ul>
        <li VISIBLE> #system-topology System Topology
        <li VISIBLE> #llm-provider-stack LLM Provider Stack
      </ul>
  <li VISIBLE> #overview Overview
  <li VISIBLE> #module-structure Module Structure
  <li VISIBLE> #triple-sync-persistence Triple-Sync Persistence
      <ul>
        <li VISIBLE> #startup-hydration Startup Hydration
        <li V
...[truncated]
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1000);\n  \n  const result = await page.evaluate(() => {\n    const navs = document.querySelectorAll('.md-nav--secondary');\n    return Array.from(navs).map((nav, i) => {\n      const rect = nav.getBoundingClientRect();\n      const links = nav.querySelectorAll('a.md-nav__link');\n      const hidden = Array.from(links).filter(a => {\n        const li = a.closest('li');\n        return li && li.style.display === 'none';\n      }).length;\n      return {\n        index: i,\n        visible: rect.width > 0 && rect.height > 0,\n        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },\n        totalLinks: links.length,\n        hiddenLinks: hidden,\n        parent: nav.parentElement?.className?.substring(0, 60),\n      };\n    });\n  });\n  process.stdout.write(JSON.stringify(result, null, 2) + '\\\\n');\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Check all secondary nav elements and their visibility",
  "timeout": 15000
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "index": 0,
    "visible": false,
    "rect": {
      "x": 0,
      "y": 0,
      "w": 0,
      "h": 0
    },
    "totalLinks": 13,
    "hiddenLinks": 10,
    "parent": "md-nav__item md-nav__item--active"
  },
  {
    "index": 1,
    "visible": true,
    "rect": {
      "x": 1209,
      "y": 165,
      "w": 253,
      "h": 414
    },
    "totalLinks": 13,
    "hiddenLinks": 0,
    "parent": "md-sidebar__inner"
  }
]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/Users/<USER_ID_REDACTED>/Agentic/_work/rapid-automations/docs/javascripts/tabbed-toc.js"
}
```

**Result:** ✅ Success
**Output:** ```
     1→/**
     2→ * Synchronizes the right-sidebar TOC with the active tab.
     3→ *
     4→ * When a page uses pymdownx.tabbed (alternate style), headings from ALL tabs
     5→ * appear in the TOC. This script hides TOC entries whose anchors live inside
     6→ * an inactive tab, so only the active tab's headings are navigable.
     7→ */
     8→(function () {
     9→  "use strict";
    10→
    11→  function updateToc() {
    12→    var toc = document.querySelector(".md-nav--secondary");
    
...[truncated]
```


---

### Edit - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Edit
**Input:** ```json
{
  "replace_all": false,
  "file_path": "/Users/<USER_ID_REDACTED>/Agentic/_work/rapid-automations/docs/javascripts/tabbed-toc.js",
  "old_string": "  function updateToc() {\n    var toc = document.querySelector(\".md-nav--secondary\");\n    if (!toc) return;\n\n    var tabbedSets = document.querySelectorAll(\".tabbed-set\");\n    if (!tabbedSets.length) return;\n\n    // Collect heading IDs that are inside an INACTIVE tab block\n    var hiddenIds = new Set();\n    var visibleIds = new Set();\n\n    tabbedSets.forEach(function (set) {\n      var inputs = set.querySelectorAll(':scope > input[type=\"radio\"]');\n      var blocks = set.querySelectorAll(\n        \":scope > .tabbed-content > .tabbed-block\"\n      );\n\n      inputs.forEach(function (input, idx) {\n        var block = blocks[idx];\n        if (!block) return;\n\n        var headings = block.querySelectorAll(\"h1, h2, h3, h4, h5, h6\");\n        headings.forEach(function (h) {\n          if (h.id) {\n            if (input.checked) {\n              visibleIds.add(h.id);\n            } else {\n              hiddenIds.add(h.id);\n            }\n          }\n        });\n      });\n    });\n\n    // For each TOC link, show/hide based on whether its target is in an\n    // active or inactive tab.  Headings outside any tab are always visible.\n    var tocLinks = toc.querySelectorAll(\"a.md-nav__link\");\n    tocLinks.forEach(function (link) {\n      var href = link.getAttribute(\"href\");\n      if (!href || href.charAt(0) !== \"#\") return;\n      var id = href.slice(1);\n\n      // Find the closest navigable list item\n      var li = link.closest(\"li\");\n      if (!li) return;\n\n      if (hiddenIds.has(id) && !visibleIds.has(id)) {\n        li.style.display = \"none\";\n      } else {\n        li.style.display = \"\";\n      }\n    });\n  }",
  "new_string": "  function updateToc() {\n    var tocs = document.querySelectorAll(\".md-nav--secondary\");\n    if (!tocs.length) return;\n\n    var tabbedSets = document.querySelectorAll(\".tabbed-set\");\n    if (!tabbedSets.length) return;\n\n    // Collect heading IDs that are inside an INACTIVE tab block\n    var hiddenIds = new Set();\n    var visibleIds = new Set();\n\n    tabbedSets.forEach(function (set) {\n      var inputs = set.querySelectorAll(':scope > input[type=\"radio\"]');\n      var blocks = set.querySelectorAll(\n        \":scope > .tabbed-content > .tabbed-block\"\n      );\n\n      inputs.forEach(function (input, idx) {\n        var block = blocks[idx];\n        if (!block) return;\n\n        var headings = block.querySelectorAll(\"h1, h2, h3, h4, h5, h6\");\n        headings.forEach(function (h) {\n          if (h.id) {\n            if (input.checked) {\n              visibleIds.add(h.id);\n            } else {\n              hiddenIds.add(h.id);\n            }\n          }\n        });\n      });\n    });\n\n    // Update ALL TOC navs (Material renders both mobile and desktop copies)\n    tocs.forEach(function (toc) {\n      var tocLinks = toc.querySelectorAll(\"a.md-nav__link\");\n      tocLinks.forEach(function (link) {\n        var href = link.getAttribute(\"href\");\n        if (!href || href.charAt(0) !== \"#\") return;\n        var id = href.slice(1);\n\n        var li = link.closest(\"li\");\n        if (!li) return;\n\n        if (hiddenIds.has(id) && !visibleIds.has(id)) {\n          li.style.display = \"none\";\n        } else {\n          li.style.display = \"\";\n        }\n      });\n    });\n  }"
}
```

**Result:** ✅ Success
**Output:** ```
The file /Users/<USER_ID_REDACTED>/Agentic/_work/rapid-automations/docs/javascripts/tabbed-toc.js has been updated successfully.
```


---

### Bash - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Bash
**Input:** ```json
{
  "command": "sleep 2 && NODE_PATH=/Users/<USER_ID_REDACTED>/Agentic/coding/node_modules node -e \"\nconst { chromium } = require('playwright');\n(async () => {\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });\n  \n  await page.goto('http://127.0.0.1:8000/integrations/okb/architecture.html', { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(1500);\n  \n  // Check both navs\n  const check = async (label) => {\n    return page.evaluate(() => {\n      const navs = document.querySelectorAll('.md-nav--secondary');\n      return Array.from(navs).map((nav, i) => {\n        const rect = nav.getBoundingClientRect();\n        const links = nav.querySelectorAll('a.md-nav__link');\n        const hidden = Array.from(links).filter(a => {\n          const li = a.closest('li');\n          return li && li.style.display === 'none';\n        }).length;\n        return { index: i, onScreen: rect.width > 0, totalLinks: links.length, hiddenLinks: hidden };\n      });\n    });\n  };\n  \n  const r1 = await check('Fast Path');\n  process.stdout.write('Fast Path tab:\\\\n' + JSON.stringify(r1, null, 2) + '\\\\n');\n  \n  await page.click('label:has-text(\\\"Full Details\\\")');\n  await page.waitForTimeout(500);\n  const r2 = await check('Full Details');\n  process.stdout.write('\\\\nFull Details tab:\\\\n' + JSON.stringify(r2, null, 2) + '\\\\n');\n  \n  // Screenshots\n  await page.screenshot({ path: '/tmp/pw-scripts/final-full.png', fullPage: false });\n  await page.click('label:has-text(\\\"Fast Path\\\")');\n  await page.waitForTimeout(500);\n  await page.screenshot({ path: '/tmp/pw-scripts/final-fast.png', fullPage: false });\n  \n  await browser.close();\n})();\n\" 2>&1",
  "description": "Test updated JS with both nav targets",
  "timeout": 20000
}
```

**Result:** ✅ Success
**Output:** ```
Fast Path tab:
[
  {
    "index": 0,
    "onScreen": false,
    "totalLinks": 13,
    "hiddenLinks": 10
  },
  {
    "index": 1,
    "onScreen": true,
    "totalLinks": 13,
    "hiddenLinks": 10
  }
]

Full Details tab:
[
  {
    "index": 0,
    "onScreen": false,
    "totalLinks": 13,
    "hiddenLinks": 3
  },
  {
    "index": 1,
    "onScreen": true,
    "totalLinks": 13,
    "hiddenLinks": 3
  }
]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/final-fast.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>aondS4PEfFamZsFqaL
...[truncated]
```


---

### Read - 2026-03-21 07:44:59 UTC [08:44:59 CEST] (Redirected)

**User Request:** # Playwright CLI Skill

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
const progressPath = '/Users/<USER_ID_REDACTED>/Agentic/coding/.data/workflow-progress.json';
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

**Tool:** Read
**Input:** ```json
{
  "file_path": "/tmp/pw-scripts/final-full.png"
}
```

**Result:** ✅ Success
**Output:** ```
[
  {
    "type": "image",
    "source": {
      "type": "base64",
      "data": "<AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED><AWS_SECRET_REDACTED>aondS4PEfFamZsFqaL
...[truncated]
```


---

---

