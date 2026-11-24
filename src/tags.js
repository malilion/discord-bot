/**
 * 依關鍵字自動替論壇貼文挑標籤
 * config.discord.tags = {
 *   source: { threads: "<tagId>", rss: "<tagId>" },        // 來源標籤，一定會加
 *   rules: [{ name, id, keywords: [] }],                   // 依序比對，命中就加
 *   fallback: "<tagId>",                                   // 沒命中任何分類時使用
 *   max: 5                                                 // Discord 每篇最多 5 個
 * }
 */
const LATIN = /^[a-z0-9 .+#-]+$/i;

function matches(haystack, keyword) {
  const kw = String(keyword).toLowerCase();
  if (LATIN.test(kw)) {
    // 英文關鍵字用字邊界比對，避免 "ai" 命中 "email"
    const esc = kw.replace(/[.+#-]/g, (c) => `\\${c}`);
    return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(haystack);
  }
  return haystack.includes(kw);
}

export function pickTags(item, tagsCfg) {
  if (!tagsCfg) return [];
  const max = Math.min(tagsCfg.max ?? 5, 5);
  const haystack = `${item.title ?? ''}\n${item.text ?? ''}\n${item.linkUrl ?? ''}`.toLowerCase();
  const picked = [];
  const sourceTag = tagsCfg.source?.[item.source];
  if (sourceTag) picked.push(sourceTag);

  let categories = 0;
  for (const rule of tagsCfg.rules ?? []) {
    if (picked.length >= max) break;
    if ((rule.keywords ?? []).some((kw) => matches(haystack, kw))) {
      picked.push(rule.id);
      categories++;
    }
  }
  if (!categories && tagsCfg.fallback && picked.length < max) picked.push(tagsCfg.fallback);
  return [...new Set(picked)];
}
