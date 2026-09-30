import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';

/** Synthetic loopback application. No production targets, accounts or credentials. */
export async function startFixture() {
  const sessions=new Set(),counts={logins:0,deadlineEntered:0};
  const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    const session=request.headers.cookie?.match(/(?:^|;\s*)m4-session=([^;]+)/)?.[1];
    const authenticated=sessions.has(session);
    const html=body=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(`<!doctype html><html><head><title>M4 synthetic fixture</title></head><body>${body}</body></html>`);};
    if(url.pathname==='/login' && request.method==='POST') {
      for await(const _ of request){} // The label is intentionally stored in the browser only.
      counts.logins++;
      const marker=randomBytes(18).toString('hex');sessions.add(marker);
      response.writeHead(204,{'Set-Cookie':`m4-session=${marker}; HttpOnly; SameSite=Strict; Path=/`});response.end();return;
    }
    if(url.pathname==='/expire') {sessions.delete(session);html('<h1>Fixture session expired</h1>');return;}
    if(url.pathname==='/deadline-entered') {counts.deadlineEntered++;html('<h1>Deadline probe entered</h1>');return;}
    if(url.pathname==='/slow') {request.on('close',()=>{});return;}
    if(url.pathname==='/dashboard') {
      html(authenticated?'<h1>Authenticated fixture</h1><p id="label"></p><script>document.querySelector("#label").textContent=localStorage.getItem("m4-label")||"missing label";</script>':'<h1>Sign in required</h1>');return;
    }
    html(`<h1>Public fixture</h1><p id="query">${escape(url.search)}</p>
      <label>Account label <input id="account" aria-label="Account label"></label>
      <button id="signin" type="button">Sign in</button>
      <button id="increment" type="button">Increment counter</button><output id="count">0</output>
      <script>
      document.querySelector('#increment').onclick=()=>{document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);console.log('Synthetic counter changed');};
      document.querySelector('#signin').onclick=async()=>{const label=document.querySelector('#account').value;await fetch('/login',{method:'POST',body:new URLSearchParams({label})});localStorage.setItem('m4-label',label);location.href='/dashboard';};
      </script>`);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:`http://127.0.0.1:${server.address().port}`,counts,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
