import {existsSync} from 'node:fs';
import {consumerPath} from '../consumer-paths.mjs';
import {readBounded} from '../execute/storage.mjs';
import {contextData} from '../context/model.mjs';
import {keys, fingerprint, requireThat} from '../execution-core/data.mjs';

const path = '.harness/knowledge/test-case-design-conventions.json';
const text = value => typeof value === 'string' && value.trim() && value.length <= 2048;

/** Advisory business defaults only; runtime settings and accepted scope keep their own homes. */
export function captureConventions(roots, requirements) {
  const file = consumerPath(roots, path);
  if (!existsSync(file)) return {path, status: 'absent', usable: false};
  try {
    const profile = contextData(readBounded(file, 32768), 32768);
    keys(profile, ['version', 'project', 'application', 'status', 'agreement', 'defaults'], 'design conventions');
    requireThat(profile.version === 1 && ['current', 'stale', 'conflicting'].includes(profile.status), 'Unsupported convention profile.');
    requireThat(profile.project === requirements.project && profile.application === requirements.application, 'Conventions belong to another project/application.');
    keys(profile.agreement, ['actor', 'reference'], 'convention agreement');
    requireThat(text(profile.agreement.actor) && text(profile.agreement.reference), 'Conventions need an existing agreement reference.');
    keys(profile.defaults, ['persona', 'terminology', 'titleConvention', 'setupOwnership', 'dataOwnership', 'languages'], 'convention defaults');
    for (const key of ['persona', 'titleConvention', 'setupOwnership', 'dataOwnership']) if (profile.defaults[key] !== undefined) requireThat(text(profile.defaults[key]), 'Convention defaults need bounded text.');
    const {terminology, languages} = profile.defaults;
    if (terminology !== undefined) requireThat(terminology && !Array.isArray(terminology) && typeof terminology === 'object' && Object.keys(terminology).length <= 50 && Object.entries(terminology).every(([key, value]) => text(key) && text(value)), 'Terminology needs bounded word mappings.');
    if (languages !== undefined) requireThat(Array.isArray(languages) && languages.length <= 50 && new Set(languages).size === languages.length && languages.every(text), 'Language context needs distinct bounded names.');
    return {path, status: profile.status, usable: profile.status === 'current', fingerprint: fingerprint(profile), profile,
      ...(profile.status === 'current' ? {} : {reason: `Conventions are ${profile.status}; use accepted requirements and current authorized choices.`})};
  } catch {return {path, status: 'unavailable', usable: false, reason: 'Convention profile is malformed, sensitive, incompatible or unavailable; supported design can proceed without its defaults.'};}
}
