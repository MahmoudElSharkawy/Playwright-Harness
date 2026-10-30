export const xrayIssueType = Object.freeze({id: '10009', name: 'Test', subtask: false});
export const xrayCreateFields = () => [
  {fieldId: 'project', name: 'Project', required: true, operations: ['set'], schema: {type: 'project'}},
  {fieldId: 'issuetype', name: 'Issue type', required: true, operations: ['set'], schema: {type: 'issuetype'}},
  {fieldId: 'summary', name: 'Summary', required: true, operations: ['set'], schema: {type: 'string'}},
  {fieldId: 'labels', name: 'Labels', required: false, operations: ['set'], schema: {type: 'array', items: 'string'}}
];
export const xrayEditMetadata = () => ({fields: Object.fromEntries(xrayCreateFields().filter(field => ['summary', 'labels'].includes(field.fieldId)).map(field => [field.fieldId, field]))});
export function xrayMetadataList(route) {
  if (route === 'issue/createmeta/DEMO/issuetypes') return [structuredClone(xrayIssueType)];
  if (route === `issue/createmeta/DEMO/issuetypes/${xrayIssueType.id}`) return xrayCreateFields();
  throw new Error(`Unexpected Xray metadata list ${route}`);
}
export const zephyrCaseSchema = (fields = []) => ({siteUrl: 'https://example.atlassian.net', project: 'DEMO', reviewedAt: '2026-10-29T00:00:00Z', fields, requiredStepFields: []});
export const zephyrRiskSchema = () => zephyrCaseSchema([{name: 'Risk', type: 'Text Field (Single Line)', required: false}]);
