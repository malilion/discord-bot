const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…',
  mdash: '—', ndash: '–', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
};

export function decodeEntities(str = '') {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function stripHtml(html = '') {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(str = '', max) {
  const chars = [...str];
  return chars.length <= max ? str : chars.slice(0, max - 1).join('') + '…';
}

export function firstUrl(text = '') {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/);
  return m ? m[0] : null;
}

/** 第一行當標題，其餘當內文 */
export function splitTitle(text = '', maxTitle = 120) {
  const clean = text.trim();
  if (!clean) return { title: '', body: '' };
  const [first, ...rest] = clean.split('\n');
  return { title: truncate(first.trim(), maxTitle), body: rest.join('\n').trim() };
}

export function hexToInt(hex) {
  if (!hex) return undefined;
  const n = parseInt(String(hex).replace('#', ''), 16);
  return Number.isFinite(n) ? n : undefined;
}

/** 缺少 token 時拋出，主程式會略過該來源而不是當成錯誤 */
export class MissingCredentialsError extends Error {
  constructor(msg) { super(msg); this.name = 'MissingCredentialsError'; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'discord-resource-sync/1.0' } });
    if (res.ok) return res.json();
    const body = await res.text();
    if (attempt < retries && res.status >= 500) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    // 不把 token 印進 log
    const safeUrl = url.replace(/access_token=[^&]+/, 'access_token=***');
    throw new Error(`HTTP ${res.status} ${safeUrl}: ${body.slice(0, 300)}`);
  }
}
