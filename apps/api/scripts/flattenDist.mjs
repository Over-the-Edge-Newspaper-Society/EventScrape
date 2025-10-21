import fs from 'node:fs'
import path from 'node:path'

const distRoot = path.resolve(process.cwd(), 'dist')
const nestedSrc = path.join(distRoot, 'apps', 'api', 'src')

if (!fs.existsSync(nestedSrc)) {
  process.exit(0)
}

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
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

copyRecursive(nestedSrc, distRoot)
