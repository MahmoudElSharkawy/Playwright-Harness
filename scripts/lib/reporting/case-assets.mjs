// Static assets only: report data is escaped into HTML, never interpolated into script.
export const REPORT_STYLES = String.raw`
:root{color-scheme:light;--background:#F4F6F5;--surface:#FFFFFF;--surface2:#ECF0EE;--line:#D9E0DD;--ink:#1A2427;--muted:#5D6B6E;--accent:#0B7A75;--accent-bg:rgba(11,122,117,.10);--ok:#2E7D46;--ok-bg:rgba(46,125,70,.12);--warn:#A66A08;--warn-bg:rgba(166,106,8,.12);--crit:#B3372F;--crit-bg:rgba(179,55,47,.10);--todo:#69787C;--todo-bg:rgba(105,120,124,.12);--fold:#6B4FA3;--fold-bg:rgba(107,79,163,.12)}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;--background:#0F1516;--surface:#161D1D;--surface2:#1C2424;--line:#293332;--ink:#E4EBE9;--muted:#93A3A0;--accent:#41B8AE;--accent-bg:rgba(65,184,174,.14);--ok:#57B87A;--ok-bg:rgba(87,184,122,.14);--warn:#D89B33;--warn-bg:rgba(216,155,51,.14);--crit:#E0705F;--crit-bg:rgba(224,112,95,.13);--todo:#87999D;--todo-bg:rgba(135,153,157,.14);--fold:#A78BD9;--fold-bg:rgba(167,139,217,.14)}}
:root[data-theme=dark]{color-scheme:dark;--background:#0F1516;--surface:#161D1D;--surface2:#1C2424;--line:#293332;--ink:#E4EBE9;--muted:#93A3A0;--accent:#41B8AE;--accent-bg:rgba(65,184,174,.14);--ok:#57B87A;--ok-bg:rgba(87,184,122,.14);--warn:#D89B33;--warn-bg:rgba(216,155,51,.14);--crit:#E0705F;--crit-bg:rgba(224,112,95,.13);--todo:#87999D;--todo-bg:rgba(135,153,157,.14);--fold:#A78BD9;--fold-bg:rgba(167,139,217,.14)}

*{box-sizing:border-box}
html{scroll-padding-top:20px}
body{margin:0;background:var(--background);color:var(--ink);font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 20px 56px}
a{color:var(--accent);text-underline-offset:3px}
button,input,select{font:inherit}
button,select,input:not([type=checkbox]){min-height:38px}
button{cursor:pointer}
button:disabled{cursor:default;opacity:.55}
a,button,summary,input,select{touch-action:manipulation}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
summary:focus-visible{outline-offset:-3px}
a,code,p,dd,h1,h2,h3,h4,summary{overflow-wrap:anywhere}
[hidden]{display:none!important}
h1,h2,h3,h4,p{margin-top:0}
h1{font-size:20px;line-height:1.3;letter-spacing:-.01em;margin-bottom:10px}
h2{font-size:15px;letter-spacing:.02em;margin-bottom:4px}
h3{font-size:16px;margin-bottom:12px}
h4{font-size:15px;margin-bottom:8px}
p{margin-bottom:12px}
.muted,.scope{color:var(--muted)}
.small,.scope{font-size:13px}
.eyebrow{color:var(--accent);font-size:12px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px}
.report-header{margin-bottom:24px}
.report-heading{position:relative;padding-right:48px}
.theme-toggle{position:absolute;top:0;right:0;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:6px;border:0;border-radius:50%;background:transparent;color:var(--ink);cursor:pointer}
.theme-toggle:hover{background:var(--surface2);color:var(--accent)}
.theme-toggle:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.theme-toggle svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.theme-toggle .icon-sun,.theme-toggle[data-next-theme=light] .icon-moon{display:none}
.theme-toggle[data-next-theme=light] .icon-sun{display:block}
.execution-id{font-size:12px;color:var(--muted);margin-bottom:8px}
.execution-id code{color:var(--ink)}
.metadata{display:flex;flex-wrap:wrap;gap:8px 24px;font-size:13px;color:var(--muted)}
.navigation{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.navigation a{display:inline-flex;align-items:center;min-height:40px;padding:7px 13px;background:var(--surface);border:1px solid var(--line);border-radius:7px;text-decoration:none;font-weight:600;font-size:13px}
.navigation a:hover{border-color:var(--accent)}
.section{margin-top:24px}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:20px}
.overview-grid{display:flex;align-items:center;flex-wrap:wrap;gap:24px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px 24px}
.overview-grid>.panel{border:0;padding:0;background:transparent;min-width:0;flex:1 1 300px}
.overview-grid>.panel:first-child{order:2}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.metric{min-width:0}
.metric dt{font-size:12px;font-weight:650;color:var(--muted);margin-bottom:6px}
.metric dd{font-size:25px;font-weight:700;line-height:1.1;margin:0;letter-spacing:-.025em}
.metric.pass dd{color:var(--ok)}
.metric.fail dd{color:var(--crit)}
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
.legend-filter:hover,.legend-filter[aria-pressed=true]{border-color:var(--accent);background:var(--accent-bg)}
.overview-note{margin:10px 0 0}
.empty{text-align:center;padding:28px 18px;color:var(--muted)}
.badge{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:3px 8px;max-width:100%;font-size:11px;font-weight:750;letter-spacing:.02em;border-radius:5px;background:var(--todo-bg);color:var(--muted);line-height:1.5;white-space:normal}
.badge.pass{background:var(--ok-bg);color:var(--ok)}
.badge.fail,.badge.integrity{background:var(--crit-bg);color:var(--crit)}
.badge.review,.badge.blocked{background:var(--warn-bg);color:var(--warn)}
.badge.neutral{background:var(--todo-bg);color:var(--todo)}
.toolbar{margin:14px 0 12px}
.search-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:14px}
.search-tools .search{flex:1 1 240px}
.status-filters{margin:0;padding:0;border:0;min-width:0}
.status-filters legend{font-size:12px;font-weight:650;margin-bottom:7px;padding:0}
.status-filters legend span{font-weight:400;color:var(--muted);margin-left:7px}
.status-options{display:flex;flex-wrap:wrap;gap:7px}
.status-choice{display:inline-flex;align-items:center;gap:6px;min-height:38px;padding:5px 10px;border:1px solid var(--line);border-radius:99px;background:var(--surface);font-size:12px;cursor:pointer}
.status-choice input{width:14px;height:14px;min-height:0;margin:0;accent-color:var(--accent)}
.status-count{color:var(--muted);font-variant-numeric:tabular-nums}
.status-choice.selected,#all-statuses[aria-pressed=true]{border-color:var(--accent);background:var(--accent-bg);color:var(--accent)}
.status-choice:focus-within{outline:2px solid var(--accent);outline-offset:2px}
#all-statuses{border-radius:99px}
.list-tools{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0 8px}
.group-actions{display:flex;gap:7px}
.attention-filter{color:var(--crit);background:var(--crit-bg)}
.attention-filter[aria-pressed=true]{border-color:var(--crit)}
.control label{display:block;font-size:12px;font-weight:650;color:var(--muted);margin-bottom:5px}
.control input,.control select{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);padding:9px 10px}
.button{border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--accent);padding:9px 12px;font-weight:600;font-size:13px}
.button:hover{background:var(--accent-bg)}
.result-meta{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:13px}
.result-meta p{margin:0}
.active-filters{padding:4px 8px;border-radius:5px;color:var(--accent);background:var(--accent-bg);font-size:12px}
.case-list{display:grid;gap:8px}
.case-group{min-width:0;border:1px solid var(--line);border-radius:10px;background:var(--surface);overflow:hidden;box-shadow:0 1px 2px rgb(16 24 26 / .06)}
.group-heading{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:12px 14px;list-style:none;min-height:48px}
.group-heading:hover{background:var(--surface2)}
.group-caret{font-size:10px;color:var(--muted)}
.case-group[open]>.group-heading .group-caret{transform:rotate(90deg)}
.group-heading .badge{font-size:12px;border-radius:99px;padding:3px 10px}
.group-count{font-size:12px;color:var(--muted);margin-left:auto}
.group-rows{border-top:1px solid var(--line)}
.pager{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:9px 14px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
details>summary{cursor:pointer}
summary::-webkit-details-marker{display:none}
.case-row{border-bottom:1px solid var(--line);min-width:0}
.case-row:last-child{border-bottom:0}
.case-row>summary{display:grid;grid-template-columns:95px 115px minmax(0,1fr) 58px;gap:3px 10px;align-items:start;list-style:none;padding:8px 14px;min-height:38px}
.case-row>summary:hover{background:var(--surface2)}
.case-row>summary>.badge{grid-column:1;grid-row:1 / 3;justify-self:start;margin-top:2px}
.case-main{display:contents}
.case-reason{grid-column:3;grid-row:2;display:block;font-size:11.5px;font-weight:400;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}
.case-title{grid-column:3;grid-row:1;display:block;font-size:12.5px;font-weight:550;line-height:1.45}
.case-identifiers{grid-column:2;grid-row:1 / 3;display:flex;flex-direction:column;gap:2px;color:var(--muted);font-size:11px;margin-top:2px;min-width:0}
.case-methods{display:none}
.case-action{grid-column:4;grid-row:1 / 3;display:flex;gap:5px;align-items:center;justify-content:flex-end;color:var(--accent);font-size:11px;font-weight:600}
.chevron{display:inline-block;transition:transform .15s;line-height:1;font-size:18px}
.case-row[open]>summary .chevron{transform:rotate(90deg)}
.case-row[open]>summary{border-bottom:1px solid var(--line)}
.case-body{padding:16px;min-width:0;background:var(--surface2);font-size:13px}
.case-context{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.case-context p{margin:0}
.run-details{border:1px solid var(--line);border-radius:7px;margin-top:10px;min-width:0}
.run-details>summary{padding:12px 14px;list-style:none;background:var(--surface2);border-radius:7px}
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
.evidence-field{padding:12px;background:var(--surface2);border-radius:6px;min-width:0}
.evidence-field dt,.comparison dt{font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.035em;margin-bottom:5px}
.evidence-field dd,.comparison dd{margin:0;font-size:13px;overflow-wrap:anywhere;white-space:pre-wrap}
.evidence-field.actual{border-left:3px solid var(--line)}
.assertion.fail .evidence-field.actual{border-left-color:var(--crit);background:var(--crit-bg)}
.comparison{padding:12px;border:1px solid var(--line);border-radius:6px;margin-bottom:10px;min-width:0}
.comparison-heading{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;font-size:12px}
.comparison dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.comparison .wide{grid-column:1/-1}
.evidence-ids{font-size:11px;margin:10px 0}
.evidence-ids code{font-size:11px}
.evidence-ids ul{padding-left:18px;margin:6px 0}
.raw{margin-top:10px;border:1px solid var(--line);border-radius:6px;min-width:0}
.raw>summary{padding:9px 12px;font-size:12px;min-height:40px}
.raw pre{font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:420px;padding:12px;margin:0;border-top:1px solid var(--line);background:var(--surface2)}
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
.screenshot{margin:0;padding:12px;background:var(--surface);border:1px solid var(--line);border-radius:8px;min-width:0}
.image-disclosure>summary{list-style:none;font-size:12px;color:var(--accent);font-weight:600}
.image-disclosure img{display:block;width:100%;height:150px;object-fit:contain;background:var(--surface2);border:1px solid var(--line);border-radius:4px;margin-bottom:8px}
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
.notice{padding:12px 16px;margin-top:16px;background:var(--accent-bg);border:1px solid var(--line);border-radius:7px;font-size:12px}
.footer{margin-top:28px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:16px}

@media(max-width:950px){.chart-panel{gap:24px}
.chart-content{max-width:420px}
.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}
}

@media(max-width:600px){main{padding:22px 14px 36px}
.report-header{margin-bottom:20px}
.panel{padding:16px}
.overview-grid{gap:18px;padding:16px}
.metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 16px}
.metric dd{font-size:25px}
.chart-panel{gap:12px}
.donut{width:108px;height:108px}
.legend li{gap:6px;font-size:11px}
.legend-filter{min-height:44px;padding:4px}
.search-tools .search{flex-basis:100%}
.case-row>summary{grid-template-columns:auto minmax(0,1fr) auto;gap:5px 9px;padding:10px;align-items:start}
.case-row>summary>.badge{grid-column:1;grid-row:1;justify-self:start}
.case-title{grid-column:1/-1;grid-row:2}
.case-identifiers{grid-column:2;grid-row:1;text-align:right}
.case-reason{grid-column:1/-1;grid-row:3}
.case-action{grid-column:3;grid-row:1;min-height:28px}
.case-body{padding:14px}
.run-body{padding:12px}
.assertion>summary{flex-wrap:wrap}
.assertion-title{min-width:65%}
.method-label{margin-left:0}
.evidence-fields,.comparison dl{grid-template-columns:minmax(0,1fr)}
.comparison .wide{grid-column:auto}
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

@media print{body{background:var(--surface)}
main{padding:0}
.toolbar,.legend-filter,.case-action,.pager,dialog,.screenshot .button,.theme-toggle{display:none!important}
.case-row,.panel{break-inside:avoid}
.case-row>summary{background:var(--surface)}
}

`;

