#!/usr/bin/env node
import {projectArgument, consumerPath} from './lib/consumer-paths.mjs';
import {readBounded} from './lib/execute/storage.mjs';
import {retrieveContext, updateContext, readContextOverview, readContextMetadata, searchContext, exportContext, saveContextPolicy} from './lib/context/index.mjs';
import {chunks} from './lib/context/model.mjs';
import {fingerprint} from './lib/execution-core/data.mjs';

const usage = `pom-harness context <retrieve|update|stage> --request <consumer-json> [--project-root <consumer>]
pom-harness context metadata --request <consumer-json> [--cursor <cursor>] [--project-root <consumer>]
pom-harness context read --id <context-id> [--project-root <consumer>]
pom-harness context search --id <context-id> [--query <text>] [--source <source-id>] [--topic <topic>] [--work-item <id>] [--limit <1-25>] [--max-bytes <4096-65536>] [--cursor <cursor>] [--project-root <consumer>]
pom-harness context search --id <context-id> --catalog sources [--cursor <cursor>] [--project-root <consumer>]
pom-harness context export --id <context-id> --out <new-consumer-file> [--project-root <consumer>]
pom-harness context policy --source <source-id> --policy <consumer-json> [--project-root <consumer>]

retrieve reads selected sources without saving; update publishes a recoverable snapshot.
stage and update save included ADO attachment bytes under ignored .harness/runs/context/ for host readers.
read returns a compact captured overview. search returns bounded captured evidence only.
metadata pages every live ADO type/state without reading work items or saving context.
export streams the complete logical snapshot to a new file. policy saves an explicit selection.`;
function metadataPage(result, cursor) {
  const {metadata, ...summary} = result, revision = fingerprint(result);
  const entries = metadata.types.flatMap(type => [{kind: 'type', id: type.id, name: type.name}, ...type.states.map(state => ({kind: 'state', typeId: type.id, typeName: type.name, id: state.id, name: state.name}))]);
  let offset = 0;
  if (cursor !== undefined) {
    let value; try {if (cursor.length > 512) throw new Error(); value = JSON.parse(Buffer.from(cursor, 'base64url').toString());} catch {throw new Error('Invalid metadata cursor.');}
    if (value?.revision !== revision || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset >= entries.length) throw new Error('Metadata cursor no longer matches the project, request or live selectors; restart discovery.');
    offset = value.offset;
  }
  for (let count = Math.min(8, entries.length - offset); count > 0; count--) {
    const next = offset + count, output = {...summary, revision, total: entries.length, results: entries.slice(offset, next), omitted: entries.length - next,
      ...(next < entries.length ? {cursor: Buffer.from(JSON.stringify({revision, offset: next})).toString('base64url')} : {})};
    if (Buffer.byteLength(JSON.stringify(output)) <= 16383) return output;
  }
  throw new Error('Metadata entry exceeds the response budget.');
}
function compact(result) {
  const {snapshot, baseline, changes, checked, gaps, ...rest} = result;
  if (!snapshot) return bounded(rest);
  const sourceMap = new Map(snapshot.sources.map(source => [source.id, source])), selected = new Set(checked);
  const receipts = checked.length ? checked.map(id => sourceMap.get(id)) : snapshot.sources;
  const output = {...rest, snapshot: {contextId: snapshot.contextId, identity: snapshot.identity, scope: snapshot.scope, ...(snapshot.adoProject ? {adoProject: snapshot.adoProject} : {}), revision: snapshot.revision, status: snapshot.status, updatedAt: snapshot.updatedAt,
    counts: {sources: snapshot.sources.length, facts: snapshot.facts.length, conflicts: snapshot.facts.filter(f => f.status === 'conflicting').length, gaps: gaps.length}},
    changes: Object.fromEntries(Object.entries(changes).map(([name, values]) => [name, {count: values.length, sample: values.slice(0, 8)}])), checked: {count: checked.length, sample: checked.slice(0, 8)}, gaps: {count: gaps.length, sample: gaps.slice(0, 8)},
    sources: {count: snapshot.sources.length, sample: receipts.slice(0, 8).map(source => Object.fromEntries(['id', 'kind', 'path', 'localPath', 'hash', 'attemptedHash', 'version', 'attachmentId', 'status', 'coverage', 'verifiedAt'].filter(key => source[key] !== undefined).map(key => [key, source[key]])))}};
  if (!result.saved) {
    const preview = checked.length ? snapshot.facts.filter(fact => fact.references.some(reference => selected.has(reference.sourceId))) : snapshot.facts;
    output.evidence = preview.slice(0, 8).map(fact => {const chunk = chunks(fact.text, fact.id)[0]; return {factId: fact.id, chunkId: chunk.id, excerpt: chunk.text, offsets: {start: chunk.start, end: chunk.end}, status: fact.status, references: fact.references.slice(0, 4), omittedReferences: Math.max(0, fact.references.length - 4), omittedBytes: Buffer.byteLength(fact.text) - Buffer.byteLength(chunk.text)};});
    output.coverage = 'Unsaved preview. Narrow the request or explicitly save, then search, for further evidence.';
    while (Buffer.byteLength(JSON.stringify(output)) > 15500 && output.evidence.length) output.evidence.pop();
    output.omittedFacts = snapshot.facts.length - output.evidence.length;
  }
  return bounded(output);
}
function bounded(value) {
  // Large metadata/policy responses expose counts and samples, never an unbounded context dump.
  const omitted = {};
  function visit(item, path) {
    if (Array.isArray(item)) {if (item.length > 8) omitted[path] = item.length - 8; return item.slice(0, 8).map((child, i) => visit(child, path + '.' + i));}
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child, path ? path + '.' + key : key)]));
    return item;
  }
  let output = visit(value, ''); if (Object.keys(omitted).length) output.omitted = omitted;
  if (Buffer.byteLength(JSON.stringify(output)) > 16383) output = {status: value.status, saved: value.saved ?? false, sourceId: value.sourceId, metadataContinuation: value.metadataContinuation, summary: 'Response exceeds preview budget; narrow the selected sources or policy.', counts: {types: value.metadata?.types.length ?? 0, repairs: value.repairs?.length ?? 0}};
  return output;
}
function inputJson(roots, path) {
  try {return readBounded(consumerPath(roots, path));} catch {throw new Error('Context request/policy must be readable bounded JSON.');}
}
try {
  if (process.argv.slice(2).some(value => ['help', '--help', '-h'].includes(value))) {console.log(usage);}
  else {
    const {roots, args} = projectArgument(), [command, ...rest] = args, options = {};
    const fields = command === 'search' ? ['id', 'query', 'source', 'topic', 'work-item', 'limit', 'max-bytes', 'cursor', 'catalog'] : command === 'metadata' ? ['request', 'cursor'] : command === 'export' ? ['id', 'out'] : command === 'read' ? ['id'] : command === 'policy' ? ['source', 'policy'] : ['request'];
    for (let index = 0; index < rest.length; index += 2) {
      const name = rest[index].replace(/^--/, '');
      if (!rest[index].startsWith('--') || !fields.includes(name) || options[name] !== undefined || !rest[index + 1] || rest[index + 1].startsWith('--')) throw new Error(usage);
      options[name] = rest[index + 1];
    }
    if ((command === 'search' ? ['id'] : command === 'metadata' ? ['request'] : fields).some(name => options[name] === undefined)) throw new Error(usage);
    let result;
    if (command === 'read') result = readContextOverview(roots, options.id);
    else if (command === 'metadata') result = metadataPage(await readContextMetadata(roots, inputJson(roots, options.request)), options.cursor);
    else if (command === 'search') result = searchContext(roots, options.id, Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'id').map(([key, value]) => [{source: 'sourceId', 'work-item': 'workItemId', 'max-bytes': 'maxBytes'}[key] ?? key, value])));
    else if (command === 'export') result = exportContext(roots, options.id, options.out);
    else if (command === 'policy') result = await saveContextPolicy(roots, options.source, inputJson(roots, options.policy));
    else if (['retrieve', 'update', 'stage'].includes(command)) {
      const request = inputJson(roots, options.request);
      result = command === 'update' ? await updateContext(roots, request, {stageAttachments: true}) : await retrieveContext(roots, request, {stageAttachments: command === 'stage'});
    } else throw new Error(usage);
    if (result.metadata) result.metadataContinuation = 'Use context metadata --request <context-request> [--cursor <cursor>] for every live type/state.';
    const output = ['search', 'metadata'].includes(command) ? result : compact(result); process.stdout.write(JSON.stringify(output) + '\n');
    if (['SELECTION_REQUIRED', 'POLICY_REPAIR_REQUIRED'].includes(result.status) || result.snapshot?.status === 'partial') process.exitCode = 2;
  }
} catch (error) {console.error(`project-context: ${error.message}`); process.exitCode = 1;}
