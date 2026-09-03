import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const clientSrcDir = path.join(rootDir, 'src');
const clientIndexHtml = path.join(rootDir, 'index.html');

console.log('[StorageGuard Linter] Scanning client source code for prohibited persistent storage APIs (Constraint C1)...');

// Allowlisted files that define the security guard or are documentation
const ALLOWLIST = new Set([
  path.normalize(path.join(clientSrcDir, 'security/storageGuard.ts')),
]);

const PROHIBITED_PATTERNS = [
  { pattern: /\blocalStorage\b/, name: 'localStorage' },
  { pattern: /\bsessionStorage\b/, name: 'sessionStorage' },
  { pattern: /\bindexedDB\b/, name: 'indexedDB' },
  { pattern: /document\.cookie/, name: 'document.cookie' },
  { pattern: /\bwindow\.caches\b/, name: 'window.caches' },
  { pattern: /\bcaches\.(open|match|has|delete|keys)\b/, name: 'caches (Cache API)' },
  { pattern: /\bshowSaveFilePicker\b/, name: 'showSaveFilePicker' },
  { pattern: /\bshowOpenFilePicker\b/, name: 'showOpenFilePicker' },
  { pattern: /\bFileSystemFileHandle\b/, name: 'FileSystemFileHandle' },
  { pattern: /\bFileSystemDirectoryHandle\b/, name: 'FileSystemDirectoryHandle' },
];

function getAllFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist') {
        getAllFiles(fullPath, fileList);
      }
    } else if (/\.(ts|tsx|js|jsx|html)$/.test(file)) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

export function runStorageLinter() {
  const filesToScan = getAllFiles(clientSrcDir);
  if (fs.existsSync(clientIndexHtml)) {
    filesToScan.push(clientIndexHtml);
  }

  const violations = [];

  for (const filePath of filesToScan) {
    const normalized = path.normalize(filePath);
    if (ALLOWLIST.has(normalized)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, lineIndex) => {
      // Ignore comment lines
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return;
      }

      for (const { pattern, name } of PROHIBITED_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            filePath: path.relative(rootDir, filePath),
            lineNumber: lineIndex + 1,
            apiName: name,
            lineContent: line.trim(),
          });
        }
      }
    });
  }

  return violations;
}

// If run directly via CLI
if (process.argv[1] && process.argv[1].endsWith('lint-storage-guard.mjs')) {
  const violations = runStorageLinter();

  if (violations.length > 0) {
    console.error('\n❌ BUILD FAILED: Prohibited Persistent Storage API References Found (Constraint C1):');
    violations.forEach((v) => {
      console.error(`  - ${v.filePath}:${v.lineNumber} -> Uses prohibited '${v.apiName}': "${v.lineContent}"`);
    });
    console.error('\nAll session data must reside solely in volatile RAM. Storage APIs are barred.\n');
    process.exit(1);
  } else {
    console.log('✅ StorageGuard Linter Passed: 0 prohibited storage references found across client bundle.\n');
  }
}
