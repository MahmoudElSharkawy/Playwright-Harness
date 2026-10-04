/** Fixed page-world DOM reader. No agent code or selectors are accepted. */
export function renderedRead(root, kind, role) {
  const gaps = new Set(), seen = new Set(), texts = []; let count = 0;
  const doc = root.ownerDocument, win = doc.defaultView;
  try {void win.top.document;} catch {gaps.add('cross-origin-frame');}
  const pruned = node => {
    for (let current = node; current; current = current.assignedSlot ?? current.parentElement ?? current.getRootNode()?.host) {
      const ancestor = current.ownerDocument.defaultView.getComputedStyle(current);
      if (ancestor.display === 'none' || Number(ancestor.opacity) === 0) return true;
    }
    return false;
  };
  const visible = node => {const style = node.ownerDocument.defaultView.getComputedStyle(node); return !pruned(node) && !['hidden', 'collapse'].includes(style.visibility) && (style.display === 'contents' || node.getClientRects().length > 0);};
  const implicitRole = node => {
    if (node.hasAttribute('role')) return node.getAttribute('role');
    if (node.localName === 'button' || node.localName === 'input' && ['button', 'submit', 'reset'].includes(node.type)) return 'button';
    if (node.localName === 'a' && node.hasAttribute('href')) return 'link';
    if (node.localName === 'input' && node.type === 'checkbox') return 'checkbox';
    if (node.localName === 'textarea' || node.localName === 'input' && ['text', 'email', 'tel', 'url'].includes(node.type) && !node.hasAttribute('list')) return 'textbox';
    return '';
  };
  const walk = (node, textVisible = true) => {
    if (seen.has(node)) return; seen.add(node);
    if (node.nodeType === 3) {if (textVisible) texts.push(node.nodeValue ?? ''); return;}
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      if (pruned(node) || ['script', 'style', 'template', 'noscript'].includes(node.localName)) return;
      const shown = visible(node);
      if (shown && node !== root && implicitRole(node) === role) count++;
      if (node.localName === 'iframe') {
        if (shown) try {const body = node.contentDocument?.body; if (!body) gaps.add('unreadable-frame'); else walk(body);} catch {gaps.add('cross-origin-frame');}
        return;
      }
      if (node.localName === 'select') {if (shown) texts.push([...node.selectedOptions].map(option => option.label).join(' ')); return;}
      if (['input', 'textarea'].includes(node.localName) || node.isContentEditable && ['page', 'region'].includes(kind)) return;
      if (node.localName === 'br') {if (shown) texts.push('\n'); return;}
      const display = node.ownerDocument.defaultView.getComputedStyle(node).display;
      const block = !['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents'].includes(display);
      if (block) texts.push('\n');
      if (node.localName === 'slot') {const assigned = node.assignedNodes(); for (const child of assigned.length ? assigned : node.childNodes) walk(child, shown); if (block) texts.push('\n'); return;}
      if (node.shadowRoot) {walk(node.shadowRoot, shown); if (block) texts.push('\n'); return;}
      for (const child of node.childNodes) walk(child, shown);
      if (block) texts.push('\n'); return;
    }
    for (const child of node.childNodes) walk(child, textVisible);
  };
  let value;
  if (gaps.size) value = null;
  else if (kind === 'url') value = doc.location.href;
  else if (kind === 'value') value = root.multiple && root.localName === 'select' ? [...root.selectedOptions].map(option => option.value) : root.value ?? '';
  else if (kind === 'focus') value = {focused: doc.activeElement === root || root.getRootNode().activeElement === root, editable: ['input', 'textarea'].includes(root.localName) || root.isContentEditable, passwordField: root.type === 'password'};
  else if (kind === 'state') {
    const disabled = root.disabled === true || root.matches(':disabled') || root.getAttribute('aria-disabled') === 'true';
    const checked = root.checked === true || root.getAttribute('aria-checked') === 'true', shown = visible(root);
    value = {disabled, enabled: !disabled, checked, unchecked: !checked, visible: shown, hidden: !shown};
  } else if (kind === 'text' && ['input', 'textarea'].includes(root.localName)) value = visible(root) ? root.value ?? '' : '';
  else {walk(root); value = kind === 'count' ? count : texts.join('').replace(/\s+/g, ' ').trim();}
  return {value, coverage: {complete: gaps.size === 0, gaps: [...gaps]}};
}

export function readTemplate(kind, role, page = false) {
  return `/* harness-read:${kind} */ ${page ? '()' : '(element)'} => (${renderedRead.toString()})(${page ? 'document.body' : 'element'}, ${JSON.stringify(kind)}, ${JSON.stringify(role ?? null)})`;
}
