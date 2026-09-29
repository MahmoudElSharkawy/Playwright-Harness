#!/usr/bin/env node
/**
 * tag-ado-workitem.mjs — add a System.Tags entry to one or more Azure DevOps work
 * items (bugs, by convention) without touching any other field.
 *
 * Usage:
 *   node scripts/tag-ado-workitem.mjs --ids 12345,12346 --tag "automation-<suite-name>" [--execute]
 *   node scripts/tag-ado-workitem.mjs --id 12347 --tag "automation-<suite-name>" [--execute]
 *
 * Reads the current System.Tags on each item first and appends the tag only if it
 * isn't already present (ADO's Tags field is semicolon-separated) — safe to re-run.
 * Dry-run is the default; nothing is written without --execute.
 * Auth: AZURE_PAT / AZURE_DEVOPS_EXT_PAT from .env (never printed).
 * Exit codes: 0 ok · 1 usage/config · 2 auth · 3 work item not found · 4 API error.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function fail(code, msg) {
  console.error(`[tag-ado-workitem] ERROR: ${msg}`);
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

  const tag = opt('--tag');
  const idsRaw = opt('--ids') || opt('--id');
  if (!tag || !idsRaw) {
    fail(1, 'usage: node scripts/tag-ado-workitem.mjs --ids <id[,id...]> --tag "<value>" [--execute]');
  }
  const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.some((id) => !/^\d+$/.test(id))) fail(1, `work item ids must be numeric — got: ${idsRaw}`);
  const execute = has('--execute');

  const ledger = [];
  for (const id of ids) {
    const getRes = await ado(`${base}/wit/workitems/${id}?fields=System.Tags,System.Title&api-version=7.1`);
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
    const currentTags = (item.fields['System.Tags'] || '')
      .split(';').map((t) => t.trim()).filter(Boolean);

    if (currentTags.includes(tag)) {
      ledger.push({ id, ok: true, title, skipped: true, reason: 'tag already present', tags: currentTags });
      continue;
    }

    const newTags = [...currentTags, tag].join('; ');
    if (!execute) {
      ledger.push({ id, ok: true, title, dryRun: true, tagsBefore: currentTags, tagsAfter: [...currentTags, tag] });
      continue;
    }

    const patchRes = await ado(`${base}/wit/workitems/${id}?api-version=7.1`, {
      method: 'PATCH',
      contentType: 'application/json-patch+json',
      body: [{ op: 'add', path: '/fields/System.Tags', value: newTags }],
    });
    if (!patchRes.ok) {
      ledger.push({ id, ok: false, title, error: `HTTP ${patchRes.status} on write` });
      continue;
    }
    const updated = await patchRes.json();
    ledger.push({
      id, ok: true, title,
      url: updated._links?.html?.href || `${base}/wit/workitems/${id}`,
      tags: (updated.fields['System.Tags'] || '').split(';').map((t) => t.trim()).filter(Boolean),
    });
  }

  console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', tag, ledger }, null, 2));
  if (ledger.some((l) => !l.ok)) process.exit(4);
}

main();
