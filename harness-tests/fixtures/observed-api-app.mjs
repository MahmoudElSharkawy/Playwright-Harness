import {createServer} from 'node:http';

export const observedApiSentinels = Object.freeze({email: 'capture-sentinel-person@example.test', session: 'capture-sentinel-session-119'});

/** Disposable loopback contract: client IDs reconcile uncertain creates; owner guards deletion. */
export async function observedApiFixture() {
  const orders = new Map(), requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16384) {response.writeHead(413); response.end(); return;}
      chunks.push(chunk);
    }
    let body;
    try {body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;}
    catch {response.writeHead(400); response.end(); return;}
    requests.push({method: request.method, path: url.pathname, ...(body === undefined ? {} : {body})});
    const json = (status, value) => {
      response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'});
      response.end(JSON.stringify(value));
    };
    const record = order => ({...order, customer: {email: observedApiSentinels.email}, session: observedApiSentinels.session});
    const match = /^\/api\/orders\/([A-Za-z0-9_-]+)(\/submit)?$/.exec(url.pathname);
    if (request.method === 'POST' && url.pathname === '/api/orders') {
      if (!body || !/^[A-Za-z0-9_-]{1,100}$/.test(body.id) || typeof body.owner !== 'string' || !body.owner || body.owner.length > 100 || typeof body.label !== 'string' || body.label.length > 100) return json(400, {error: 'Invalid draft'});
      if (orders.has(body.id)) return json(409, {error: 'Order already exists'});
      const order = {id: body.id, owner: body.owner, label: body.label, status: 'Draft'};
      orders.set(order.id, order); return json(201, record(order));
    }
    if (match) {
      const order = orders.get(match[1]);
      if (!order) return json(404, {error: 'Order not found'});
      if (request.method === 'GET' && !match[2]) return json(200, record(order));
      if (request.method === 'POST' && match[2]) {
        if (order.status !== 'Draft') return json(409, {error: 'Order is not a draft'});
        order.status = 'Submitted'; return json(200, record(order));
      }
      if (request.method === 'DELETE' && !match[2]) {
        if (request.headers['if-match'] !== order.owner) return json(412, {error: 'Ownership changed'});
        orders.delete(order.id); response.writeHead(204); response.end(); return;
      }
      return json(405, {error: 'Unsupported operation'});
    }
    const page = /^\/orders\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && (url.pathname === '/' || page)) {
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
      response.end(`<!doctype html><html lang="en"><head><title>Order fixture</title></head><body>
        <h1>Order fixture</h1>
        ${page ? '' : '<button id="create">Create draft</button><button id="read">Read order</button>'}
        <button id="submit">Submit order</button>${page ? '' : '<button id="delete">Delete order</button>'}
        <output id="order-id" aria-label="Order identifier"></output>
        <output id="status" aria-label="Order status">Ready</output>
        <script>
        let orderId = ${JSON.stringify(page?.[1] ?? '')}, owner;
        const status = document.querySelector('#status'), identifier = document.querySelector('#order-id');
        const show = order => {orderId = order.id; owner = order.owner; identifier.textContent = order.id; status.textContent = order.status;};
        const read = async () => {const response = await fetch('/api/orders/' + encodeURIComponent(orderId)); if (!response.ok) throw new Error('Order lookup failed'); show(await response.json());};
        const act = action => async () => {try {await action();} catch {status.textContent = 'Operation failed';}};
        document.querySelector('#submit').onclick = act(async () => {const response = await fetch('/api/orders/' + encodeURIComponent(orderId) + '/submit', {method: 'POST'}); if (!response.ok) throw new Error('Submission failed'); show(await response.json());});
        ${page ? 'read().catch(() => {status.textContent = "Order not found";});' : `
        document.querySelector('#create').onclick = act(async () => {
          const id = 'tc119-discovery-' + crypto.randomUUID(), marker = 'tc119-owner-' + crypto.randomUUID();
          const response = await fetch('/api/orders', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id, owner: marker, label: 'Synthetic discovery order'})});
          if (!response.ok) throw new Error('Draft creation failed'); show(await response.json());
        });
        document.querySelector('#read').onclick = act(read);
        document.querySelector('#delete').onclick = act(async () => {const response = await fetch('/api/orders/' + encodeURIComponent(orderId), {method: 'DELETE', headers: {'if-match': owner}}); if (response.status !== 204) throw new Error('Cleanup failed'); status.textContent = 'Deleted';});`}
        </script></body></html>`);
      return;
    }
    json(404, {error: 'Route not found'});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {origin: `http://127.0.0.1:${server.address().port}`, requests, count: () => orders.size,
    close: async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}};
}
