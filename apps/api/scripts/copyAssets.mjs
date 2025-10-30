import { cp, mkdir, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const sourceDir = join(projectRoot, 'src', 'assets')
const destinationDir = join(projectRoot, 'dist', 'assets')

async function ensureSourceExists() {
  try {
    const info = await stat(sourceDir)
    if (!info.isDirectory()) {
      throw new Error('Source path is not a directory')
    }
  } catch (error) {
    throw new Error(`Missing assets directory at ${sourceDir}`)
  }
}

async function main() {
  await ensureSourceExists()
  await mkdir(destinationDir, { recursive: true })
  await cp(sourceDir, destinationDir, { recursive: true })
  console.log(`Copied assets to ${destinationDir}`)
}

main().catch((error) => {
  console.error('Failed to copy assets:', error)
  process.exit(1)
})
