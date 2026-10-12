import {createServer} from 'node:http';

/** Read-only synthetic orders; the audit proves search scope and pagination use. */
export async function listSearchFixture() {
  const orders = [
    {number: 'ORD-100', customer: 'C-100', status: 'Pending'},
    {number: 'ORD-200', customer: 'C-200', status: 'Pending'},
    {number: 'ORD-3000', customer: 'C-3000', status: 'Pending'},
    {number: 'ORD-300', customer: 'C-300', status: 'Shipped'},
    {number: 'ORD-DUP', customer: 'C-401', status: 'Paid'},
    {number: 'ORD-DUP', customer: 'C-402', status: 'Pending'},
    {number: 'ORD-DUP', customer: 'C-402', status: 'Pending'},
    {number: "ORD-'[.*]", customer: 'C-500', status: 'Paid'},
  ];
  const audit = [];
  let scope = 'all-accessible';
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/orders') {
      const query = url.searchParams.get('query') ?? '', page = Number(url.searchParams.get('page') ?? 1);
      const searchable = scope === 'current-page' ? orders.slice(0, 2) : orders;
      const matches = searchable.filter(order => order.number.includes(query));
      audit.push({kind: 'list', query, page, scope});
      // Delayed application refresh, not test synchronization; stale rows remain meanwhile.
      await new Promise(resolve => setTimeout(resolve, 80));
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({orders: query ? matches : matches.slice((page - 1) * 2, page * 2), total: matches.length}));
      return;
    }
    if (url.pathname === '/open') {
      audit.push({kind: 'open', number: url.searchParams.get('number'), customer: url.searchParams.get('customer')});
      response.writeHead(204); response.end(); return;
    }
    if (url.pathname !== '/orders') {response.writeHead(404); response.end(); return;}
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(`<!doctype html><html><head><title>Orders</title></head><body>
      <form id="search-form"><input id="order-search" aria-label="Order search"><button id="search-orders">Search</button></form>
      <output id="search-complete" hidden></output><output id="page-number"></output>
      <table id="orders-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Action</th></tr></thead><tbody></tbody></table>
      <button id="next-orders">Next page</button>
      <section id="opened-order" hidden><output id="opened-number"></output><output id="opened-customer"></output></section>
      <script>
        const input = document.querySelector('#order-search'), search = document.querySelector('#search-orders');
        const complete = document.querySelector('#search-complete'), next = document.querySelector('#next-orders');
        const body = document.querySelector('tbody'); let query = '', pageNumber = 1;
        async function refresh() {
          complete.hidden = true; search.disabled = true; next.disabled = true;
          const data = await (await fetch('/api/orders?' + new URLSearchParams({query, page: pageNumber}))).json();
          body.replaceChildren();
          for (const order of data.orders) {
            const row = document.createElement('tr');
            for (const [field, attribute] of [['number', 'order-number'], ['customer', 'customer'], ['status', 'status']]) {
              const cell = row.insertCell(); cell.dataset.qa = attribute; cell.textContent = order[field];
            }
            const open = document.createElement('button'); open.dataset.qa = 'open-order'; open.textContent = 'Open';
            open.onclick = async () => {
              await fetch('/open?' + new URLSearchParams({number: order.number, customer: order.customer}));
              document.querySelector('#opened-number').textContent = order.number;
              document.querySelector('#opened-customer').textContent = order.customer;
              document.querySelector('#opened-order').hidden = false;
            };
            row.insertCell().append(open); body.append(row);
          }
          document.querySelector('#page-number').textContent = String(pageNumber);
          complete.textContent = query; complete.hidden = false; search.disabled = false;
          next.disabled = Boolean(query) || pageNumber * 2 >= data.total;
        }
        document.querySelector('#search-form').onsubmit = event => {event.preventDefault(); query = input.value; pageNumber = 1; refresh();};
        next.onclick = () => {pageNumber++; refresh();}; refresh();
      </script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {origin: `http://127.0.0.1:${server.address().port}`, audit,
    setScope: value => {scope = value;},
    close: async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}};
}
