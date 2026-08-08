// NOTE: `playwright` is deliberately NOT imported at module scope.
//
// It is an optionalDependency, because gsd-browser is this project's mandated
// browser tool (see CLAUDE.md) and ships its own Chrome for Testing. This
// module is a legacy Copilot fallback that may never be used, yet
// lib/adapters/copilot.js imports it eagerly — so a top-level
// `import playwright` would make the whole adapter fail to load on any host
// where the optional install was skipped. The import is therefore deferred to
// initialize(), the only place playwright is actually touched.
class BrowserFallbackService {
  constructor(config = {}) {
    this.browserType = config.browser || 'chromium';
    this.headless = config.headless !== false;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.initialized = false;
  }

  async initialize() {
    let playwright;
    try {
      ({ default: playwright } = await import('playwright'));
    } catch {
      throw new Error(
        'Browser fallback requires the optional "playwright" package, which is not installed. ' +
        'This project uses gsd-browser for browser automation instead — prefer that. ' +
        'If you specifically need this legacy fallback: npm install playwright && npx playwright install chromium'
      );
    }

    try {
      // Launch browser
      this.browser = await playwright[this.browserType].launch({
        headless: this.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      // Create context with permissions
      this.context = await this.browser.newContext({
        acceptDownloads: true,
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 720 }
      });
      
      // Create initial page
      this.page = await this.context.newPage();
      
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize browser service: ${error.message}`);
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * Navigate to a URL
   */
  async navigate(url) {
    if (!this.initialized) throw new Error('Browser service not initialized');
    
    try {
      const response = await this.page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000
      });
      
      return {
        success: true,
        url: this.page.url(),
        status: response.status(),
        title: await this.page.title()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Perform an action on the page
   */
  async act(action, variables = {}) {
    if (!this.initialized) throw new Error('Browser service not initialized');
    
    try {
      // Parse action to determine what to do
      const actionLower = action.toLowerCase();
      
      // Click actions
      if (actionLower.includes('click')) {
        const selector = this.extractSelector(action, variables);
        await this.page.click(selector);
        return { success: true, action: 'clicked', selector };
      }
      
      // Type/Fill actions
      if (actionLower.includes('type') || actionLower.includes('fill')) {
        const selector = this.extractSelector(action, variables);
        const text = this.extractText(action, variables);
        await this.page.fill(selector, text);
        return { success: true, action: 'typed', selector, text };
      }
      
      // Select actions
      if (actionLower.includes('select')) {
        const selector = this.extractSelector(action, variables);
        const value = this.extractValue(action, variables);
        await this.page.selectOption(selector, value);
        return { success: true, action: 'selected', selector, value };
      }
      
      // Scroll actions
      if (actionLower.includes('scroll')) {
        if (actionLower.includes('bottom')) {
          await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        } else if (actionLower.includes('top')) {
          await this.page.evaluate(() => window.scrollTo(0, 0));
        } else {
          const pixels = parseInt(action.match(/\d+/)?.[0] || '100');
          await this.page.evaluate((px) => window.scrollBy(0, px), pixels);
        }
        return { success: true, action: 'scrolled' };
      }
      
      // Wait actions
      if (actionLower.includes('wait')) {
        const ms = parseInt(action.match(/\d+/)?.[0] || '1000');
        await this.page.waitForTimeout(ms);
        return { success: true, action: 'waited', duration: ms };
      }
      
      // Default: try to find and click an element with matching text
      const elements = await this.page.$$('*');
      for (const element of elements) {
        const text = await element.textContent().catch(() => '');
        if (text && text.toLowerCase().includes(actionLower)) {
          await element.click();
          return { success: true, action: 'clicked', matched: text };
        }
      }
      
      throw new Error(`Could not interpret action: ${action}`);
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract all text from the current page
   */
  async extract() {
    if (!this.initialized) throw new Error('Browser service not initialized');
    
    try {
      // Get page content
      const content = await this.page.evaluate(() => {
        // Remove script and style elements
        const scripts = document.querySelectorAll('script, style');
        scripts.forEach(el => el.remove());
        
        // Get text content
        return document.body.innerText;
      });
      
      return {
        success: true,
        content,
        url: this.page.url(),
        title: await this.page.title()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Take a screenshot
   */
  async screenshot(options = {}) {
    if (!this.initialized) throw new Error('Browser service not initialized');
    
    try {
      const screenshot = await this.page.screenshot({
        fullPage: options.fullPage !== false,
        type: options.type || 'png'
      });
      
      return {
        success: true,
        data: screenshot,
        url: this.page.url()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Wait for a specific element
   */
  async waitFor(selector, options = {}) {
    if (!this.initialized) throw new Error('Browser service not initialized');
    
    try {
      await this.page.waitForSelector(selector, {
        timeout: options.timeout || 10000,
        state: options.state || 'visible'
      });
      
      return { success: true, selector };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute JavaScript in the page context
   */
  async evaluate(script, ...args) {
    if (!this.initialized) throw new Error('Browser service not initialized');
    
    try {
      const result = await this.page.evaluate(script, ...args);
      return {
        success: true,
        result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Helper methods
  
  extractSelector(action, variables) {
    // Look for CSS selector patterns
    const selectorMatch = action.match(/['"]([^'"]+)['"]/);
    if (selectorMatch) return selectorMatch[1];
    
    // Look for common patterns
    if (action.includes('button')) return 'button';
    if (action.includes('input')) return 'input';
    if (action.includes('link')) return 'a';
    
    // Check variables
    if (variables.selector) return variables.selector;
    
    return 'body';
  }

  extractText(action, variables) {
    // Look for quoted text
    const textMatch = action.match(/['"]([^'"]+)['"]/);
    if (textMatch) return textMatch[1];
    
    // Check variables
    if (variables.text) return variables.text;
    if (variables.value) return variables.value;
    
    return '';
  }

  extractValue(action, variables) {
    return this.extractText(action, variables);
  }
}

export default BrowserFallbackService;