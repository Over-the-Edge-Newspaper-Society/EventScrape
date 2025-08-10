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
    return await chromium.launch({
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
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
    });
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
      userAgent: this.getRandomUserAgent(),
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

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0',
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  getStatus() {
    return {
      total: this.browsers.length,
      available: this.availableBrowsers.length,
      inUse: this.browsers.length - this.availableBrowsers.length,
    };
  }
}