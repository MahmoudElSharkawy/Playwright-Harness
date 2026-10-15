export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
export const markdownText = value => String(value).replace(/\r?\n/g, ' ').replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');
export const stageLabel = value => ({SOURCE: 'Source review', REFINE: 'Preparation', EXPLORE: 'Exploration', PREPARE: 'Preparation', AUTHOR: 'Automation', REVIEW: 'Review', VERIFY: 'Verification', EXECUTE: 'Execution'}[String(value).split(' · ')[0]] ?? 'Review');
export const caseReason = value => String(value ?? '').replace(/^(\d+) native assertion(?:\(s\)|s)? failed(?: \([^)]+\))?\./, '$1 check(s) failed.');
