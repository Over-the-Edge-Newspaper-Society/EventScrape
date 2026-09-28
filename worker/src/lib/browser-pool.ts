import { chromium, Browser, Page } from 'playwright';

export class BrowserPool {
  private browsers: Browser[] = [];
  private availableBrowsers: Browser[] = [];
  private readonly maxBrowsers: number;
  private readonly headless: boolean;

  constructor(maxBrowsers: number = 3, headless: boolean = true) {
    this.maxBrowsers = maxBrowsers;
    this.headless = headless;
  }

  async initialize(): Promise<void> {
    console.log(`Initializing browser pool with ${this.maxBrowsers} browsers...`);
    
    for (let i = 0; i < this.maxBrowsers; i++) {
      const browser = await this.createBrowser();
      this.browsers.push(browser);
      this.availableBrowsers.push(browser);
    }
    
    console.log(`✅ Browser pool initialized with ${this.browsers.length} browsers`);
  }

  private async createBrowser(): Promise<Browser> {
    const launchOptions: any = {
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-background-networking',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--disable-blink-features=AutomationControlled',
        '--disable-automation',
        '--disable-plugins-discovery',
        '--disable-web-security',
        '--allow-running-insecure-content',
        // Some servers (e.g. tourismpg.com) trigger net::ERR_HTTP2_PROTOCOL_ERROR
        // in Chromium's HTTP/2 stack even though they respond fine over HTTP/1.1.
        // Force HTTP/1.1 to avoid these protocol negotiation failures.
        '--disable-http2',
        '--no-zygote',
        '--memory-pressure-off',
      ],
    };

    // In containers (e.g. Alpine) we ship a system Chromium instead of the
    // Playwright-bundled browser. Honor the executable path when provided.
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    }

    return await chromium.launch(launchOptions);
  }

  async getBrowser(): Promise<Browser> {
    if (this.availableBrowsers.length > 0) {
      return this.availableBrowsers.pop()!;
    }

    // No available browsers, wait or create new one
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.availableBrowsers.length > 0) {
          clearInterval(checkInterval);
          resolve(this.availableBrowsers.pop()!);
        }
      }, 100);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for available browser'));
      }, 30000);
    });
  }

  async getPage(): Promise<{ browser: Browser; page: Page; release: () => Promise<void> }> {
    const browser = await this.getBrowser();
    
    const page = await browser.newPage({
      // Match the actual Chromium engine; random Firefox identities caused 403s.
      userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
      viewport: { width: 1920, height: 1080 },
    });

    // Set default timeouts
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    const release = async () => {
      try {
        await page.close();
      } catch (error) {
        console.warn('Error closing page:', error);
      }
      this.releaseBrowser(browser);
    };

    return { browser, page, release };
  }

  releaseBrowser(browser: Browser): void {
    if (this.browsers.includes(browser) && !this.availableBrowsers.includes(browser)) {
      this.availableBrowsers.push(browser);
    }
  }

  async closeAll(): Promise<void> {
    console.log('Closing all browsers...');
    
    await Promise.all(
      this.browsers.map(browser => 
        browser.close().catch(error => 
          console.warn('Error closing browser:', error)
        )
      )
    );
    
    this.browsers.length = 0;
    this.availableBrowsers.length = 0;
    
    console.log('✅ All browsers closed');
  }

  getStatus() {
    return {
      total: this.browsers.length,
      available: this.availableBrowsers.length,
      inUse: this.browsers.length - this.availableBrowsers.length,
    };
  }
}