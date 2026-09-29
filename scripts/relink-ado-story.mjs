#!/usr/bin/env node
/**
 * relink-ado-story.mjs — swap a work item's link to a story from Parent/Child
 * (System.LinkTypes.Hierarchy-Reverse) to Related (System.LinkTypes.Related),
 * without touching any other field or relation.
 *
 * Usage:
 *   node scripts/relink-ado-story.mjs --ids 12345,12346 --story 99999 [--execute]
 *
 * Idempotent — if the item already has a Related link to the story and no
 * Hierarchy-Reverse link, it's reported as already-correct and skipped.
 * Dry-run is the default; nothing is written without --execute.
 * Auth: AZURE_PAT / AZURE_DEVOPS_EXT_PAT from .env (never printed).
 * Exit codes: 0 ok · 1 usage/config · 2 auth · 4 API error.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function fail(code, msg) {
  console.error(`[relink-ado-story] ERROR: ${msg}`);
  process.exit(code);
}
function loadDotEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

let AUTH = '';
async function ado(url, { method = 'GET', body, contentType = 'application/json' } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: AUTH, 'Content-Type': contentType, Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    fail(4, `network error — ${e.message}`);
  }
  if (res.status === 401 || res.status === 403 || res.status === 203) {
    fail(2, `HTTP ${res.status} — PAT rejected or missing "Work Items: Read & Write" scope.`);
  }
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    if (i < 0) return undefined;
    const v = args[i + 1];
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const has = (n) => args.includes(n);

  loadDotEnv();
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'project.json'), 'utf8'));
  const az = cfg.azure || {};
  const pat = process.env.AZURE_PAT || process.env.AZURE_DEVOPS_EXT_PAT;
  if (!az.org || !az.project) fail(1, 'azure.org/project missing in config/project.json');
  if (!pat) fail(1, 'no PAT — set AZURE_PAT in .env');
  AUTH = 'Basic ' + Buffer.from(':' + pat).toString('base64');
  const base = `https://dev.azure.com/${az.org}/${encodeURIComponent(az.project)}/_apis`;

  const storyId = opt('--story');
  const idsRaw = opt('--ids') || opt('--id');
  if (!storyId || !idsRaw) {
    fail(1, 'usage: node scripts/relink-ado-story.mjs --ids <id[,id...]> --story <storyId> [--execute]');
  }
  if (!/^\d+$/.test(storyId)) fail(1, `story id must be numeric — got: ${storyId}`);
  const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.some((id) => !/^\d+$/.test(id))) fail(1, `work item ids must be numeric — got: ${idsRaw}`);
  const execute = has('--execute');

  const ledger = [];
  for (const id of ids) {
    const getRes = await ado(`${base}/wit/workitems/${id}?$expand=relations&api-version=7.1`);
    if (getRes.status === 404) {
      ledger.push({ id, ok: false, error: 'work item not found' });
      continue;
    }
    if (!getRes.ok) {
      ledger.push({ id, ok: false, error: `HTTP ${getRes.status} on read` });
      continue;
    }
    const item = await getRes.json();
    const title = item.fields['System.Title'];
    const relations = item.relations || [];
    const isStoryLink = (r) => r.url.replace(/\/$/, '').endsWith(`/${storyId}`);
    const hierIdx = relations.findIndex((r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse' && isStoryLink(r));
    const relatedIdx = relations.findIndex((r) => r.rel === 'System.LinkTypes.Related' && isStoryLink(r));
    const storyUrl = hierIdx >= 0 ? relations[hierIdx].url : relations[relatedIdx >= 0 ? relatedIdx : -1]?.url;

    if (hierIdx < 0 && relatedIdx >= 0) {
      ledger.push({ id, ok: true, title, skipped: true, reason: 'already Related, no Hierarchy link present' });
      continue;
    }
    if (hierIdx < 0 && relatedIdx < 0) {
      ledger.push({ id, ok: false, title, error: `no link to story ${storyId} found at all — not touched` });
      continue;
    }

    const ops = [];
    if (relatedIdx < 0) {
      ops.push({ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Related', url: storyUrl } });
    }
    // remove after add so the hierIdx (computed pre-add) is still valid
    ops.push({ op: 'remove', path: `/relations/${hierIdx}` });

    if (!execute) {
      ledger.push({ id, ok: true, title, dryRun: true, from: 'Hierarchy-Reverse (Child)', to: 'Related' });
      continue;
    }

    const patchRes = await ado(`${base}/wit/workitems/${id}?api-version=7.1`, {
      method: 'PATCH',
      contentType: 'application/json-patch+json',
      body: ops,
    });
    if (!patchRes.ok) {
      const errBody = await patchRes.text();
      ledger.push({ id, ok: false, title, error: `HTTP ${patchRes.status} on write — ${errBody.slice(0, 300)}` });
      continue;
    }
    const updated = await patchRes.json();
    const nowRel = (updated.relations || []).find((r) => isStoryLink(r));
    ledger.push({
      id, ok: true, title,
      url: `https://dev.azure.com/${az.org}/${encodeURIComponent(az.project)}/_workitems/edit/${id}`,
      linkNow: nowRel ? nowRel.rel : 'NONE',
    });
  }

  console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', storyId, ledger }, null, 2));
  if (ledger.some((l) => !l.ok)) process.exit(4);
}

main();
