// Gentle motion: pages fade in, cards slide up one after another, and KPI numbers count up.
// Only the first moments after opening a page animate, so typing in a search box or a live
// refresh never makes the list jump around.

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const ENTER_MS = 900;

/** Animate whatever a page draws into `el` during its first moments. */
export function enterView(el) {
  if (reduceMotion()) return;
  el.classList.add('enter');
  let started = false;
  let queued = false;
  const settle = () => {
    queued = false;
    if (!el.querySelector(':scope > .loading')) {
      if (!started) {
        started = true;
        setTimeout(() => { el.classList.remove('enter'); obs.disconnect(); }, ENTER_MS);
      }
      countUp(el);
    }
  };
  const obs = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(settle);
  });
  obs.observe(el, { childList: true, subtree: true });
  // Safety net: never leave a page stuck in "entering" mode
  setTimeout(() => { el.classList.remove('enter'); obs.disconnect(); }, 8000);
}

const NUM = /^(\s*)(-?[\d,]+(?:\.\d+)?)/;

/** Count KPI numbers up from zero (once per number). */
export function countUp(root) {
  if (reduceMotion()) return;
  root.querySelectorAll('.kpi .value').forEach((v) => {
    if (v.dataset.counted) return;
    v.dataset.counted = '1';
    const node = [...v.childNodes].find((c) => c.nodeType === 3 && NUM.test(c.nodeValue));
    if (!node) return;
    const original = node.nodeValue;
    const [, lead, raw] = original.match(NUM);
    const target = Number(raw.replace(/,/g, ''));
    if (!target || !Number.isFinite(target)) return;
    const decimals = (raw.split('.')[1] || '').length;
    const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const rest = original.slice(lead.length + raw.length);
    const dur = 700;
    const t0 = performance.now();
    let last = original;
    const step = (t) => {
      if (node.nodeValue !== last || !node.isConnected) return; // the page updated it meanwhile
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - (1 - p) ** 3;
      last = p < 1 ? lead + fmt.format(target * eased) + rest : original;
      node.nodeValue = last;
      if (p < 1) requestAnimationFrame(step);
    };
    last = lead + fmt.format(0) + rest;
    node.nodeValue = last;
    requestAnimationFrame(step);
  });
}

/** Run a visual change (like switching theme) as a soft cross-fade where the browser supports it. */
export function softly(change) {
  if (document.startViewTransition && !reduceMotion()) document.startViewTransition(change);
  else change();
}
