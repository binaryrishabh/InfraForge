function requireRun(run, sha, repository) {
  if (run.head_sha !== sha || run.head_branch !== 'main' || run.event !== 'push' ||
      run.path !== '.github/workflows/validate.yml' || run.status !== 'completed' ||
      run.conclusion !== 'success' || run.head_repository?.full_name !== repository) {
    throw new Error('Only successful exact-SHA main push validation can release');
  }
}
function requireEnvironment(environment, policies) {
  const reviewers = environment.protection_rules.find(rule => rule.type === 'required_reviewers');
  if (environment.can_admins_bypass !== false || !reviewers?.reviewers?.length ||
      environment.deployment_branch_policy?.custom_branch_policies !== true ||
      policies.length !== 1 || policies[0].name !== 'main' || policies[0].type !== 'branch') {
    throw new Error('Production requires an owner approval, no admin bypass, and main-only deployment');
  }
}
async function admitRelease(github, context, requestedSha) {
  if (!['workflow_run', 'workflow_dispatch'].includes(context.eventName)) throw new Error('Unsupported release trigger');
  const repo = context.repo;
  const sha = (await github.rest.repos.getCommit({ ...repo, ref: 'main' })).data.sha;
  if (!/^[a-f0-9]{40}$/.test(sha) || (context.eventName === 'workflow_dispatch' &&
      (context.ref !== 'refs/heads/main' || requestedSha !== sha))) throw new Error('Release must be current main');
  let run;
  if (context.eventName === 'workflow_run') {
    run = (await github.rest.actions.getWorkflowRun({ ...repo, run_id: context.payload.workflow_run.id })).data;
  } else {
    const runs = (await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: 'validate.yml',
      branch: 'main', head_sha: sha, event: 'push', per_page: 100 })).data.workflow_runs;
    run = runs[0];
  }
  if (!run) throw new Error('No exact-SHA push CI exists; manual release never bypasses validation');
  requireRun(run, sha, `${repo.owner}/${repo.repo}`);
  const environment = (await github.rest.repos.getEnvironment({ ...repo, environment_name: 'Production' })).data;
  const policies = (await github.rest.repos.listDeploymentBranchPolicies({ ...repo, environment_name: 'Production' })).data.branch_policies;
  requireEnvironment(environment, policies);
  return sha;
}
module.exports = { admitRelease, requireRun, requireEnvironment };
