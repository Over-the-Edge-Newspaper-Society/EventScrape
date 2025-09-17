import { cp, mkdir, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const sourceDir = join(projectRoot, 'src', 'db', 'migrations')
const destinationDir = join(projectRoot, 'dist', 'db', 'migrations')

async function ensureSourceExists() {
  try {
    const info = await stat(sourceDir)
    if (!info.isDirectory()) {
      throw new Error('Source path is not a directory')
    }
  } catch (error) {
    throw new Error(`Missing migrations directory at ${sourceDir}`)
  }
}

async function main() {
  await ensureSourceExists()
  await mkdir(destinationDir, { recursive: true })
  await cp(sourceDir, destinationDir, { recursive: true })
  console.log(`Copied migrations to ${destinationDir}`)
}

main().catch((error) => {
  console.error('Failed to copy migrations:', error)
  process.exit(1)
})
