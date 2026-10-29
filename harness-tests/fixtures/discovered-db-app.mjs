import {createServer} from 'node:http';
import sql from 'mssql';

/** Fixture UI only: creation and owned cleanup use established DB operations. */
export async function discoveredDbFixture(target, credential) {
  const pool = await new sql.ConnectionPool({server: target.server, port: target.port, database: target.database, ...credential,
    options: {encrypt: target.encrypt, trustServerCertificate: target.trustServerCertificate}, requestTimeout: 10000}).connect();
  const server = createServer(async (request, response) => {
    const match = /^\/orders\/([A-Za-z0-9_-]+)$/.exec(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!match || !['GET', 'POST'].includes(request.method)) {response.writeHead(404); response.end(); return;}
    try {
      const query = pool.request().input('id', sql.NVarChar(100), match[1]);
      if (request.method === 'POST') {
        const result = await query.query("UPDATE m8.DiscoveredOrders SET Status=N'Submitted' WHERE Id=@id AND Status=N'Draft'");
        response.writeHead(result.rowsAffected[0] === 1 ? 200 : 409); response.end(); return;
      }
      const order = (await query.query('SELECT Id,Status FROM m8.DiscoveredOrders WHERE Id=@id')).recordset[0];
      if (!order) {response.writeHead(404); response.end(); return;}
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
      response.end(`<!doctype html><html lang="en"><head><title>Order fixture</title></head><body>
        <h1>Order fixture</h1><button id="submit">Submit order</button>
        <output id="order-id" aria-label="Order identifier"></output><output id="status" aria-label="Order status"></output>
        <script>const order=${JSON.stringify(order)};document.querySelector('#order-id').textContent=order.Id;document.querySelector('#status').textContent=order.Status;
        document.querySelector('#submit').onclick=async()=>{const result=await fetch(location.pathname,{method:'POST'});document.querySelector('#status').textContent=result.ok?'Submitted':'Submission failed';};</script>
        </body></html>`);
    } catch {response.writeHead(500); response.end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {origin: `http://127.0.0.1:${server.address().port}`, count: async () => (await pool.request().query('SELECT COUNT(*) AS count FROM m8.DiscoveredOrders')).recordset[0].count,
    close: async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.close();}};
}
