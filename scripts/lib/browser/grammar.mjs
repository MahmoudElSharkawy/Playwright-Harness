import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {nativeCliInstallation} from './native-cli.mjs';
import {packageRoot} from '../consumer-paths.mjs';
import {requireThat} from '../execution-core/data.mjs';

let grammar;
export function validateCliGrammar(args) {
  grammar ??= JSON.parse(readFileSync(join(dirname(nativeCliInstallation(packageRoot).coreBundle), 'tools/cli-client/help.json'), 'utf8')).commands;
  const spec = grammar[args[0]]; requireThat(spec, 'COMMAND_REFUSED: unknown native command.');
  const positional = [], flags = new Set(), values = new Map();
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]; requireThat(typeof arg === 'string', 'COMMAND_REFUSED: native arguments must be strings.');
    if (!arg.startsWith('--')) {positional.push(arg); continue;}
    const equal = arg.indexOf('='), name = arg.slice(2, equal < 0 ? undefined : equal), kind = spec.flags[name];
    requireThat(kind && (!flags.has(name) || name === 'modifiers'), 'COMMAND_REFUSED: unknown or duplicate native option.'); flags.add(name);
    if (kind === 'boolean') requireThat(equal < 0, 'COMMAND_REFUSED: boolean flag has a value.');
    else {
      const value = equal < 0 ? args[++index] : arg.slice(equal + 1);
      requireThat(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'COMMAND_REFUSED: option needs a value.');
      values.set(name, [...(values.get(name) ?? []), value]);
    }
  }
  const required = (spec.help.split('\n')[0].match(/<[^>]+>/g) ?? []).length;
  requireThat(positional.length >= required && positional.length <= spec.args.length, 'COMMAND_REFUSED: wrong native argument count.');
  const command = args[0], button = ['click', 'dblclick'].includes(command) ? positional[1] : ['mousedown', 'mouseup'].includes(command) ? positional[0] : undefined;
  requireThat(button === undefined || ['left', 'middle', 'right'].includes(button), 'COMMAND_REFUSED: invalid mouse button.');
  if (['resize', 'tab-select', 'tab-close'].includes(command)) requireThat(positional.every(value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) && (command !== 'resize' || positional.every(value => Number(value) > 0)), 'COMMAND_REFUSED: invalid size or tab index.');
  if (['mousemove', 'mousewheel'].includes(command)) requireThat(positional.every(value => value.trim() && Number.isFinite(Number(value))), 'COMMAND_REFUSED: invalid coordinates.');
  if (command === 'find') requireThat(Boolean(positional[0]) !== flags.has('regex'), 'COMMAND_REFUSED: find requires either text or --regex.');
  if (command === 'find' && values.has('regex')) {
    const source = values.get('regex')[0], literal = /^\/(.*)\/([a-z]*)$/.exec(source);
    try {new RegExp(literal ? literal[1] : source, literal ? literal[2].replace(/g/g, '') : '');} catch {throw new Error('COMMAND_REFUSED: invalid search expression.');}
  }
  if (values.has('modifiers')) requireThat(values.get('modifiers').every(value => ['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'].includes(value)), 'COMMAND_REFUSED: invalid key modifier.');
  return positional;
}
