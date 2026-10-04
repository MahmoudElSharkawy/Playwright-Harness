// Static assets only: report data is escaped into HTML, never interpolated into script.
export const REPORT_STYLES = String.raw`
:root{color-scheme:light;--ink:#172337;--muted:#526176;--line:#dce3ed;--accent:#2454ba;--surface:#fff;--background:#f5f7fb}

*{box-sizing:border-box}
html{scroll-padding-top:20px}
body{margin:0;background:var(--background);color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1220px;margin:0 auto;padding:36px 28px 56px}
a{color:var(--accent);text-underline-offset:3px}
button,input,select{font:inherit}
button,select,input{min-height:44px}
button{cursor:pointer}
button:disabled{cursor:default;opacity:.55}
a,button,summary,input,select{touch-action:manipulation}
:focus-visible{outline:3px solid #3563cf;outline-offset:3px}
a,code,p,dd,h1,h2,h3,h4,summary{overflow-wrap:anywhere}
[hidden]{display:none!important}
h1,h2,h3,h4,p{margin-top:0}
h1{font-size:clamp(25px,3vw,34px);line-height:1.2;letter-spacing:-.035em;margin-bottom:14px}
h2{font-size:20px;letter-spacing:-.02em;margin-bottom:4px}
h3{font-size:16px;margin-bottom:12px}
h4{font-size:15px;margin-bottom:8px}
p{margin-bottom:12px}
.muted,.scope{color:var(--muted)}
.small,.scope{font-size:13px}
.eyebrow{color:var(--accent);font-size:12px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px}
.report-header{margin-bottom:24px}
.execution-id{font-size:12px;color:var(--muted);margin-bottom:8px}
.execution-id code{color:var(--ink)}
.metadata{display:flex;flex-wrap:wrap;gap:8px 24px;font-size:13px;color:var(--muted)}
.navigation{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.navigation a{display:inline-flex;align-items:center;min-height:40px;padding:7px 13px;background:white;border:1px solid var(--line);border-radius:7px;text-decoration:none;font-weight:600;font-size:13px}
.navigation a:hover{border-color:var(--accent)}
.section{margin-top:24px}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:20px}
.overview-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(330px,1fr);gap:16px}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.metric{min-width:0}
.metric dt{font-size:12px;font-weight:650;color:var(--muted);margin-bottom:6px}
.metric dd{font-size:32px;font-weight:750;line-height:1.1;margin:0;letter-spacing:-.035em}
.metric.pass dd{color:#12613d}
.metric.fail dd{color:#aa2638}
.metric.rate dd{color:var(--accent)}
dl{margin:0}
.secondary-metrics{display:flex;gap:10px 18px;flex-wrap:wrap;margin-top:20px;padding-top:14px;border-top:1px solid var(--line);font-size:13px}
.secondary-metrics strong{color:var(--ink)}
.secondary-metrics a{font-weight:600}
.chart-panel{display:flex;align-items:center;gap:18px}
.donut{width:132px;height:132px;flex-shrink:0}
.donut text{font-family:inherit;fill:var(--ink)}
.donut .chart-number{font-size:19px;font-weight:750}
.donut .chart-caption{font-size:9px;fill:var(--muted)}
.chart-content{min-width:0;flex:1}
.chart-content h3{margin-bottom:6px;font-size:14px}
.legend{padding:0;margin:0;list-style:none}
.legend li{display:grid;grid-template-columns:9px minmax(0,1fr) auto auto;align-items:center;gap:8px;font-size:12px;margin-top:5px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--outcome-color)}
.legend strong{white-space:nowrap}
.legend-percent{font-weight:400;color:var(--muted);margin-left:4px}
.legend-filter{min-height:32px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--accent);padding:3px 6px;font-size:12px}
.legend-filter:hover,.legend-filter[aria-pressed=true]{border-color:#9eb4e5;background:#edf3ff}
.overview-note{margin:10px 0 0}
.empty{text-align:center;padding:28px 18px;color:var(--muted)}
.attention-list{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.attention-item{padding:16px 18px;border:1px solid #edc9ce;border-left:4px solid #aa2638;border-radius:8px;background:#fff}
.attention-item.review{border-color:#ecd9af;border-left-color:#975206}
.attention-title{display:flex;align-items:flex-start;gap:10px;font-weight:650;margin-bottom:8px}
.attention-title a{flex:1}
.attention-reason{margin:0;font-size:14px}
.attention-item .scope{margin:8px 0 0}
.badge{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:3px 8px;max-width:100%;font-size:11px;font-weight:750;letter-spacing:.02em;border-radius:5px;background:#eef1f6;color:#526176;line-height:1.5;white-space:normal}
.badge.pass{background:#e8f5ed;color:#12613d}
.badge.fail,.badge.integrity{background:#fff0f2;color:#aa2638}
.badge.review,.badge.blocked{background:#fff3d9;color:#875006}
.badge.neutral{background:#edf2f8;color:#46556c}
.toolbar{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,.42fr) minmax(155px,.42fr) auto;gap:12px;align-items:end;padding:16px;margin-bottom:12px}
.control label{display:block;font-size:12px;font-weight:650;color:var(--muted);margin-bottom:5px}
.control input,.control select{width:100%;min-width:0;border:1px solid #bec9da;border-radius:6px;background:white;color:var(--ink);padding:9px 10px}
.button{border:1px solid #bec9da;border-radius:6px;background:white;color:var(--accent);padding:9px 12px;font-weight:600;font-size:13px}
.button:hover{background:#edf3ff}
.result-meta{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:13px}
.result-meta p{margin:0}
.active-filters{padding:4px 8px;border-radius:5px;color:#224caa;background:#edf3ff;font-size:12px}
.case-list{display:grid;gap:8px}
details>summary{cursor:pointer}
summary::-webkit-details-marker{display:none}
.case-row{border:1px solid var(--line);border-radius:8px;background:white;min-width:0}
.case-row>summary{display:grid;grid-template-columns:90px minmax(0,1fr) minmax(160px,.38fr) 70px;gap:16px;align-items:center;list-style:none;padding:15px 18px;min-height:80px}
.case-row>summary:hover{background:#f8faff;border-radius:8px}
.case-title{display:block;font-size:14px;font-weight:650;line-height:1.45}
.case-identifiers{display:flex;flex-wrap:wrap;align-items:center;gap:5px 12px;color:var(--muted);font-size:12px;margin-top:4px}
.case-methods{font-size:12px;color:var(--muted);line-height:1.55}
.case-action{display:flex;gap:8px;align-items:center;justify-content:flex-end;color:var(--accent);font-size:12px;font-weight:600}
.chevron{display:inline-block;transition:transform .15s;line-height:1;font-size:18px}
.case-row[open]>summary .chevron{transform:rotate(90deg)}
.case-row[open]>summary{border-bottom:1px solid var(--line)}
.case-body{padding:20px;min-width:0}
.case-context{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.case-context p{margin:0}
.run-details{border:1px solid var(--line);border-radius:7px;margin-top:10px;min-width:0}
.run-details>summary{padding:12px 14px;list-style:none;background:#f8faff;border-radius:7px}
.run-heading{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;font-weight:650}
.run-id{display:block;font-size:11px;color:var(--muted);margin-top:5px}
.run-body{padding:16px;min-width:0}
.run-links{display:flex;gap:12px;flex-wrap:wrap;font-size:13px;margin-bottom:14px}
.assertion{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}
.assertion>summary{list-style:none;display:flex;align-items:flex-start;gap:8px;padding:5px 0;min-height:38px;font-size:13px}
.assertion-title{font-weight:600;flex:1}
.method-label{font-size:11px;color:var(--muted);padding:3px 0}
.assertion-body{padding:12px 0 4px}
.evidence-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:12px}
.evidence-field{padding:12px;background:#f7f9fc;border-radius:6px;min-width:0}
.evidence-field dt,.comparison dt{font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.035em;margin-bottom:5px}
.evidence-field dd,.comparison dd{margin:0;font-size:13px;overflow-wrap:anywhere;white-space:pre-wrap}
.evidence-field.actual{border-left:3px solid var(--line)}
.assertion.fail .evidence-field.actual{border-left-color:#aa2638;background:#fff5f6}
.comparison{padding:12px;border:1px solid var(--line);border-radius:6px;margin-bottom:10px;min-width:0}
.comparison-heading{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;font-size:12px}
.comparison dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.comparison .wide{grid-column:1/-1}
.evidence-ids{font-size:11px;margin:10px 0}
.evidence-ids code{font-size:11px}
.evidence-ids ul{padding-left:18px;margin:6px 0}
.raw{margin-top:10px;border:1px solid var(--line);border-radius:6px;min-width:0}
.raw>summary{padding:9px 12px;font-size:12px;min-height:40px}
.raw pre{font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:420px;padding:12px;margin:0;border-top:1px solid var(--line);background:#f7f9fc}
.run-section{margin-top:18px;border-top:1px solid var(--line);padding-top:14px}
.run-section h4{margin-bottom:7px}
.diagnostic-list{list-style:none;padding:0;margin:10px 0}
.diagnostic-item{border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin-top:7px;font-size:12px;min-width:0}
.diagnostic-heading{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.diagnostic-message{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.diagnostic-item dl{margin-top:6px;font-size:11px;color:var(--muted)}
.diagnostic-item dt{display:inline;font-weight:650}
.diagnostic-item dd{display:inline;margin:0 12px 0 4px;overflow-wrap:anywhere}
.cleanup-summary{font-size:13px}
.screenshot-links{font-size:12px;padding-left:18px}
.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.screenshot{margin:0;padding:12px;background:white;border:1px solid var(--line);border-radius:8px;min-width:0}
.image-disclosure>summary{list-style:none;font-size:12px;color:var(--accent);font-weight:600}
.image-disclosure img{display:block;width:100%;height:150px;object-fit:contain;background:#f5f7fb;border:1px solid var(--line);border-radius:4px;margin-bottom:8px}
.image-disclosure[open] img{height:auto}
.screenshot figcaption{font-size:11px;color:var(--muted);margin-top:10px}
.screenshot figcaption p{margin-bottom:6px}
.screenshot .button{margin-top:8px;width:100%}
dialog{max-width:min(1100px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:16px;border:1px solid var(--line);border-radius:10px;color:var(--ink)}
dialog::backdrop{background:rgb(16 28 49 / .65)}
.preview-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.preview-header h2{font-size:16px;margin:0}
#preview-image{display:block;max-width:100%;height:auto;max-height:calc(100dvh - 110px);object-fit:contain;margin:auto}
.supporting{margin-top:24px}
.supporting>summary{font-size:14px;font-weight:600;padding:12px}
.supporting-body{padding:0 12px 12px}
.notice{padding:12px 16px;margin-top:16px;background:#edf3ff;border:1px solid #c5d4f2;border-radius:7px;font-size:12px}
.footer{margin-top:28px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:16px}

@media(max-width:950px){.overview-grid{grid-template-columns:minmax(0,1fr)}
.chart-panel{gap:24px}
.chart-content{max-width:420px}
.case-row>summary{grid-template-columns:75px minmax(0,1fr) minmax(130px,.36fr) 60px;gap:12px}
.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}
}

@media(max-width:600px){main{padding:22px 14px 36px}
.report-header{margin-bottom:20px}
.panel{padding:16px}
.overview-grid{gap:10px}
.metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 16px}
.metric dd{font-size:30px}
.chart-panel{gap:12px}
.donut{width:108px;height:108px}
.legend li{gap:6px;font-size:11px}
.legend-filter{min-height:44px;padding:4px}
.toolbar{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:12px}
.control.search{grid-column:1/-1}
.toolbar .clear{grid-column:1/-1}
.case-row>summary{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;padding:14px;align-items:start}
.case-row>summary>.badge{justify-self:start}
.case-main{grid-column:1/-1;grid-row:2}
.case-methods{grid-column:1/-1;grid-row:3}
.case-action{grid-column:2;grid-row:1;min-height:28px}
.case-body{padding:14px}
.run-body{padding:12px}
.assertion>summary{flex-wrap:wrap}
.assertion-title{min-width:65%}
.method-label{margin-left:0}
.evidence-fields,.comparison dl{grid-template-columns:minmax(0,1fr)}
.comparison .wide{grid-column:auto}
.attention-item{padding:14px}
.attention-title{flex-wrap:wrap}
.attention-title a{flex-basis:100%}
.gallery{grid-template-columns:minmax(0,1fr)}
.screenshot{padding:12px}
.screenshot img{height:160px}
.secondary-metrics{gap:8px 14px}
.raw pre{max-height:300px}
.section{margin-top:20px}
.footer{font-size:11px}
}

@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}
}

@media print{body{background:white}
main{padding:0}
.toolbar,.legend-filter,.case-action,dialog,.screenshot .button{display:none!important}
.case-row,.panel,.attention-item{break-inside:avoid}
.case-row>summary{background:white}
}

`;

