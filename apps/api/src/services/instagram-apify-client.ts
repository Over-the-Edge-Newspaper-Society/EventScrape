import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type EnhancedApifyClientModule = typeof import('../../../../worker/src/modules/instagram/enhanced-apify-client.js')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let enhancedClientModulePromise: Promise<EnhancedApifyClientModule> | null = null

async function resolveEnhancedApifyClientModule(): Promise<EnhancedApifyClientModule> {
  const candidatePaths = [
    path.resolve(__dirname, '../worker/src/modules/instagram/enhanced-apify-client.js'),
    path.resolve(__dirname, '../worker/dist/modules/instagram/enhanced-apify-client.js'),
    path.resolve(__dirname, '../../../../worker/dist/modules/instagram/enhanced-apify-client.js'),
    path.resolve(__dirname, '../../../../worker/src/modules/instagram/enhanced-apify-client.js'),
    path.resolve(process.cwd(), 'worker/dist/modules/instagram/enhanced-apify-client.js'),
    path.resolve(process.cwd(), 'worker/src/modules/instagram/enhanced-apify-client.js'),
  ]

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return import(pathToFileURL(candidate).href) as Promise<EnhancedApifyClientModule>
    }
  }

  throw new Error(
    'Enhanced Apify client module not found. Build the worker package or ensure worker modules are copied into the API dist.'
  )
}

export async function loadEnhancedApifyClientModule(): Promise<EnhancedApifyClientModule> {
  if (!enhancedClientModulePromise) {
    enhancedClientModulePromise = resolveEnhancedApifyClientModule()
  }
  return enhancedClientModulePromise
}

export async function createEnhancedApifyClient(apiToken: string, actorId?: string) {
  const module = await loadEnhancedApifyClientModule()
  return module.createEnhancedApifyClient(apiToken, actorId)
}
