import {adoId} from './config.mjs';
import {requireThat} from '../execution-core/data.mjs';
import {renderComment} from '../requirements/review.mjs';
import {projectMentionCandidates, resolveTeamMentions, verifyCommentMentions} from '../requirements/mentions.mjs';

function severityIconText(text) {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, value) => {
    const point = value[0].toLowerCase() === 'x' ? Number.parseInt(value.slice(1), 16) : Number(value);
    return [128308, 128309, 128992].includes(point) ? String.fromCodePoint(point) : entity;
  });
}
function attributeQuoteKey(html) {
  const tag = /<(\/?)([a-z][a-z0-9-]*)/iy;
  const attribute = /[ \t\r\n\f]+[a-z_:][a-z0-9_.:-]*(?:[ \t\r\n\f]*=[ \t\r\n\f]*("[^"]*"|'[^']*'|[^ \t\r\n\f"'`=<>]+))?/iy;
  const startEnd = /[ \t\r\n\f]*\/?>/y, endEnd = /[ \t\r\n\f]*>/y;
  let key = '', at = 0;
  while (at < html.length) {
    const open = html.indexOf('<', at);
    if (open < 0) return key + severityIconText(html.slice(at));
    key += severityIconText(html.slice(at, open)); tag.lastIndex = open;
    const head = tag.exec(html);
    // Raw text, foreign content, comments and malformed markup retain exact comparison.
    if (!head || /^(script|style|title|textarea|xmp|iframe|noembed|noframes|noscript|plaintext|svg|math)$/i.test(head[2])) return null;
    key += head[0]; at = tag.lastIndex;
    if (!head[1]) for (;;) {
      attribute.lastIndex = at; const part = attribute.exec(html);
      if (!part) break;
      let token = part[0];
      if (part[1]) {
        const value = /^["']/.test(part[1]) ? part[1].slice(1, -1) : part[1];
        if (/^[^\x00-\x20\x7f"'`=<>]+$/.test(value)) token = token.slice(0, -part[1].length) + '"' + value + '"';
      }
      key += token; at = attribute.lastIndex;
    }
    const end = head[1] ? endEnd : startEnd; end.lastIndex = at;
    const close = end.exec(html); if (!close) return null;
    key += close[0]; at = end.lastIndex;
  }
  return key;
}
function sameCommentHtml(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  if (expected === actual) return true;
  const key = attributeQuoteKey(expected);
  return key !== null && key === attributeQuoteKey(actual);
}

export function adoComments(client, origin) {
  const url = `${origin.organizationUrl}/${encodeURIComponent(origin.project)}/_workitems/edit/${origin.storyId}`;
  return {
    revisionId: 'discussion', id: adoId, url, link: id => url + '?discussionId=' + adoId(id),
    candidates: () => projectMentionCandidates(client), resolveMentions: selectors => resolveTeamMentions(client, selectors),
    async requireDestination() {
      const project = await client.projectIdentity();
      requireThat(client.configuration.organizationUrl === origin.organizationUrl && project.id.toLowerCase() === origin.projectId.toLowerCase(), 'Comment destination differs from the originating story project.');
    },
    write(draft, state, source, mentions) {return {method: 'POST', route: `wit/workitems/${origin.storyId}/comments?format=html&api-version=7.1-preview.4`, body: {text: renderComment(draft, state, source, mentions).html}};},
    matches: (write, comment) => sameCommentHtml(write.body.text, comment.text),
    acknowledged(write, response) {
      const id = adoId(response.id ?? response.commentId);
      requireThat(response.workItemId === origin.storyId && sameCommentHtml(write.body.text, response.text), 'Comment acknowledgement mismatch.'); return id;
    },
    async verify(write, id, mentions) {
      const after = await client.read(`wit/workitems/${origin.storyId}/comments/${id}?api-version=7.1-preview.4`);
      requireThat(adoId(after.id ?? after.commentId) === id && after.workItemId === origin.storyId && sameCommentHtml(write.body.text, after.text) && !after.isDeleted, 'Comment readback mismatch.');
      verifyCommentMentions(after, mentions);
    }
  };
}
