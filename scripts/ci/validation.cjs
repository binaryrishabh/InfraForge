const { execFileSync } = require('node:child_process');
const { appendFileSync, readFileSync } = require('node:fs');
const jobs = ['checks', 'integration', 'm2m-preview', 'packaging', 'operations'];

function docsOnlyPaths(paths) {
  // Proof artifacts under docs/reality are runtime inputs, not prose.
  return paths.length > 0 && paths.every(path => !path.startsWith('docs/reality/') &&
    (path.startsWith('docs/') || path.endsWith('.md') || path.startsWith('.agent/')));
}
function docsOnlyChange(base, head, cwd = process.cwd()) {
  if (![base, head].every(sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha))) return false;
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['merge-base', '--is-ancestor', base, head]);
    return docsOnlyPaths(git(['diff', '--name-only', '--no-renames', '-z', base, head, '--']).split('\0').filter(Boolean));
  } catch { return false; } // Missing history or an unrelated release requires full validation/build.
}
function requireFullValidation(results) {
  const expected = ['changes', ...jobs];
  const docsOnly = results.changes?.outputs?.docs_only === 'true';
  if (JSON.stringify(Object.keys(results).sort()) !== JSON.stringify(expected.sort()) ||
      results.changes?.result !== 'success' ||
      !['true', 'false'].includes(results.changes?.outputs?.docs_only) ||
      jobs.some(job => results[job]?.result !== (docsOnly ? 'skipped' : 'success'))) {
    throw new Error('Validation requires successful identity checks and every required job; unexpected skipped/cancelled jobs are not green');
  }
}
if (require.main === module) {
  if (process.argv.includes('--changes')) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const docsOnly = process.env.GITHUB_EVENT_NAME === 'push' && head === process.env.GITHUB_SHA && docsOnlyChange(event.before, head);
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`);
  } else requireFullValidation(JSON.parse(process.env.VALIDATION_RESULTS || '{}'));
}
module.exports = { requireFullValidation, docsOnlyPaths, docsOnlyChange };
