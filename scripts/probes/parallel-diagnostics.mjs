// Only fixed stages, error categories and package source coordinates leave private proof logs.
const stages = ['package-snapshot', 'database-fixtures', 'batch-1', 'batch-2', 'retained-rows-1', 'retained-rows-2', 'comparison', 'package-immutability', 'fixture-cleanup', 'process-exit'];
const codes = ['ERR_ASSERTION', 'ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ELOGIN', 'EREQUEST', 'ETIMEOUT', 'ESOCKET', 'ABORT_ERR'];
const reasons = ['image-rate-limit', 'image-unavailable', 'docker-unavailable', 'disk-space', 'database-startup'];
const files = ['parallel.mjs', 'host-databases.mjs', 'parallel-live.mjs'];
const positive = value => Number.isSafeInteger(value) && value > 0;
function details(value) {
  const result = {};
  if (codes.includes(value?.code)) result.code = value.code;
  if (Number.isSafeInteger(value?.exitCode) && value.exitCode >= 0 && value.exitCode <= 255) result.exitCode = value.exitCode;
  if (reasons.includes(value?.reason)) result.reason = value.reason;
  if (files.includes(value?.location?.file) && positive(value.location.line) && positive(value.location.column)) result.location = {file: value.location.file, line: value.location.line, column: value.location.column};
  return result;
}
export function parallelDiagnostic(value) {
  if (!stages.includes(value?.stage)) return undefined;
  return {stage: value.stage, ...details(value), ...(Array.isArray(value.causes) ? {causes: value.causes.slice(0, 3).map(details)} : {})};
}
function errorDetails(error) {
  const output = `${error?.stderr ?? ''}\n${error?.message ?? ''}`;
  const reason = /toomanyrequests|too many requests|pull rate limit/i.test(output) ? 'image-rate-limit'
    : /manifest unknown|manifest.*not found|pull access denied/i.test(output) ? 'image-unavailable'
    : /cannot connect to the docker daemon|docker daemon is not running/i.test(output) ? 'docker-unavailable'
    : /no space left on device/i.test(output) ? 'disk-space'
    : /Native database startup failed\./.test(output) ? 'database-startup' : undefined;
  let location;
  for (const line of String(error?.stack ?? '').split(/\r?\n/)) {
    const match = line.match(/[/\\](parallel\.mjs|host-databases\.mjs|parallel-live\.mjs):(\d+):(\d+)\)?$/);
    if (match) {location = {file: match[1], line: Number(match[2]), column: Number(match[3])}; break;}
  }
  return details({code: error?.code, exitCode: error?.status, reason, location});
}
export function parallelFailureDiagnostic(stage, error) {
  return parallelDiagnostic({stage, ...errorDetails(error), ...(error instanceof AggregateError ? {causes: error.errors.slice(0, 3).map(errorDetails)} : {})});
}
export function parallelLogDiagnostic(output) {
  const code = output.match(/\bcode: ['"]([^'"\r\n]+)['"]/)?.[1] ?? output.match(/Error \[([A-Z_]+)\]/)?.[1];
  return parallelFailureDiagnostic('process-exit', {code, stack: output, stderr: output});
}
