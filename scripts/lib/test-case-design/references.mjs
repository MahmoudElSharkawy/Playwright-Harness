import {consumerPath} from '../consumer-paths.mjs';
import {readBounded} from '../execute/storage.mjs';
import {contextData} from '../context/model.mjs';
import {contextParts} from '../context/files.mjs';
import {fingerprint, keys, requireThat} from '../execution-core/data.mjs';
import {adoId, workItemLinkId} from '../integrations/config.mjs';
import {ordinaryHtmlText, requirementDestination, requirementLinks, requirementsClient} from '../requirements/sources.mjs';

const fields = ['System.Description', 'Microsoft.VSTS.Common.AcceptanceCriteria'];
const classifications = ['required', 'supporting', 'incidental', 'unresolved'];
const unique = values => [...new Set(values)];
const safeText = value => typeof value === 'string' && value.trim() && value.length <= 65536;
const affectedEntries = inventory => inventory.filter(row => ['requirement', 'criterion'].includes(row.kind));

/** Supplemental scope must be selected explicitly and accepted by a current owner decision. */
export function acceptedSupplemental(roots, state, entry, part) {
  if (!roots || entry.disposition !== 'accepted' || !state.evidence.requirements.request.sources.some(source => source.id === part.sourceId && source.kind === 'file')) return false;
  return entry.evidence.some(evidence => {
    if (evidence.kind !== 'decision') return false;
    try {
      const decision = contextData(readBounded(consumerPath(roots, evidence.path)));
      return fingerprint(decision) === evidence.fingerprint && decision.version === 1 && decision.authority === 'owner' && safeText(decision.actor) && safeText(decision.statement) && decision.consumer === state.requirements.consumer && decision.snapshot === state.requirements.snapshot && decision.requirementId === entry.id && decision.content === entry.content && decision.disposition === 'accepted';
    } catch {return false;}
  });
}

function destination(value, origin) {
  const inline = /^#([1-9]\d{0,9})$/.exec(value);
  if (inline && Number(inline[1]) <= 2147483647) return origin ? {workItemId: Number(inline[1]), destination: `${origin.organizationUrl}/${encodeURIComponent(origin.project)}/_workitems/edit/${inline[1]}`, status: 'candidate'} : {destination: value, status: 'unverified'};
  const safe = requirementDestination(value);
  if (safe.status !== 'candidate') return safe;
  if (!origin) return {...safe, status: 'unverified'};
  const url = new URL(value), project = {id: origin.projectId, name: origin.project};
  if (url.search || url.hash || /%2f|%5c|%2e|\\/i.test(url.pathname)) return {...safe, status: 'unsupported'};
  let workItemId = workItemLinkId(value, origin.organizationUrl, project);
  for (const scope of [project.id, project.name]) {
    const prefix = `${origin.organizationUrl}/${encodeURIComponent(scope)}/_workitems/edit/`;
    if (value.toLowerCase().startsWith(prefix.toLowerCase()) && /^[1-9]\d{0,9}\/?$/.test(value.slice(prefix.length))) {
      const number = Number(value.slice(prefix.length).replace(/\/$/, ''));
      if (number <= 2147483647) workItemId = number;
    }
  }
  return workItemId ? {...safe, workItemId} : {...safe, status: 'out-of-scope'};
}

