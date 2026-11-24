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
