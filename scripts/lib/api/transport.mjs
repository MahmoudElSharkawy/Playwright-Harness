import http from 'node:http';
import https from 'node:https';

/** Safe diagnostic only: never include the native error, URL, payload or credential. */
export class ApiFailure extends Error {
  constructor(classification, dispatched = false, reason = classification) { super(`API operation failed: ${reason}.`); this.classification = classification; this.dispatched = dispatched; this.reason = reason; }
}

/** One native HTTP(S) request. No redirects, cookies, proxy inheritance, implicit retries or pooled sockets. */
export function send(request, {signal, timeoutMs, maxResponseBytes}) {
  return new Promise((resolve, reject) => {
    let client, timer, dispatched = false, settled = false;
    function done(error, response) {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) { client?.destroy(); reject(error); } else resolve(response);
    }
    const fail = (classification, reason) => done(new ApiFailure(classification, dispatched, reason));
    const abort = () => fail(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
    if (signal.aborted) { abort(); return; }
    try {
      client = (request.url.protocol === 'https:' ? https : http).request(request.url, {
        method: request.method, headers: {...request.headers, ...(request.body ? {'content-length': request.body.length} : {})},
        agent: false, maxHeaderSize: 16384, rejectUnauthorized: true
      }, response => {
        const status = response.statusCode;
        if (status >= 300 && status <= 399 && status !== 304) { fail('EXECUTOR', 'REDIRECT_REFUSED'); response.destroy(); return; }
        const chunks = []; let bytes = 0;
        response.on('data', chunk => { bytes += chunk.length; if (bytes > maxResponseBytes) { fail('EXECUTOR', 'RESPONSE_LIMIT'); response.destroy(); } else chunks.push(chunk); });
        response.on('aborted', () => fail('TRANSPORT'));
        response.on('error', () => fail('TRANSPORT'));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8'); let json;
          try { json = JSON.parse(text); } catch { /* Text responses remain valid; JSON selectors remain unavailable. */ }
          done(undefined, {status, headers: response.headers, text, json, bytes});
        });
      });
      client.on('socket', socket => {
        // Once connected, be conservative: a request may have reached the peer even if no response arrived.
        socket.once(request.url.protocol === 'https:' ? 'secureConnect' : 'connect', () => { dispatched = true; });
      });
      client.on('error', () => fail('TRANSPORT'));
      signal.addEventListener('abort', abort, {once: true}); timer = setTimeout(() => fail('TIMEOUT'), timeoutMs);
      client.end(request.body);
    } catch { fail('EXECUTOR', 'INVALID_REQUEST'); }
  });
}

/** Bound resolver/storage callbacks too. Expired work cannot dispatch or publish late results. */
export async function bounded(action, signal) {
  if (signal.aborted) throw new ApiFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
  return await new Promise((resolve, reject) => {
    let ended = false;
    const finish = (error, value) => { if (ended) return; ended = true; signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(value); };
    const abort = () => finish(new ApiFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED'));
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve().then(() => { if (!ended) return action(); }).then(value => finish(undefined, value), error => finish(error));
  });
}
