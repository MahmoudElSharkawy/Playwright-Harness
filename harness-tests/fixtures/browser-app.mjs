import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';

/** Synthetic loopback fixture; authentication markers are generated, protected and discarded. */
export async function browserFixture() {
  const sessions = new Set(), counts = {logins: 0, mutations: 0}; let available = true;
  const server = createServer(async (request, response) => {
    if (!available) {request.socket.destroy(); return;}
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/login') {
      counts.logins++; const marker = randomBytes(18).toString('hex'); sessions.add(marker);
      response.writeHead(204, {'Set-Cookie': `harness-session=${marker}; HttpOnly; SameSite=Strict; Path=/`}); response.end(); return;
    }
    if (path === '/mutate') {counts.mutations++; response.writeHead(204); response.end(); return;}
    const authenticated = sessions.has(request.headers.cookie?.match(/(?:^|;\s*)harness-session=([^;]+)/)?.[1]);
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end(`<!doctype html><html><head><title>Synthetic browser fixture</title></head><body>
      <h1>${path === '/account' ? authenticated ? 'Signed in' : 'Sign in required' : 'Public fixture'}</h1>
      <button id="save">Save synthetic record</button><button id="login">Sign in</button><output id="count">${counts.mutations}</output>
      <script>document.querySelector('#save').onclick=async()=>{await fetch('/mutate',{method:'POST'});document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);};
      document.querySelector('#login').onclick=async()=>{await fetch('/login',{method:'POST'});location.href='/account';};</script>
      </body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {origin: `http://127.0.0.1:${server.address().port}`, counts,
    available: value => {available = value;}, expire: () => sessions.clear(),
    close: async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}};
}
