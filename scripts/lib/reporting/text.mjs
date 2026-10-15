export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
export const markdownText = value => String(value).replace(/\r?\n/g, ' ').replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');
