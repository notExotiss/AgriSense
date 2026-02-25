const childProcess = require('child_process')

function safeExec(command) {
  try {
    return childProcess.execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function printHeader(title) {
  console.log(`\n=== ${title} ===`)
}

function printPort3000() {
  printHeader('Port 3000')
  if (process.platform === 'win32') {
    const output = safeExec('netstat -ano -p tcp | findstr :3000')
    console.log(output || 'No listener detected on TCP 3000.')
    return
  }
  const output = safeExec('lsof -i TCP:3000 -sTCP:LISTEN -n -P')
  console.log(output || 'No listener detected on TCP 3000.')
}

function printNextProcesses() {
  printHeader('Next Processes')
  if (process.platform === 'win32') {
    const output = safeExec(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like \'node*\' -and $_.CommandLine -match \'next\' } | Select-Object ProcessId,CommandLine | Format-Table -AutoSize | Out-String -Width 220"'
    )
    console.log(output || 'No Next.js node processes found.')
    return
  }
  const output = safeExec("ps -ax -o pid=,command= | grep next | grep -v grep")
  console.log(output || 'No Next.js processes found.')
}

printPort3000()
printNextProcesses()
