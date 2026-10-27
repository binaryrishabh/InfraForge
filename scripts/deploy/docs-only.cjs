const { execFileSync } = require('node:child_process');

function docsOnlyPaths(paths) {
  // Proof artifacts under docs/reality are runtime inputs, not prose.
  return paths.length > 0 && paths.every(path => !path.startsWith('docs/reality/') &&
    (path.startsWith('docs/') || path.endsWith('.md') || path.startsWith('.agent/')));
}
// Release reuse compares the entire range from the accepted/running commit.
function docsOnlyChange(base, head, cwd = process.cwd()) {
  if (![base, head].every(sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha))) return false;
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['merge-base', '--is-ancestor', base, head]);
    return docsOnlyPaths(git(['diff', '--name-only', '--no-renames', '-z', base, head, '--']).split('\0').filter(Boolean));
  } catch { return false; } // Missing history or an unrelated release requires a build.
}
module.exports = { docsOnlyPaths, docsOnlyChange };
