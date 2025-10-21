import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workerModulesSource = path.resolve(__dirname, '../../../worker/dist/modules')
const workerModulesDest = path.resolve(__dirname, '../dist/worker/src/modules')

// Check if source exists
if (!fs.existsSync(workerModulesSource)) {
  console.log('⚠️  Worker modules not found. Please build the worker first: pnpm --filter @eventscrape/worker build')
  process.exit(0)
}

// Create destination directory
fs.mkdirSync(workerModulesDest, { recursive: true })

// Copy recursively
const copyRecursive = (src, dest) => {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true })
      }
      copyRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

copyRecursive(workerModulesSource, workerModulesDest)
console.log('✓ Worker modules copied to API dist')