export const REPORT_SCRIPT = String.raw`
(() => {
  'use strict';
  const rows = Array.from(document.querySelectorAll('[data-case]'));
  const search = document.getElementById('case-search');
  const sort = document.getElementById('case-sort');
  const clear = document.getElementById('clear-filters');
  const legend = Array.from(document.querySelectorAll('[data-filter-status]'));
  const choices = Array.from(document.querySelectorAll('.status-choice input'));
  const selected = new Set();
  let attentionOnly = false;
  const needsAttention = row => row.dataset.needsAttention === 'true' || ['FAIL', 'BLOCKED', 'NEEDS_REVIEW', 'INTEGRITY_FAILURE'].includes(row.dataset.status);
  const groups = Array.from(document.querySelectorAll('[data-group]')).map(node => ({node, rows: Array.from(node.querySelectorAll('[data-case]')), page: 0, matches: []}));
  const matches = row => row.dataset.search.toLowerCase().includes(search.value.trim().toLowerCase()) && (!selected.size || selected.has(row.dataset.status)) && (!attentionOnly || needsAttention(row));
  function update(filtersChanged = false) {
    if (!search) return;
    const query = search.value.trim().toLowerCase();
    let count = 0;
    for (const group of groups) {
      const ordered = group.rows.slice().sort((left, right) => {
        const original = Number(left.dataset.order) - Number(right.dataset.order);
        return sort.value === 'title' ? left.dataset.title.localeCompare(right.dataset.title, undefined, {sensitivity:'base', numeric:true}) || original : original;
      });
      group.matches = ordered.filter(matches); count += group.matches.length;
      const pages = Math.ceil(group.matches.length / 10);
      group.page = filtersChanged ? 0 : Math.max(0, Math.min(group.page, pages - 1));
      const visible = new Set(group.matches.slice(group.page * 10, group.page * 10 + 10));
      for (const row of ordered) {row.hidden = !visible.has(row); group.node.querySelector('.group-rows').append(row);}
      group.node.hidden = group.matches.length === 0;
      if (filtersChanged) group.node.open = !group.node.hidden && (!!query || !!selected.size || attentionOnly);
      group.node.querySelector('.group-count').textContent = group.matches.length === group.rows.length ? group.rows.length + ' cases' : group.matches.length + ' of ' + group.rows.length + ' matching';
      group.node.querySelector('.pager').hidden = pages <= 1;
      group.node.querySelector('.page-label').textContent = 'Cases ' + (group.page * 10 + 1) + '–' + Math.min(group.page * 10 + 10, group.matches.length) + ' of ' + group.matches.length;
      group.node.querySelector('[data-page="-1"]').disabled = group.page === 0;
      group.node.querySelector('[data-page="1"]').disabled = group.page >= pages - 1;
    }
    document.getElementById('result-count').textContent = 'Showing ' + count + ' of ' + rows.length + ' test cases';
    document.getElementById('no-results').hidden = count !== 0;
    const active = document.getElementById('active-filters');
    const labels = choices.filter(input => selected.has(input.value)).map(input => input.nextElementSibling.textContent);
    active.hidden = !query && !selected.size && !attentionOnly;
    active.textContent = [query ? 'Search: ' + search.value.trim() : '', labels.length ? 'Statuses: ' + labels.join(' + ') : '', attentionOnly ? 'Needs attention' : ''].filter(Boolean).join(' · ');
    clear.disabled = !query && !selected.size && !attentionOnly;
    for (const input of choices) {input.checked = selected.has(input.value); input.closest('label').classList.toggle('selected', input.checked);}
    document.getElementById('all-statuses').setAttribute('aria-pressed', String(!attentionOnly && (!selected.size || selected.size === choices.length)));
    for (const button of legend) button.setAttribute('aria-pressed', String(selected.has(button.dataset.filterStatus)));
    document.querySelector('[data-attention]')?.setAttribute('aria-pressed', String(attentionOnly));
  }
  function reset() { if (search) { search.value = ''; selected.clear(); attentionOnly = false; update(true); } }
  if (search) {
    document.getElementById('result-controls').hidden = false;
    search.addEventListener('input', () => update(true));
    for (const input of choices) input.addEventListener('change', () => {attentionOnly = false; if (input.checked) selected.add(input.value); else selected.delete(input.value); update(true);});
    sort.addEventListener('change', () => {for (const group of groups) group.page = 0; update();});
    clear.addEventListener('click', reset);
    document.getElementById('all-statuses').addEventListener('click', () => {selected.clear(); attentionOnly = false; update(true);});
    document.querySelector('[data-attention]')?.addEventListener('click', () => {
      attentionOnly = !attentionOnly; selected.clear();
      update(true);
    });
    document.getElementById('expand-groups').addEventListener('click', () => {for (const group of groups) if (!group.node.hidden) group.node.open = true;});
    document.getElementById('collapse-groups').addEventListener('click', () => {for (const group of groups) group.node.open = false;});
    for (const group of groups) for (const button of group.node.querySelectorAll('[data-page]')) button.addEventListener('click', () => {
      group.page += Number(button.dataset.page); update(); group.node.querySelector('summary').focus();
    });
    for (const button of legend) {
      button.hidden = false;
      button.addEventListener('click', () => {attentionOnly = false; const value = button.dataset.filterStatus; if (selected.has(value)) selected.delete(value); else selected.add(value); update(true);});
    }
    update();
  }
  const theme = document.getElementById('theme-toggle');
  const themeLabel = () => {const dark = getComputedStyle(document.documentElement).colorScheme === 'dark'; const next = dark ? 'light' : 'dark'; theme.dataset.nextTheme = next; theme.setAttribute('aria-label', 'Switch to ' + next + ' theme'); theme.title = 'Switch to ' + next + ' theme'; theme.setAttribute('aria-pressed', String(dark));};
  theme.addEventListener('click', () => {document.documentElement.dataset.theme = getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'light' : 'dark'; themeLabel();});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeLabel); themeLabel(); theme.hidden = false;
  function reveal(id, focus) {
    const target = document.getElementById(id);
    if (!target) return;
    const row = target.closest('[data-case]');
    if (row && search) {
      if (!matches(row)) reset();
      const group = groups.find(item => item.rows.includes(row));
      if (group) {group.page = Math.floor(group.matches.indexOf(row) / 10); update();}
    }
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
