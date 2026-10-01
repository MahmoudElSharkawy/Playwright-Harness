// Invoked through a native host tool. The deliberately denied branch is harmless.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {executeHostCases} from './host-execution.mjs';
const projectRoot = process.cwd(), mode = process.argv[2];
mkdirSync(join(projectRoot, '.harness'), {recursive: true});
if (mode === 'denied') {writeFileSync(join(projectRoot, '.harness', 'denied-marker'), 'A denied command executed.'); process.exitCode = 1;}
else if (mode === 'ping') {writeFileSync(join(projectRoot, '.harness', 'allowed-marker'), 'Native tool executed.'); console.log('M11_ALLOWED');}
else if (mode === 'execute') {
  const targets = JSON.parse(readFileSync(join(projectRoot, 'targets.json'), 'utf8'));
  try {
    const cases = await executeHostCases(projectRoot, targets);
    const digest = createHash('sha256').update(readFileSync(join(projectRoot, '.harness', 'execution-cases.json'))).digest('hex');
    console.log(JSON.stringify({receipt: 'M11_EXECUTION_RECEIPT', sha256: digest, cases: cases.length}));
  } catch (error) {console.error(JSON.stringify({receipt: 'M11_EXECUTION_FAILED', classification: error.code ?? error.name, case: typeof error.message === 'string' && /^[a-z-]+$/.test(error.message) ? error.message : 'inspect-protected-evidence'})); process.exitCode = 1;}
} else throw new Error('Use ping, denied or execute.');
