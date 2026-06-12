// @ts-check
const api = /** @type {any} */ (window).guai;
const content = document.getElementById('content');
const updated = document.getElementById('updated');
let lang = 'en';

const labels = {
  en: { title: 'Usage', loading: 'Loading...', none: 'No quota data yet', updated: 'Updated', reset: 'reset' },
  'zh-TW': { title: '用量', loading: '載入中...', none: '尚無配額資料', updated: '更新', reset: '重置' },
};
const text = (key) => labels[lang]?.[key] ?? labels.en[key];
const call = async (promise) => {
  const result = await promise;
  if (!result?.ok) throw new Error(result?.error || 'Request failed');
  return result.data;
};
const node = (tag, cls, value) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (value != null) element.textContent = String(value);
  return element;
};
const windowName = (name) => {
  if (name === 'primary' || name === '5h') return '5h';
  if (name === 'secondary' || name === 'weekly') return lang === 'zh-TW' ? '每週' : 'Weekly';
  return name;
};
const resetLabel = (value) => {
  if (!value) return '';
  return `${text('reset')} ${new Date(value).toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
};

async function load() {
  try {
    const data = await call(api.usageCharts({ days: 7 }));
    const accounts = Object.fromEntries((data.accounts || []).map((account) => [account.provider, account]));
    const groups = {};
    for (const quota of data.quota || []) (groups[quota.provider] ||= []).push(quota);
    const providers = Object.keys(groups).sort((a, b) => (a === 'claude' ? -1 : b === 'claude' ? 1 : a.localeCompare(b)));
    if (!providers.length) {
      content.replaceChildren(node('div', 'empty', text('none')));
    } else {
      content.replaceChildren(...providers.map((provider) => {
        const wrap = node('section', 'provider');
        const head = node('div', 'provider-head');
        head.append(node('strong', '', provider), node('span', 'plan', accounts[provider]?.plan_type || ''));
        wrap.append(head);
        const rows = groups[provider].sort((a, b) => String(a.window_name).localeCompare(String(b.window_name)));
        for (const quota of rows) {
          const used = Math.max(0, Math.min(100, Number(quota.used_percent) || 0));
          const block = node('div', 'quota');
          const meta = node('div', 'quota-meta');
          meta.append(node('span', '', `${windowName(quota.window_name)} · ${Math.round(used)}%`), node('span', '', resetLabel(quota.resets_at)));
          const track = node('div', 'track');
          const fill = node('div', `fill ${provider}`);
          fill.style.width = `${used}%`;
          track.append(fill);
          block.append(meta, track);
          wrap.append(block);
        }
        return wrap;
      }));
    }
    updated.textContent = `${text('updated')} ${new Date().toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  } catch (error) {
    content.replaceChildren(node('div', 'error', error.message));
  }
}

document.getElementById('refresh').addEventListener('click', async () => {
  content.replaceChildren(node('div', 'empty', text('loading')));
  try { await call(api.syncUsage()); } catch { /* load below shows the current state */ }
  await load();
});
document.getElementById('close').addEventListener('click', () => api.hideUsageMini());
api.onRefreshed(load);

(async () => {
  try {
    const config = await call(api.getConfig());
    lang = config?.ui?.language === 'zh-TW' ? 'zh-TW' : 'en';
  } catch { /* keep English */ }
  document.documentElement.lang = lang;
  document.getElementById('title').textContent = text('title');
  await load();
})();
