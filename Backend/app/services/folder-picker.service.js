import { spawn } from 'child_process'
import { platform } from 'os'

// Open the OS-native folder picker dialog.
//
// Returns the selected absolute path string, or `null` if the user canceled.
// Throws on infrastructure failure (no picker tool available, dialog crashed).
//
// Platform notes:
//   - Windows: PowerShell + System.Windows.Forms.FolderBrowserDialog. Script
//     is passed as base64 (-EncodedCommand) so we don't fight quote escaping.
//   - macOS: osascript "choose folder".
//   - Linux: zenity preferred (most distros ship it), kdialog as fallback for
//     KDE-only systems. Both are common; if neither is present we surface a
//     clear error so the frontend can fall back to the manual text input.
export async function pickFolder({ title = 'Select folder', initialDir = '' } = {}) {
  const os = platform()
  if (os === 'win32') return pickFolderWindows(title, initialDir)
  if (os === 'darwin') return pickFolderMac(title)
  return pickFolderLinux(title, initialDir)
}

function pickFolderWindows(title, initialDir) {
  const safeTitle = String(title).replace(/'/g, "''")
  const safeInitial = String(initialDir || '').replace(/'/g, "''")
  const initLine = safeInitial ? `try { $dialog.SelectedPath = '${safeInitial}' } catch {}` : ''

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${safeTitle}'
$dialog.UseDescriptionForTitle = $true
$dialog.ShowNewFolderButton = $true
${initLine}
$owner = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false; Opacity=0; StartPosition='CenterScreen'}
try {
  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
  }
} finally {
  $owner.Dispose()
}
`.trim()

  // PowerShell -EncodedCommand expects UTF-16 LE base64.
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64')

  return runProc(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded],
    { windowsHide: true },
  )
}

function pickFolderMac(title) {
  const safeTitle = String(title).replace(/"/g, '\\"')
  const script =
    `try
  set chosen to choose folder with prompt "${safeTitle}"
  POSIX path of chosen
on error number -128
  return ""
end try`

  return runProc('osascript', ['-e', script])
}

async function pickFolderLinux(title, initialDir) {
  try {
    return await tryZenity(title, initialDir)
  } catch (zenityErr) {
    try {
      return await tryKdialog(title, initialDir)
    } catch {
      throw new Error(
        zenityErr?.code === 'ENOENT'
          ? 'No folder picker available on this system. Install zenity or kdialog, or type the path manually.'
          : zenityErr?.message || 'Folder picker failed.',
      )
    }
  }
}

function tryZenity(title, initialDir) {
  const args = ['--file-selection', '--directory', `--title=${title}`]
  if (initialDir) args.push(`--filename=${initialDir.replace(/\/$/, '')}/`)
  return runProc('zenity', args, { cancelExitCode: 1 })
}

function tryKdialog(title, initialDir) {
  const args = ['--getexistingdirectory', initialDir || '.']
  if (title) args.push('--title', title)
  // kdialog returns 1 on cancel.
  return runProc('kdialog', args, { cancelExitCode: 1 })
}

// Spawn a one-shot picker, capture stdout, treat empty output as "user
// canceled". `cancelExitCode` covers tools (zenity/kdialog) that exit
// non-zero on cancel rather than printing nothing.
function runProc(cmd, args, { windowsHide = false, cancelExitCode = null } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) {
        const trimmed = stdout.trim().replace(/\/$/, '')
        resolve(trimmed || null)
        return
      }
      if (cancelExitCode !== null && code === cancelExitCode) {
        resolve(null)
        return
      }
      reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`))
    })
  })
}