function discover(source, inventory, origin, parent) {
  const occurrences = [], links = source.links ?? [];
  for (const part of source.parts.filter(part => ['requirement', 'criterion'].includes(part.kind ?? 'requirement'))) {
    const linked = links.filter(link => link.sourceId === part.sourceId && link.location === part.location);
    const inherited = parent?.requirementIds;
    const ids = (start, end) => inherited ?? affectedEntries(inventory).filter(entry => entry.partId === part.id && (start < entry.end && end > entry.start || start === end && start >= entry.start && start <= entry.end)).map(entry => entry.id);
    const append = (kind, text, target, start, end, extra = {}) => occurrences.push({kind, sourceId: part.sourceId, revision: part.revision, location: part.location, partId: part.id, start, end, text, passage: part.text.slice(Math.max(0, start - 180), Math.min(part.text.length, end + 180)), target, requirementIds: ids(start, end), ...(parent ? {via: parent.id} : {}), ...extra});
    for (const link of linked) {
      const start = source.origin ? link.textStart : link.start, end = source.origin ? link.textEnd : link.end;
      append('hyperlink', link.text, link.destination, Math.max(0, start), Math.max(0, end), {linkStatus: link.status});
    }
    const urlSpans = [];
    for (const match of part.text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const target = match[0].replace(/[.,;)]+$/, ''), start = match.index, end = start + target.length;
      urlSpans.push({start, end});
      if (!linked.some(link => {const a = source.origin ? link.textStart : link.start, b = source.origin ? link.textEnd : link.end; return start >= a && start < b;})) append('url', target, target, start, end);
    }
    for (const match of part.text.matchAll(/(?<![\w/#])#([1-9]\d{0,9})(?!\w|\.\d)/g)) {
      const start = match.index, end = start + match[0].length;
      if (Number(match[1]) > 2147483647 || urlSpans.some(span => start >= span.start && start < span.end) || linked.some(link => {const a = source.origin ? link.textStart : link.start, b = source.origin ? link.textEnd : link.end; return start >= a && start < b;})) continue;
      append('inline', match[0], match[0], start, end);
    }
  }
  return occurrences;
}

function sourceEvidence(item) {
  const revision = String(item.rev), sourceId = `reference-${item.id}`, parts = [], omissions = [], links = [];
  for (const location of fields) {
    const html = item.fields[location];
    if (typeof html !== 'string' || !html.trim()) continue;
    const safe = contextParts([{location, text: ordinaryHtmlText(html)}]);
    if (safe.redacted) omissions.push({location, reason: 'redacted'});
    for (const part of safe.contributions) parts.push({id: fingerprint({sourceId, location}), sourceId, revision, location, text: part.text, kind: 'requirement'});
    links.push(...requirementLinks(html, sourceId, revision, location));
  }
  if (!parts.length) omissions.push({reason: 'missing-rules'});
  if (links.some(link => link.status === 'redacted')) omissions.push({reason: 'redacted-link'});
  return {workItemId: item.id, revision, parts, links, omissions};
}

function accepted(roots, requirements, reference) {
  return reference.requirementIds.filter(id => {
    const entry = requirements.inventory.find(entry => entry.id === id);
    if (entry?.disposition !== 'accepted') return false;
    return entry.evidence.some(evidence => {
      if (evidence.kind !== 'decision') return false;
      try {
        const decision = contextData(readBounded(consumerPath(roots, evidence.path)));
        return fingerprint(decision) === evidence.fingerprint && decision.version === 1 && decision.authority === 'owner' && safeText(decision.actor) && decision.consumer === requirements.consumer && decision.snapshot === requirements.snapshot && decision.requirementId === id && decision.content === entry.content && decision.disposition === 'accepted' && Array.isArray(decision.references) && decision.references.some(binding => binding.id === reference.id && binding.revision === reference.revision && binding.content === reference.content);
      } catch {return false;}
    });
  });
}

/** One bounded direct read pass; deeper references are records, never a crawl. */
export async function captureReferences(roots, source, requirements, story, input, options = {}) {
  const origin = source.origin, records = new Map(), decisions = input.references ?? [], supplemental = input.referenceIds ?? [];
  requireThat(Array.isArray(decisions) && decisions.length <= 200 && unique(decisions.map(row => row.id)).length === decisions.length, 'Reference decisions need distinct bounded identities.');
  requireThat(Array.isArray(supplemental) && supplemental.length <= 20 && unique(supplemental.map(adoId)).length === supplemental.length, 'Select at most 20 distinct supplemental reference IDs.');
  requireThat(!supplemental.length || origin, 'Local source design cannot imply an ADO reference destination.');
  for (const decision of decisions) {
    keys(decision, ['id', 'classification', 'requirementIds', 'reason', 'rules'], 'reference decision');
    requireThat(typeof decision.id === 'string' && classifications.includes(decision.classification) && safeText(decision.reason), 'Reference classification needs identity and explicit reason.');
    requireThat(Array.isArray(decision.requirementIds) && unique(decision.requirementIds).length === decision.requirementIds.length && decision.requirementIds.every(id => affectedEntries(requirements.inventory).some(row => row.id === id)), 'Reference requirements must belong to the selected inventory.');
    requireThat(!['required', 'unresolved'].includes(decision.classification) || decision.requirementIds.length > 0, 'Required references must identify affected requirements.');
  }
  function add(occurrence, deeper = false) {
    const target = occurrence.linkStatus && occurrence.linkStatus !== 'candidate' ? {destination: occurrence.target, status: occurrence.linkStatus} : destination(occurrence.target, origin);
    const identity = target.workItemId ? {organizationUrl: origin.organizationUrl.toLowerCase(), projectId: origin.projectId.toLowerCase(), workItemId: target.workItemId} : {destination: target.destination, sourceId: occurrence.sourceId, location: occurrence.location, start: occurrence.start};
    const id = 'ref-' + fingerprint(identity).slice(0, 24);
    if (!records.has(id)) records.set(id, {id, ...target, classification: occurrence.kind === 'relationship' ? 'incidental' : 'unresolved', requirementIds: [], reason: occurrence.kind === 'relationship' ? 'Relationship alone does not select business rules.' : 'Classify the reference and confirm applicable accepted rules.', occurrences: [], rules: [], acceptedRequirementIds: [], ...(deeper ? {status: target.status === 'candidate' ? 'deeper-unresolved' : target.status} : {})});
    const record = records.get(id), {target: ignored, requirementIds, ...retained} = occurrence;
    record.occurrences.push(retained); record.requirementIds = unique([...record.requirementIds, ...requirementIds]);
    if (occurrence.kind !== 'relationship' && record.classification === 'incidental') {record.classification = 'unresolved'; if (deeper && record.status === 'incidental') record.status = 'deeper-unresolved';}
    return record;
  }
  for (const occurrence of discover(source, requirements.inventory, origin)) add(occurrence);
  for (const [index, relation] of (story?.relations ?? []).entries()) {
    if (relation.rel === 'AttachedFile' || relation.rel === 'Microsoft.VSTS.Common.TestedBy-Forward') continue;
    if (!workItemLinkId(relation.url, origin.organizationUrl, {id: origin.projectId, name: origin.project})) continue;
    add({kind: 'relationship', sourceId: 'story', revision: String(story.rev), location: `relation:${index}`, start: index, end: index + 1, text: relation.rel, passage: relation.rel, target: relation.url, requirementIds: []});
  }
  for (const workItemId of supplemental) add({kind: 'selection', sourceId: 'selection', revision: '', location: `reference:${workItemId}`, start: 0, end: 0, text: `#${workItemId}`, passage: 'Explicit supplemental source selection.', target: `#${workItemId}`, requirementIds: []});
  function apply(record) {
    const decision = decisions.find(row => row.id === record.id); if (!decision) return;
    requireThat(!['required', 'unresolved'].includes(decision.classification) || record.requirementIds.every(id => decision.requirementIds.includes(id)), 'Reference classification must retain every originating affected requirement.');
    Object.assign(record, {classification: decision.classification, requirementIds: decision.requirementIds, reason: decision.reason});
  }
  const initial = [...records.values()]; let reads = 0;
  const client = origin && requirementsClient(roots, options);
  for (const record of initial) {
    apply(record);
    if (record.classification === 'incidental') {record.status = 'incidental'; continue;}
    if (record.status !== 'candidate') continue;
    if (record.workItemId === origin.storyId) {record.status = 'cycle'; continue;}
    if (reads >= 20) {record.status = 'read-bound'; continue;}
    reads++;
    let captured;
    try {
      const item = await client.read(`wit/workitems/${record.workItemId}?$expand=relations&api-version=7.1`);
      requireThat(adoId(item.id) === record.workItemId && Number.isSafeInteger(item.rev) && item.rev > 0 && item.fields, 'Referenced identity/revision is incomplete.');
      await client.requireWorkItemProject(item); captured = sourceEvidence(item);
    } catch {record.status = 'inaccessible'; continue;}
    record.source = captured; record.revision = captured.revision;
    const rules = decisions.find(row => row.id === record.id)?.rules ?? [];
    requireThat(Array.isArray(rules) && rules.length <= 100 && unique(rules.map(rule => fingerprint(rule))).length === rules.length, 'Reference rules must be distinct bounded located quotes.');
    for (const rule of rules) {
      keys(rule, ['location', 'quote'], 'referenced rule');
      requireThat(safeText(rule.quote) && captured.parts.some(part => part.location === rule.location && part.text.includes(rule.quote)), 'Referenced rules must quote an exact captured source passage.');
    }
    record.rules = rules; record.content = fingerprint({source: captured, rules});
    for (const occurrence of discover({...captured, origin}, requirements.inventory, origin, record)) {
      const part = captured.parts.find(part => part.id === occurrence.partId);
      const inRule = rules.some(rule => {
        if (rule.location !== occurrence.location) return false;
        for (let start = part.text.indexOf(rule.quote); start >= 0; start = part.text.indexOf(rule.quote, start + 1)) if (occurrence.start >= start && occurrence.end <= start + rule.quote.length) return true;
        return false;
      });
      if (!rules.length || inRule) add(occurrence, true);
    }
  }
  for (const record of records.values()) {
    apply(record);
    if (record.classification === 'incidental') {record.status = 'incidental'; continue;}
    if (!record.source) continue;
    record.acceptedRequirementIds = record.rules.length ? accepted(roots, requirements, record) : [];
    record.status = record.source.omissions.length ? 'incomplete' : record.classification === 'unresolved' ? 'needs-classification' : !record.rules.length ? 'needs-rules' : record.classification === 'supporting' || record.requirementIds.every(id => record.acceptedRequirementIds.includes(id)) ? 'resolved' : 'needs-decision';
  }
  requireThat(decisions.every(decision => records.has(decision.id)), 'Reference decision must name a discovered or explicitly selected reference.');
  return contextData({version: 1, provenance: source.linksVersion === 1 ? 'captured' : 'legacy-missing', items: [...records.values()], reads}, 2 * 1024 * 1024);
}

export function dependencyGaps(state, requirementIds) {
  const selected = requirementIds ?? affectedEntries(state.requirements.inventory).map(row => row.id);
  const references = state.evidence.references;
  if (!references) return [];
  const gaps = (state.referenceFreshness ?? []).filter(row => row.requirementIds.some(id => selected.includes(id))).map(row => ({...row, requirementIds: row.requirementIds.filter(id => selected.includes(id))}));
  if (references.provenance === 'legacy-missing' && state.evidence.requirements.origin && selected.length) gaps.push({referenceId: 'legacy-link-provenance', requirementIds: selected, caseIds: [], status: 'legacy-missing', reason: 'Historical link provenance is unavailable; explicitly refresh source capture before completeness or publication.'});
  for (const reference of references.items) {
    if (!['required', 'unresolved'].includes(reference.classification)) continue;
    const ids = reference.requirementIds.filter(id => selected.includes(id) && !(reference.classification === 'required' && ['resolved', 'needs-decision'].includes(reference.status) && reference.acceptedRequirementIds.includes(id)));
    if (!ids.length) continue;
    gaps.push({referenceId: reference.id, requirementIds: ids, caseIds: state.draft?.cases.filter(row => row.coverageReferences.some(ref => ids.includes(ref.requirementId))).map(row => row.id) ?? [], status: reference.status, reason: reference.reason});
  }
  return gaps;
}

export async function requireFreshReferences(roots, state, options = {}) {
  const references = state.evidence.references;
  if (!references?.items.length) return;
  const ids = options.selected && state.draft ? unique(state.draft.cases.filter(row => options.selected.includes(row.id)).flatMap(row => row.coverageReferences.map(ref => ref.requirementId))) : affectedEntries(state.requirements.inventory).map(row => row.id);
  const relevant = references.items.filter(row => row.classification !== 'incidental' && row.source && row.requirementIds.some(id => ids.includes(id)));
  if (!relevant.length) return;
  const client = requirementsClient(roots, options), origin = state.evidence.requirements.origin, project = await client.projectIdentity();
  requireThat(origin && client.configuration.organizationUrl === origin.organizationUrl && project.id.toLowerCase() === origin.projectId.toLowerCase(), 'Referenced source destination changed; refresh and renew approval.');
  for (const reference of relevant) {
    let current;
    try {
      const item = await client.read(`wit/workitems/${reference.workItemId}?$expand=relations&api-version=7.1`);
      requireThat(item.id === reference.workItemId && Number.isSafeInteger(item.rev) && item.rev > 0 && item.fields, 'Incomplete reference.');
      await client.requireWorkItemProject(item); current = sourceEvidence(item);
    } catch {throw new Error(`Referenced source ${reference.workItemId} is unavailable; revalidate affected cases and renew approval.`);}
    requireThat(fingerprint(current) === fingerprint(reference.source), `Referenced source ${reference.workItemId} changed; revalidate affected cases and renew approval.`);
    requireThat(reference.classification !== 'required' || reference.requirementIds.filter(id => ids.includes(id)).every(id => accepted(roots, state.requirements, reference).includes(id)), 'Referenced-rule acceptance is missing or changed; revalidate and renew approval.');
  }
}
