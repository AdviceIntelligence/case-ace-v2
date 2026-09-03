import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();

function getAllFiles(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT_DIR, fullPath);

    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.DS_Store') {
      continue;
    }

    if (entry.isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else {
      fileList.push(relPath);
    }
  }
  return fileList;
}

console.log('Discovering files for initial git commit...');
const allFiles = getAllFiles(ROOT_DIR);
console.log(`Found ${allFiles.length} files to track.`);

// Remove stale locks
const lockPath = path.join(ROOT_DIR, '.git', 'index.lock');
if (fs.existsSync(lockPath)) {
  fs.unlinkSync(lockPath);
}

// Stage in batches
const CHUNK_SIZE = 15;
for (let i = 0; i < allFiles.length; i += CHUNK_SIZE) {
  const chunk = allFiles.slice(i, i + CHUNK_SIZE);
  const quoted = chunk.map(f => `"${f}"`).join(' ');
  try {
    execSync(`git add ${quoted}`, { stdio: 'inherit' });
    console.log(`Staged ${Math.min(i + CHUNK_SIZE, allFiles.length)} / ${allFiles.length} files`);
  } catch (err) {
    console.error(`Error staging chunk ${i}:`, err.message);
  }
}

console.log('Setting git committer identity if not set...');
try {
  execSync('git config user.name "Advice Intelligence Tech"', { stdio: 'inherit' });
  execSync('git config user.email "admin@adviceintelligence.tech"', { stdio: 'inherit' });
} catch (e) {}

console.log('Creating initial git commit...');
try {
  execSync('git commit -m "feat: Case Ace v2.0 - Privacy-preserving AI case-noting system with complete documentation and custom domain architecture"', { stdio: 'inherit' });
  console.log('Initial commit created successfully!');
} catch (err) {
  console.log('Commit result:', err.message);
}