export const REPORT_SCRIPT = String.raw`
(() => {
  'use strict';
  const rows = Array.from(document.querySelectorAll('[data-case]'));
  const search = document.getElementById('case-search');
  const status = document.getElementById('status-filter');
  const sort = document.getElementById('case-sort');
  const list = document.getElementById('case-list');
  const clear = document.getElementById('clear-filters');
  const legend = Array.from(document.querySelectorAll('[data-filter-status]'));
  function update() {
    if (!search) return;
    const query = search.value.trim().toLowerCase();
    let count = 0;
    for (const row of rows) {
      row.hidden = !(row.dataset.search.toLowerCase().includes(query) && (!status.value || row.dataset.status === status.value));
      if (!row.hidden) count++;
    }
    const ordered = rows.slice().sort((left, right) => {
      const original = Number(left.dataset.order) - Number(right.dataset.order);
      if (sort.value === 'status') return Number(left.dataset.rank) - Number(right.dataset.rank) || original;
      if (sort.value === 'title') return left.dataset.title.localeCompare(right.dataset.title, undefined, {sensitivity:'base', numeric:true}) || original;
      return original;
    });
    for (const row of ordered) list.append(row);
    document.getElementById('result-count').textContent = 'Showing ' + count + ' of ' + rows.length + ' test cases';
    document.getElementById('no-results').hidden = count !== 0;
    const active = document.getElementById('active-filters');
    active.hidden = !query && !status.value;
    active.textContent = [query ? 'Search: ' + search.value.trim() : '', status.value ? 'Outcome: ' + status.options[status.selectedIndex].text : ''].filter(Boolean).join(' · ');
    clear.disabled = !query && !status.value;
    for (const button of legend) button.setAttribute('aria-pressed', String(button.dataset.filterStatus === status.value));
  }
  function reset() { if (search) { search.value = ''; status.value = ''; update(); } }
  if (search) {
    document.getElementById('result-controls').hidden = false;
    search.addEventListener('input', update);
    status.addEventListener('change', update);
    sort.addEventListener('change', update);
    clear.addEventListener('click', reset);
    for (const button of legend) {
      button.hidden = false;
      button.addEventListener('click', () => { status.value = status.value === button.dataset.filterStatus ? '' : button.dataset.filterStatus; update(); });
    }
    update();
  }
  function reveal(id, focus) {
    const target = document.getElementById(id);
    if (!target) return;
    const row = target.closest('[data-case]');
    if (row && row.hidden) reset();
    for (let element = target; element; element = element.parentElement) if (element.tagName === 'DETAILS') element.open = true;
    if (focus) {
      const control = target.tagName === 'DETAILS' ? target.querySelector('summary') : target;
      control.focus({preventScroll:true});
      target.scrollIntoView({block:'start'});
    }
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-reveal]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const id = link.getAttribute('href').slice(1);
    reveal(id, true);
    window.location.hash = id;
  });
  const revealHash = () => { try { reveal(decodeURIComponent(window.location.hash.slice(1)), false); } catch {} };
  window.addEventListener('hashchange', revealHash);
  revealHash();
  const dialog = document.getElementById('screenshot-dialog');
  if (dialog && typeof dialog.showModal === 'function') {
    let opener = null;
    const preview = document.getElementById('preview-image');
    for (const button of document.querySelectorAll('[data-enlarge]')) {
      button.hidden = false;
      button.addEventListener('click', () => {
        const image = document.getElementById(button.dataset.enlarge);
        opener = button;
        preview.src = image.src;
        preview.alt = image.alt;
        dialog.showModal();
        document.getElementById('close-preview').focus();
      });
    }
    document.getElementById('close-preview').addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(element => !element.disabled && element.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    });
    dialog.addEventListener('close', () => { preview.removeAttribute('src'); if (opener) opener.focus(); });
  }
})();
`;
