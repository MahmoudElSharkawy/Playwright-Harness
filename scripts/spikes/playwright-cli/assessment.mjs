/** M4-only assessment. Not a harness executor or a browser command API. */
export const requiredChecks=['version-pin','named-session-isolation','state-restore-actual-session','snapshot-current-reference','evidence-capture','native-error-exit','native-timeout','outer-deadline','daemon-crash','stale-authentication','owned-cleanup','package-immutable'];
export const pin={cli:'0.1.22',playwright:'1.64.0-alpha-1790635538000'};

export function classifyReply(reply) {
  if(!reply || typeof reply!=='object')return {kind:'INVALID_RESPONSE'};
  if(reply.timedOut)return {kind:'TIMEOUT'};
  if(reply.spawnError)return {kind:'PROCESS_FAILURE'};
  let payload;try {payload=JSON.parse(reply.stdout);}catch {}
  if(payload && typeof payload==='object' && !Array.isArray(payload) && (payload.isError===true || typeof payload.error==='string'))return {kind:'CLI_ERROR',payload};
  if(reply.exitCode!==0)return {kind:'PROCESS_FAILURE',payload};
  if(!payload || typeof payload!=='object' || Array.isArray(payload))return {kind:'INVALID_RESPONSE'};
  return {kind:'OK',payload};
}

export function assessProbe(report) {
  const checks=Array.isArray(report?.checks)?report.checks:[];
  const names=checks.map(check=>check?.name);
  const complete=names.length===requiredChecks.length && new Set(names).size===requiredChecks.length && requiredChecks.every(name=>names.includes(name));
  const validPin=report?.pin?.cli===pin.cli && report?.pin?.playwright===pin.playwright && /^[a-f0-9]{64}$/.test(report?.pin?.lockSha256??'');
  const events=Array.isArray(report?.events)?report.events:[];
  const wellFormed=events.length>0 && events.every((event,index)=>event?.number===index+1 && typeof event.command==='string' && /^[a-z-]+$/.test(event.command) && Number.isInteger(event.durationMs) && event.durationMs>=0 && ['OK','CLI_ERROR','PROCESS_FAILURE','TIMEOUT'].includes(event.kind) && (event.exitCode===null || (Number.isInteger(event.exitCode) && event.exitCode>=0)) && (event.kind!=='OK' || event.exitCode===0) && (!['PROCESS_FAILURE','TIMEOUT'].includes(event.kind) || event.exitCode!==0));
  // These are coverage requirements of this fixed experiment, not a browser API.
  const successes=['open','goto','snapshot','click','eval','fill','state-save','state-load','tracing-start','tracing-stop','screenshot','console','requests','close','delete-data'];
  const nativeFailure=command=>events.some(event=>event?.command===command && ['CLI_ERROR','PROCESS_FAILURE'].includes(event.kind) && event.exitCode!==0);
  const validHistory=wellFormed && successes.every(command=>events.some(event=>event.command===command && event.kind==='OK')) && ['not-a-command','click','eval','snapshot','goto'].every(nativeFailure) && events.some(event=>event.command==='run-code' && event.kind==='TIMEOUT');
  const cleanup=report?.cleanup;
  const validCleanup=cleanup?.attemptedNames===5 && cleanup.recordedTrees===5 && cleanup.processTreesStopped===true && cleanup.authenticationStateRemoved===true && cleanup.fixtureClosed===true && cleanup.failures===0 && cleanup.faultInjection===null;
  const passed=complete && validPin && validHistory && validCleanup && checks.every(check=>check.status==='PASS' && typeof check.observation==='string' && check.observation.length>0);
  return {status:passed?'PASS':'INCOMPLETE',checks:names.length,passed:checks.filter(check=>check?.status==='PASS').length,validPin,validHistory,validCleanup};
}

export function assessPlatforms(reports) {
  if(!Array.isArray(reports))reports=[];
  reports=reports.filter(report=>report && typeof report==='object');
  const platformSet=new Set(reports.map(report=>report.platform));
  const complete=reports.length===2 && platformSet.size===2 && platformSet.has('win32') && platformSet.has('linux') && reports.every(report=>assessProbe(report).status==='PASS');
  const samePin=reports.length===2 && reports.every(report=>assessProbe(report).validPin) && reports[0].pin.lockSha256===reports[1].pin.lockSha256;
  return {status:complete&&samePin?'PASS':'INCOMPLETE',platforms:[...platformSet].sort(),samePin};
}
