const jobs = ['identity', 'checks', 'integration', 'm2m-preview', 'packaging', 'operations'];

function requireFullValidation(results) {
  if (JSON.stringify(Object.keys(results).sort()) !== JSON.stringify([...jobs].sort()) ||
      jobs.some(job => results[job]?.result !== 'success')) {
    throw new Error('Validation requires successful identity checks and every required job; unexpected skipped/cancelled jobs are not green');
  }
}
if (require.main === module) requireFullValidation(JSON.parse(process.env.VALIDATION_RESULTS || '{}'));
module.exports = { requireFullValidation };
