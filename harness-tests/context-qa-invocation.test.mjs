import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {adoptProject, INSTRUCTION_BLOCK} from '../scripts/lib/adoption.mjs';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';

const read = path => readFileSync(join(packageRoot, path), 'utf8').replaceAll('\r\n', '\n');
const frontmatter = text => text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
function consumer(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'pom-qa-invocation-'));
  t.after(() => rmSync(root, {recursive: true}));
  return root;
}

test('both consumer discovery paths retain explicit-only native policies and the explicit command', t => {
  const root = consumer(t);
  adoptProject({projectRoot: root});
  for (const host of ['.agents', '.claude']) {
    const skill = join(root, host, 'skills/context-qa');
    assert.equal(realpathSync(skill), realpathSync(join(packageRoot, '.agents/skills/context-qa')));
    const metadata = frontmatter(readFileSync(join(skill, 'SKILL.md'), 'utf8').replaceAll('\r\n', '\n'));
    assert.match(metadata, /^name: context-qa$/m);
    assert.match(metadata, /^disable-model-invocation: true$/m);
    assert.doesNotMatch(metadata, /^user-invocable: false$/m);
    assert.match(readFileSync(join(skill, 'agents/openai.yaml'), 'utf8'), /^policy:\r?\n  allow_implicit_invocation: false\r?$/m);
  }
  // The repository's compatibility entrypoint must also be safe before adoption.
  if (existsSync(join(packageRoot, '.claude/skills/context-qa/SKILL.md')))
    assert.match(frontmatter(read('.claude/skills/context-qa/SKILL.md')), /^disable-model-invocation: true$/m);
});

test('4.0.0 consumers replace the automatic managed block without losing team instructions', t => {
  const previous = read('harness-tests/fixtures/context-qa/instructions-4.0.0.md').trimEnd();
  assert.equal(createHash('sha256').update(previous).digest('hex'), '1ec4ebd6170cc2ef766a60b6915fa69d1829964d8040c68ea1e5b6688e592b87');
  assert.notEqual(INSTRUCTION_BLOCK, previous, 'The released automatic routing must be replaced.');
  for (const newline of ['\n', '\r\n']) {
    const root = consumer(t), before = `Team instructions${newline}${newline}`, after = `${newline}${newline}More team instructions${newline}`;
    for (const file of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(join(root, file), before + previous.replaceAll('\n', newline) + after);
    const first = adoptProject({projectRoot: root});
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      assert(first.changes.some(change => change.file === file && change.kind === 'replace'));
      assert.equal(readFileSync(join(root, file), 'utf8'), before + INSTRUCTION_BLOCK.replaceAll('\n', newline) + after);
    }
    assert.deepEqual(adoptProject({projectRoot: root}).changes, []);
  }
});

test('a customized 4.0.0 block is preserved and stops the upgrade before writes', t => {
  const root = consumer(t);
  const customized = read('harness-tests/fixtures/context-qa/instructions-4.0.0.md').replace('derive-only.', 'derive-only. Team addition.');
  writeFileSync(join(root, 'CLAUDE.md'), customized);
  assert.throws(() => adoptProject({projectRoot: root}), /edited harness instruction block in CLAUDE\.md/);
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), customized);
  assert(!existsSync(join(root, 'AGENTS.md')));
});
