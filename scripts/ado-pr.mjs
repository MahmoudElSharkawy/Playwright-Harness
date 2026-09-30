#!/usr/bin/env node
/**
 * ado-pr.mjs — create an Azure DevOps pull request for this repo via REST + PAT.
 *
 * Usage:
 *   node scripts/ado-pr.mjs --title "..." (--description "..." | --description-file <path>)
 *                           [--source <branch>] [--target master] [--repository <name>] [--draft] [--dry-run] [--json]
 *
 * Defaults: source = current git branch, target = master; repository from an ADO origin or explicit --repository.
 * Guards: refuses source==target and refuses to open a PR FROM master/main
 * (repo rule: all changes ride a purposefully-named feature branch).
 * Requires the branch to be PUSHED first; PAT needs "Code: Read & Write".
 * Exit codes: 0 ok · 1 usage/guard · 2 auth/scope · 3 branch not on remote · 4 API error.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import {projectArgument,consumerPath} from './lib/consumer-paths.mjs';
let ROOT, roots;

function fail(code, msg) {
  console.error(`[ado-pr] ERROR: ${msg}`);
  process.exit(code);
}
function loadDotEnv() {
  const p = consumerPath(roots,'.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(consumerPath(roots,p), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

let AUTH = '';
async function ado(url, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    fail(4, `network error — ${e.message}`);
  }
  if (res.status === 401 || res.status === 403 || res.status === 203) {
    fail(2, `HTTP ${res.status} — PAT rejected or missing "Code: Read & Write" scope (needed to create PRs).`);
  }
  return res;
}

async function main() {

  const parsed=projectArgument();
  roots=parsed.roots;ROOT=roots.projectRoot;
  const args=parsed.args;
  const opt = (n) => {
    const i = args.indexOf(n);
    if (i < 0) return undefined;
    const v = args[i + 1];
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const has = (n) => args.includes(n);

  loadDotEnv();
  const cfg = JSON.parse(readFileSync(consumerPath(roots,'config/project.json'), 'utf8'));
  const az = cfg.azure || {};
  const pat = process.env.AZURE_DEVOPS_EXT_PAT || process.env.AZURE_PAT;
  if (!az.org || !az.project) fail(1, 'azure.org/project missing in config/project.json');
  if (!pat) fail(1, 'no PAT — set AZURE_PAT in .env');
  AUTH = 'Basic ' + Buffer.from(':' + pat).toString('base64');
  const base = `https://dev.azure.com/${az.org}/${encodeURIComponent(az.project)}/_apis`;

  const title = opt('--title');
  const descFile = opt('--description-file');
  if (descFile && !existsSync(consumerPath(roots,descFile))) fail(1, `description file not found: ${descFile} (resolved against the repo root)`);
  const description = opt('--description') ||
    (descFile ? readFileSync(consumerPath(roots,descFile), 'utf8') : undefined);
  if (!title || !description) fail(1, 'usage: node scripts/ado-pr.mjs --title "..." (--description "..." | --description-file <path>)');

  let source = opt('--source');
  if (!source) {
    try { source = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8' }).trim(); }
    catch { fail(1, 'could not resolve the current branch — pass --source <branch>.'); }
  }
  const target = opt('--target') || 'master';
  if (source === target) fail(1, `source and target are both "${source}".`);
  if (source === 'master' || source === 'main') {
    fail(1, 'refusing to open a PR FROM master/main — repo rule: work happens on a purposefully-named feature branch.');
  }

  // resolve this repo's id by matching the git remote name
  let repoName = opt('--repository');
  try {
    const remote = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
    const m = remote.match(/_git\/([^/?#]+?)(?:\.git)?$/);
    if (!repoName && m) repoName = decodeURIComponent(m[1]);
  } catch { /* explicit --repository may still identify the configured repository */ }
  if (!repoName) fail(1, 'cannot identify the ADO repository: configure a recognized origin remote or pass --repository <name>.');
  const reposRes = await ado(`${base}/git/repositories?api-version=7.1`);
  if (!reposRes.ok) fail(4, `could not list repositories: HTTP ${reposRes.status}`);
  const repo = (await reposRes.json()).value.find((r) => r.name.toLowerCase() === repoName.toLowerCase());
  if (!repo) fail(4, `repository "${repoName}" not found in project "${az.project}".`);

  // the branch must exist on the remote — a clear message beats ADO's generic 400
  const refRes = await ado(`${base}/git/repositories/${repo.id}/refs?filter=heads/${encodeURIComponent(source)}&api-version=7.1`);
  const refs = refRes.ok ? (await refRes.json()).value || [] : [];
  if (!refs.some((r) => r.name === `refs/heads/${source}`)) {
    fail(3, `branch "${source}" is not on the remote — push it first: git push -u origin ${source}`);
  }

  if (has('--dry-run')) {
    console.log(`[dry-run] would create PR: ${source} -> ${target} in ${repo.name}\n  title: ${title}\n  draft: ${has('--draft')}`);
    return;
  }

  const prRes = await ado(`${base}/git/repositories/${repo.id}/pullrequests?api-version=7.1`, {
    method: 'POST',
    body: {
      sourceRefName: `refs/heads/${source}`,
      targetRefName: `refs/heads/${target}`,
      title,
      description: description.slice(0, 4000),
      isDraft: has('--draft'),
    },
  });
  if (!prRes.ok) {
    const text = (await prRes.text()).slice(0, 400);
    if (/active pull request.*already exists|TF401179/i.test(text)) fail(1, `a PR from "${source}" to "${target}" already exists.`);
    fail(4, `PR creation failed HTTP ${prRes.status}: ${text}`);
  }
  const pr = await prRes.json();
  const webUrl = `https://dev.azure.com/${az.org}/${encodeURIComponent(az.project)}/_git/${encodeURIComponent(repo.name)}/pullrequest/${pr.pullRequestId}`;
  if (has('--json')) return console.log(JSON.stringify({ id: pr.pullRequestId, url: webUrl, source, target }, null, 2));
  console.log(`PR !${pr.pullRequestId} created: ${source} -> ${target}\n${webUrl}`);
}

main().catch((e) => fail(4, e.stack || String(e)));
