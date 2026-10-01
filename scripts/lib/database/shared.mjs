import {keys, requireThat} from '../execution-core/data.mjs';

// Shared by the two concrete drivers; native messages never enter public results.
export class DatabaseFailure extends Error {
  constructor(classification, dispatched = false, reason = classification) {super(`Database execution failed: ${reason}.`); this.classification = classification; this.dispatched = dispatched; this.reason = reason;}
}
export async function bounded(action, signal) {
  if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
  let cancel;
  try {return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {cancel = () => reject(new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED')); signal.addEventListener('abort', cancel, {once: true});})]);}
  finally {signal.removeEventListener('abort', cancel);}
}
export function credentials(value) {
  keys(value, ['user', 'password'], 'SQL credential');
  const {user, password: supplied} = value;
  requireThat(typeof user === 'string' && user.length > 0 && user.length <= 128 && typeof supplied === 'string' && supplied.length > 0 && supplied.length <= 1024, 'SQL authentication requires credentials only, never connection overrides.');
  return {user, password: supplied};
}
