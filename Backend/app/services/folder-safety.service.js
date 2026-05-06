import fs from 'fs'

// Names/patterns we expect to see next to a properly-placed VOOTED app folder.
// Anything outside this list counts as a "neighbor" — i.e. an unrelated file
// that suggests the user dropped the EXE into a shared folder (Downloads,
// Desktop, etc.) instead of a dedicated VOOTED folder.
const VOOTED_KNOWN_PATTERNS = [
  // Built binaries (any platform / version suffix)
  /^VOOTED.*\.exe$/i,
  /^VOOTED-(linux|win|macos)/i,
  /^VOOTED$/i,
  // Convenience launchers + readmes shipped alongside the binary
  /^run\.bat$/i,
  /^run\.sh$/i,
  /^README(\.md|\.txt)?$/i,
  /^LICENSE(\.md|\.txt)?$/i,
  // Files VOOTED itself creates after first run
  /^vooted\.runtime\.json$/i,
  /^config\.json$/i,
  /^config\.example\.json$/i,
  /^data$/i,
  /^logs$/i,
  /^Youtube_VOD$/i,
]

// Dev-mode source tree (when running `npm start` from Backend/, the appDir
// resolves to that folder). Adding these stops the check from screaming on
// developer machines while keeping the safety net for shipped EXEs.
const DEV_SOURCE_PATTERNS = [
  /^app$/i,
  /^database$/i,
  /^lib$/i,
  /^public$/i,
  /^node_modules$/i,
  /^dist-server$/i,
  /^server\.js$/i,
  /^build(-multi-platform)?\.cjs$/i,
  /^package(-lock)?\.json$/i,
  /^\.history$/i,
  /^\.gitignore$/i,
  /^\.vscode$/i,
  /^\.idea$/i,
]

// Cap how many neighbor names we ship to the UI — a Downloads folder can
// have hundreds of entries and the user doesn't need to read all of them
// to get the message.
const MAX_NEIGHBORS_RETURNED = 12

// Returns `{ safe, neighbors[], totalCount }`.
//
// `safe` is true when the folder looks dedicated to VOOTED (no neighbors).
// `neighbors` is up to MAX_NEIGHBORS_RETURNED entry names (sorted, dirs
// suffixed with '/'). `totalCount` is the un-capped count so the UI can
// say "and 47 more" when needed.
//
// Always non-throwing: if the folder can't be read for any reason we treat
// the check as inconclusive (`safe: true, neighbors: []`) rather than
// blocking setup on a permissions glitch.
export function checkFolderSafety(appDir) {
  if (!appDir || typeof appDir !== 'string') {
    return { safe: true, neighbors: [], totalCount: 0 }
  }

  let entries
  try {
    entries = fs.readdirSync(appDir, { withFileTypes: true })
  } catch {
    return { safe: true, neighbors: [], totalCount: 0 }
  }

  const allowed = isPackaged() ? VOOTED_KNOWN_PATTERNS : [...VOOTED_KNOWN_PATTERNS, ...DEV_SOURCE_PATTERNS]

  const neighborNames = []
  for (const entry of entries) {
    const name = entry.name
    // Skip dotfiles like .DS_Store, Thumbs.db — irrelevant noise.
    if (name === '.DS_Store' || name === 'Thumbs.db') continue
    if (allowed.some((rx) => rx.test(name))) continue
    neighborNames.push(entry.isDirectory() ? `${name}/` : name)
  }

  neighborNames.sort((a, b) => a.localeCompare(b))

  return {
    safe: neighborNames.length === 0,
    neighbors: neighborNames.slice(0, MAX_NEIGHBORS_RETURNED),
    totalCount: neighborNames.length,
  }
}

function isPackaged() {
  // pkg / @yao-pkg/pkg sets process.pkg when running inside the snapshot.
  return Boolean(process.pkg)
}
