import {data, requireThat} from '../execution-core/data.mjs';

const types = {
  'Checkbox': {type: 'boolean'}, 'Date Picker': {type: 'date'}, 'Decimal Number': {type: 'number'}, 'Number': {type: 'integer'},
  'Select List (Multi-Choice)': {type: 'array', items: 'string'}, 'Select List (Single Choice)': {type: 'string'},
  'Text Field (Multi-Line)': {type: 'string'}, 'Text Field (Single Line)': {type: 'string'}, 'User Picker': {type: 'string'}
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);

/** Zephyr Cloud exposes values, not definitions: require the administrator's complete reviewed snapshot. */
export function validateZephyrCaseFieldSchema(value, config) {
  requireThat(object(value) && Object.keys(value).every(key => ['siteUrl', 'project', 'reviewedAt', 'fields', 'requiredStepFields'].includes(key)), 'Zephyr case mutations require a complete administrator-reviewed case field schema.');
  requireThat(value.siteUrl === config.siteUrl && value.project === config.project, 'Zephyr case field schema must match the selected Jira site and project.');
  requireThat(typeof value.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.reviewedAt)
    && Number.isFinite(Date.parse(value.reviewedAt)) && new Date(value.reviewedAt).toISOString() === value.reviewedAt.replace(/(?<!\.\d{3})Z$/, '.000Z'), 'Zephyr case field schema needs an ISO reviewedAt timestamp.');
  requireThat(Array.isArray(value.fields) && value.fields.length <= 100 && new Set(value.fields.map(field => field?.name)).size === value.fields.length
    && value.fields.every(field => object(field) && Object.keys(field).every(key => ['name', 'type', 'required', 'allowedValues'].includes(key))
      && name(field.name) && Object.hasOwn(types, field.type) && typeof field.required === 'boolean'), 'Zephyr case field schema needs distinct named fields, supported native types and explicit required flags.');
  requireThat(Array.isArray(value.requiredStepFields) && value.requiredStepFields.length <= 100 && value.requiredStepFields.every(name)
    && new Set(value.requiredStepFields).size === value.requiredStepFields.length, 'Zephyr case field schema must list all required step field names, including an explicit empty list.');
  const fields = value.fields.map(field => {
    const select = field.type.startsWith('Select List');
    requireThat(select ? Array.isArray(field.allowedValues) && field.allowedValues.length <= 1000 && field.allowedValues.every(name) && new Set(field.allowedValues).size === field.allowedValues.length
      : field.allowedValues === undefined, `Zephyr field ${field.name} needs its complete native choice list only when it is a select field.`);
    return {fieldId: field.name, name: field.name, required: field.required, hasDefaultValue: false, operations: ['set'], schema: types[field.type],
      ...(select ? {allowedValues: field.allowedValues} : {})};
  });
  return {schema: data(value, 1024 * 1024), fields: data(fields, 1024 * 1024)};
}
