/** Recognize only absent metadata or known empty ADO containers; never infer emptiness from a partial parse. */
export function emptyAdoMetadata(value, container) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== 'string') return false;
  if (!value.trim()) return true;
  const xml = value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (!['parameters', 'NewDataSet'].includes(container)) return false;
  const space = '[ \\t\\r\\n]';
  return new RegExp(`^<${container}${space}*/>$|^<${container}${space}*>${space}*</${container}${space}*>$`).test(xml);
}
