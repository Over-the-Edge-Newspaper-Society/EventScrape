import { readdir } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { ScraperModule } from '../types.js';

export class ModuleLoader {
  private modules = new Map<string, ScraperModule>();
  private modulesDir: string;

  constructor(modulesDir: string = ModuleLoader.getDefaultModulesDir()) {
    this.modulesDir = resolve(modulesDir);
  }

  private static getDefaultModulesDir(): string {
    const runtimeDir = dirname(fileURLToPath(import.meta.url));
    const defaultDir = resolve(runtimeDir, '..', 'modules');
    const envDir = process.env.WORKER_MODULES_DIR;

    return resolve(envDir || defaultDir);
  }

  async loadModules(): Promise<void> {
    try {
      const entries = await readdir(this.modulesDir, { withFileTypes: true });
      const moduleDirs = entries.filter(entry => entry.isDirectory());

      for (const dir of moduleDirs) {
        try {
          await this.loadModule(dir.name);
        } catch (error) {
          console.error(`Failed to load module ${dir.name}:`, error);
        }
      }

      console.log(`Loaded ${this.modules.size} scraper modules`);
    } catch (error) {
      console.error('Failed to read modules directory:', error);
    }
  }

  private async loadModule(moduleKey: string): Promise<void> {
    try {
      // Try .ts first in development, then .js
      const isDev = process.env.NODE_ENV === 'development';
      const extensions = isDev ? ['index.ts', 'index.js'] : ['index.js', 'index.ts'];
      
      let moduleExports;
      for (const ext of extensions) {
        const modulePath = join(this.modulesDir, moduleKey, ext);
        try {
          // Dynamic import for ES modules
          moduleExports = await import(`file://${modulePath}`);
          break;
        } catch (error) {
          if (ext === extensions[extensions.length - 1]) {
            throw error; // Re-throw if this is the last attempt
          }
          // Continue to next extension
        }
      }
      
      const scraperModule: ScraperModule = moduleExports.default || moduleExports;

      // Validate module structure
      if (!this.isValidModule(scraperModule)) {
        throw new Error(`Invalid module structure in ${moduleKey}`);
      }

      // Ensure the key matches directory name
      if (scraperModule.key !== moduleKey) {
        console.warn(`Module key mismatch: directory=${moduleKey}, module.key=${scraperModule.key}`);
      }

      this.modules.set(moduleKey, scraperModule);
      console.log(`✅ Loaded module: ${scraperModule.label} (${moduleKey})`);
    } catch (error) {
      throw new Error(`Failed to import module ${moduleKey}: ${error}`);
    }
  }

  private isValidModule(module: any): module is ScraperModule {
    return (
      module &&
      typeof module.key === 'string' &&
      typeof module.label === 'string' &&
      Array.isArray(module.startUrls) &&
      typeof module.run === 'function'
    );
  }

  getModule(key: string): ScraperModule | undefined {
    return this.modules.get(key);
  }

  getAllModules(): ScraperModule[] {
    return Array.from(this.modules.values());
  }

  getModuleKeys(): string[] {
    return Array.from(this.modules.keys());
  }

  hasModule(key: string): boolean {
    return this.modules.has(key);
  }

  async reloadModule(key: string): Promise<void> {
    // For development: clear require cache and reload
    const modulePath = join(this.modulesDir, key, 'index.js');
    
    // Remove from our cache
    this.modules.delete(key);
    
    // Reload the module
    await this.loadModule(key);
  }
}
