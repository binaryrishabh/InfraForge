const jobs = ['checks', 'integration', 'packaging', 'operations'];

function requireFullValidation(results) {
  if (JSON.stringify(Object.keys(results).sort()) !== JSON.stringify([...jobs].sort()) ||
      jobs.some(job => results[job]?.result !== 'success')) {
    throw new Error('Validation requires every required job; unexpected skipped/cancelled jobs are not green');
  }
}
if (require.main === module) requireFullValidation(JSON.parse(process.env.VALIDATION_RESULTS || '{}'));
module.exports = { requireFullValidation };
