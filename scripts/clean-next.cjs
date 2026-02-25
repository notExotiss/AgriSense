const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

const args = new Set(process.argv.slice(2))
const force = args.has('--force')
const guarded = args.has('--guarded') || !force

const root = process.cwd()
const targets = [path.join(root, '.next-dev'), path.join(root, '.next'), path.join(root, 'functions', '.next')]

function safeExec(command) {
  try {
    return childProcess.execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function parseJsonValue(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
    return []
  } catch {
    return []
  }
}

function detectRepoNextProcesses() {
  if (process.platform === 'win32') {
    const cwdEscaped = root.replace(/'/g, "''")
    const psScript = `$cwd='${cwdEscaped}'; $list = Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'node*' -and $_.CommandLine -match 'next' -and $_.CommandLine -match [regex]::Escape($cwd) } | Select-Object ProcessId,CommandLine; $list | ConvertTo-Json -Compress`
    const output = safeExec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`)
    return parseJsonValue(output)
      .map((entry) => ({
        pid: Number(entry.ProcessId),
        command: String(entry.CommandLine || ''),
      }))
      .filter((entry) => Number.isFinite(entry.pid))
  }

  const output = safeExec('ps -ax -o pid=,command=')
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(' ')
      const pid = Number(firstSpace === -1 ? line : line.slice(0, firstSpace))
      const command = firstSpace === -1 ? '' : line.slice(firstSpace + 1)
      return { pid, command }
    })
    .filter((entry) => Number.isFinite(entry.pid))
    .filter((entry) => entry.command.includes('next') && entry.command.includes(root))
}

if (guarded) {
  const running = detectRepoNextProcesses()
  if (running.length) {
    console.warn('[clean-next] Skipped cleanup because a Next.js process for this repo is running.')
    running.forEach((entry) => {
      console.warn(`[clean-next] PID ${entry.pid}: ${entry.command.slice(0, 220)}`)
    })
    console.warn('[clean-next] Stop stale dev/start servers first, or run `npm run clean:next -- --force` when safe.')
    process.exit(0)
  }
}

for (const target of targets) {
  try {
    fs.rmSync(target, { recursive: true, force: true })
    console.log(`[clean-next] Removed ${target}`)
  } catch (error) {
    console.warn(`[clean-next] Failed to remove ${target}:`, error?.message || error)
  }
}
