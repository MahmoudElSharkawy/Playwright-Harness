import {adoId, adoGuid, requireValue} from './config.mjs';

function branch(value) {
  requireValue(typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(value) && !value.includes('..') && !value.includes('//') && !value.endsWith('/') && !value.endsWith('.lock'), 'Invalid branch name.');
  return `refs/heads/${value}`;
}
/** Source control is independent of test retrieval, verdicts and work-item updates. */
export function createAdoSourceControl(client) {
  return Object.freeze({async createPullRequest({repository = client.configuration.repository, source, target, title, description, draft = false, execute = false}) {
    requireValue(typeof repository === 'string' && /^[^/\\?#%\x00-\x1f]{1,150}$/.test(repository) && !['.', '..'].includes(repository), 'Configure the ADO repository or pass --repository explicitly.');
    requireValue(typeof title === 'string' && title.trim() && title.length <= 400 && typeof description === 'string' && description.trim() && description.length <= 4000, 'PR title/description are required and must fit their bounds.');
    requireValue(typeof draft === 'boolean', 'Draft must be boolean.');
    const repo = await client.read(`git/repositories/${encodeURIComponent(repository)}?api-version=7.1`);
    requireValue(adoGuid(repo.id) && typeof repo.name === 'string', 'Repository response has no valid identity.');
    requireValue(repo.id.toLowerCase() === repository.toLowerCase() || repo.name.toLowerCase() === repository.toLowerCase(), 'Repository identity does not match configuration.');
    const project = await client.projectIdentity();
    requireValue(typeof repo.project?.id === 'string' && repo.project.id.toLowerCase() === project.id.toLowerCase(), 'Repository belongs to another configured project.');
    const sourceRefName = branch(source), targetRefName = target ? branch(target) : repo.defaultBranch;
    requireValue(typeof targetRefName === 'string' && targetRefName.startsWith('refs/heads/'), 'Repository has no default branch; pass --target.'); branch(targetRefName.slice(11));
    requireValue(sourceRefName !== targetRefName && sourceRefName !== repo.defaultBranch && !['main', 'master'].includes(source), 'PR source must be a non-default feature branch distinct from its target.');
    for (const name of [sourceRefName, targetRefName]) {
      const refs = await client.list(`git/repositories/${repo.id}/refs?filter=${encodeURIComponent(name.slice(5))}&api-version=7.1`);
      requireValue(refs.filter(ref => ref.name === name).length === 1, 'Source and target branches must already exist in the configured repository.');
    }
    const body = {sourceRefName, targetRefName, title, description, isDraft: draft};
    if (!execute) return {mode: 'dry-run', repositoryId: repo.id, source, target: targetRefName.slice(11), draft};
    const delivery = client.delivery('pull-request', execute);
    delivery.identified({repositoryId: repo.id});
    try {
      const pr = await delivery.write('create-pull-request', `git/repositories/${repo.id}/pullrequests?api-version=7.1`, body, {method: 'POST'});
      const id = adoId(pr.pullRequestId);
      delivery.identified({pullRequestId: id});
      const after = await client.read(`git/repositories/${repo.id}/pullrequests/${id}?api-version=7.1`);
      requireValue(adoId(after.pullRequestId) === id && after.repository?.id === repo.id && Object.entries(body).every(([key, value]) => after[key] === value), 'PR readback mismatch.');
      delivery.verified({pullRequestId: id});
      return {...delivery.finish(), id, url: `${client.configuration.organizationUrl}/${encodeURIComponent(client.configuration.project)}/_git/${encodeURIComponent(repo.name)}/pullrequest/${id}`};
    } catch { throw delivery.incomplete(); }
  }});
}
