import {contextData} from '../context/model.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {adoGuid} from '../integrations/config.mjs';

/** Read only the configured project's teams; never guess people from a business role. */
export async function projectMentionCandidates(client) {
  const project = await client.projectIdentity(), teams = await client.projectTeams(), people = new Map(), identities = new Map(), teamIds = new Set();
  requireThat(Array.isArray(teams) && teams.length <= 100, 'Team roster exceeds supported scope or is incomplete.');
  for (const team of teams) {
    requireThat(adoGuid(team.id) && typeof team.name === 'string' && team.name.trim() && team.name.length <= 200 && !teamIds.has(team.id.toLowerCase()) && (!team.projectId || team.projectId.toLowerCase() === project.id.toLowerCase()), 'Invalid, duplicate or foreign project team.'); teamIds.add(team.id.toLowerCase());
    const members = await client.teamMembers(team.id), membersSeen = new Set();
    requireThat(Array.isArray(members) && members.length <= 10000, 'Team membership is incomplete or exceeds its bound.');
    for (const member of members) {
      const person = member.identity;
      requireThat(person && adoGuid(person.id) && typeof person.displayName === 'string' && person.displayName.trim() && person.displayName.length <= 320 && typeof person.uniqueName === 'string' && person.uniqueName.trim() && person.uniqueName.length <= 320 && !/[\r\n\x00-\x1f]/.test(person.displayName + person.uniqueName), 'Incomplete team-member identity.');
      const id = person.id.toLowerCase(); requireThat(!membersSeen.has(id), 'Duplicate team-member identity; roster may be incomplete.'); membersSeen.add(id);
      requireThat(['inactive', 'isDeletedInOrigin', 'isContainer'].every(key => person[key] === undefined || typeof person[key] === 'boolean') && (person.descriptor === undefined || typeof person.descriptor === 'string' && person.descriptor.length <= 2048), 'Team identity type/status is incomplete.');
      const descriptor = person.descriptor ?? null, subjectType = descriptor?.split('.')[0].toLowerCase();
      const group = person.isContainer === true || ['vssgp', 'aadgp', 'adgp'].includes(subjectType);
      const knownPerson = person.isContainer === false || ['aad', 'msa'].includes(subjectType);
      requireThat(group || knownPerson || person.inactive || person.isDeletedInOrigin, 'Team identity type does not establish a person. Resolve a typed user identity before mentioning anyone.');
      const value = contextData({id, displayName: person.displayName, uniqueName: person.uniqueName, descriptor});
      const eligible = knownPerson && !person.inactive && !person.isDeletedInOrigin && !group, identity = {...value, eligible};
      const before = identities.get(id); requireThat(!before || fingerprint(before) === fingerprint(identity), 'Team identity changed during roster lookup; resolve again.'); identities.set(id, identity);
      if (!eligible) continue;
      people.set(id, value);
      requireThat(people.size <= 10000, 'Project roster exceeds supported scope.');
    }
  }
  return [...people.values()].sort((left, right) => left.id.localeCompare(right.id));
}
export async function resolveTeamMentions(client, selectors) {
  requireThat(Array.isArray(selectors) && selectors.length <= 30 && selectors.every(value => typeof value === 'string' && value.trim() && value.length <= 320), 'Requested mention selectors are incomplete.');
  if (!selectors.length) return [];
  const people = await projectMentionCandidates(client), selected = new Map();
  for (const selector of selectors) {
    const key = selector.toLowerCase(), matches = people.filter(person => [person.id, person.uniqueName.toLowerCase(), person.displayName.toLowerCase()].includes(key));
    requireThat(matches.length === 1, matches.length ? 'Ambiguous mention. Show project members and ask the user to choose an exact account name or identity ID.' : 'Requested mention is missing, inactive or unresolved. Ask for an exact project team member; never infer a person from BA/developer roles.');
    selected.set(matches[0].id, matches[0]);
  }
  return [...selected.values()];
}
export function verifyCommentMentions(comment, expected) {
  const mentions = comment.mentions ?? [];
  requireThat(Array.isArray(mentions) && mentions.length <= 100, 'Comment mention readback is incomplete.');
  const ids = mentions.filter(value => value.artifactType === 'person').map(value => value.targetId?.toLowerCase());
  requireThat(ids.every(adoGuid) && new Set(ids).size === ids.length && fingerprint(ids.sort()) === fingerprint(expected.map(person => person.id).sort()), 'Comment mention readback differs from the approved identities. Reconcile; never repost blindly.');
}
