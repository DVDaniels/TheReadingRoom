document.querySelector("[data-view=write]").click(); await sleep(1200);
const D = window.__WRD;
const ti = document.getElementById("wrTitle"); ti.value = D.title; ti.dispatchEvent(new Event("input",{bubbles:true}));
const t = document.getElementById("wrText"); t.value = D.text; t.dispatchEvent(new Event("input",{bubbles:true})); t.blur(); ti.blur();
await sleep(500);
document.querySelectorAll('.acct-note').forEach(n => n.textContent = '');
