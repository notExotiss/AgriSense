const childProcess = require('child_process')
const net = require('net')

function safeExec(command) {
  try {
    return childProcess.execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function parsePortOwner(pid) {
  if (!Number.isFinite(pid)) return null
  if (process.platform === 'win32') {
    const output = safeExec(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pid}\\" | Select-Object -ExpandProperty CommandLine"`
    )
    return output || null
  }
  const output = safeExec(`ps -p ${pid} -o command=`)
  return output || null
}

function findPortOwner(port) {
  if (process.platform === 'win32') {
    const output = safeExec(`netstat -ano -p tcp | findstr :${port}`)
    const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
    for (const line of lines) {
      if (!line.includes('LISTENING')) continue
      const parts = line.split(/\s+/)
      const pid = Number(parts[parts.length - 1])
      if (Number.isFinite(pid)) {
        return {
          pid,
          command: parsePortOwner(pid),
        }
      }
    }
    return null
  }

  const lsof = safeExec(`lsof -i TCP:${port} -sTCP:LISTEN -n -P`)
  const rows = lsof.split('\n').slice(1).map((line) => line.trim()).filter(Boolean)
  if (!rows.length) return null
  const first = rows[0].split(/\s+/)
  const pid = Number(first[1])
  return {
    pid: Number.isFinite(pid) ? pid : null,
    command: Number.isFinite(pid) ? parsePortOwner(pid) : null,
  }
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        resolve(false)
      }
    })
    server.once('listening', () => {
      server.close(() => resolve(false))
    })
    server.listen(port, '0.0.0.0')
  })
}

async function main() {
  const port = 3000
  const owner = findPortOwner(port)
  const inUse = owner ? true : await isPortInUse(port)
  if (!inUse) {
    process.exit(0)
    return
  }

  console.error(`[dev-guard] Port ${port} is already in use.`)
  if (owner?.pid) {
    console.error(`[dev-guard] PID: ${owner.pid}`)
  }
  if (owner?.command) {
    console.error(`[dev-guard] Command: ${owner.command.slice(0, 260)}`)
  }
  console.error('[dev-guard] Stop the stale process and rerun `npm run dev`.')
  if (owner?.pid && process.platform === 'win32') {
    console.error(`[dev-guard] Suggested command: Stop-Process -Id ${owner.pid} -Force`)
  }
  process.exit(1)
}

void main()
