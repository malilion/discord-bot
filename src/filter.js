import { firstUrl } from './util.js';

/** 依 config.filter 決定要不要同步這篇 */
export function shouldSync(item, filter = {}) {
  const haystack = `${item.title ?? ''}\n${item.text ?? ''}`.toLowerCase();
  const has = (kw) => haystack.includes(String(kw).toLowerCase());

  if ((filter.excludeKeywords || []).some(has)) return false;
  if (filter.includeKeywords?.length && !filter.includeKeywords.some(has)) return false;
  // RSS 本身就是文章連結，不受 requireLink 影響
  if (filter.requireLink && item.source !== 'rss' && !item.linkUrl && !firstUrl(item.text)) return false;
  return true;
}

/** 去掉網址、標點、空白後的內文，用來比對兩篇是不是同一篇 */
export function normalizeText(s = '') {
  return String(s).toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 300);
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}

/** 0～1 的相似度（Dice 係數） */
export function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

/**
 * item 是不是 others 裡某篇的重複（例如同一段文字同時發在粉專和 Threads）
 * 只比對發文時間相差 days 天內的貼文
 */
export function findDuplicate(item, others = [], { days = 3, threshold = 0.8 } = {}) {
  const a = normalizeText(`${item.title ?? ''}${item.text ?? ''}`);
  if (a.length < 15) return null; // 太短的不判斷，避免誤殺
  const t = Date.parse(item.publishedAt) || Date.now();
  return others.find((o) => {
    const ot = Date.parse(o.publishedAt) || 0;
    if (Math.abs(t - ot) > days * 86400_000) return false;
    const b = normalizeText(`${o.title ?? ''}${o.text ?? ''}`);
    if (b.length < 15) return false;
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    // 一邊是另一邊的節錄（例如粉專多寫了一段），或整體很像
    return (short.length >= 30 && long.includes(short.slice(0, 60))) || similarity(a, b) >= threshold;
  }) ?? null;
}
