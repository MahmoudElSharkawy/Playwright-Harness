import {mkdir, writeFile, rm, realpath} from 'node:fs/promises';
import {mkdirSync, writeFileSync, rmSync, realpathSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {classifyNative} from '../../scripts/lib/browser/native-cli.mjs';

/** Library injection only: normal runtime storage and classification, no subprocesses. */
export function fakeNative({snapshot = '- button "Save" [ref=e1]', evaluate = () => ({disabled: true, enabled: false}), command, synchronousFiles = false} = {}) {
  const calls = [], sessions = [];
  const fs = synchronousFiles ? {mkdir: mkdirSync, writeFile: writeFileSync, rm: rmSync, realpath: realpathSync.native} : {mkdir, writeFile, rm, realpath};
  const factory = async roots => {
    await fs.mkdir(dirname(roots.runRoot), {recursive: true}); await fs.mkdir(roots.runRoot);
    roots = {packageRoot: await fs.realpath(roots.packageRoot), projectRoot: await fs.realpath(roots.projectRoot), runRoot: await fs.realpath(roots.runRoot)};
    const workRoot = join(roots.runRoot, 'protected'), evidenceRoot = join(roots.runRoot, 'evidence');
    await fs.mkdir(workRoot); await fs.mkdir(evidenceRoot);
    const events = [], session = {
      roots, workRoot, evidenceRoot, events, session: 'synthetic-session', ownership: {},
      open: async () => ({}),
      command: async (args, options) => {
        calls.push(args);
        let reply;
        try {
          reply = await command?.(args, options);
          if (reply === undefined) {
            const file = args.find(arg => arg.startsWith('--filename='))?.slice(11);
            if (args[0] === 'snapshot') await fs.writeFile(file, typeof snapshot === 'function' ? snapshot() : snapshot);
            if (args[0] === 'eval') await fs.writeFile(file, JSON.stringify({value: await evaluate(args), coverage: {complete: true, gaps: []}}));
            if (args[0] === 'screenshot') await fs.writeFile(file, Buffer.from('89504e470d0a1a0a', 'hex'));
            if (args[0] === 'state-save') await fs.writeFile(args[1], JSON.stringify({cookies: [], origins: []}));
            reply = {stdout: JSON.stringify({result: 'OK'}), exitCode: 0, dispatched: true};
          }
          const result = classifyNative(reply); events.push({command: args[0], classification: 'OK', dispatched: reply.dispatched}); return result;
        } catch (error) {events.push({command: args[0], classification: error.classification ?? 'EXECUTOR', dispatched: error.dispatched === true}); throw error;}
      },
      interrupt: async () => ({}),
      close: async () => {await fs.rm(workRoot, {recursive: true, force: true}); return {complete: true, failures: [], sessionAbsent: true};}
    };
    sessions.push(session); return session;
  };
  return {factory, calls, sessions};
}
