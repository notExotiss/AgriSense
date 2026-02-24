const fs = require('fs')
const path = require('path')

const rootDir = process.cwd()
const sourceDir = path.join(rootDir, '.next')
const targetDir = path.join(rootDir, 'functions', '.next')

if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`)
  process.exit(1)
}

fs.mkdirSync(path.dirname(targetDir), { recursive: true })
fs.rmSync(targetDir, { recursive: true, force: true })
fs.cpSync(sourceDir, targetDir, { recursive: true })

console.log(`Copied ${sourceDir} -> ${targetDir}`)
