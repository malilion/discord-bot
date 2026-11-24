import { decodeEntities, stripHtml, MissingCredentialsError } from '../util.js';

/** 支援 RSS 2.0 與 Atom，不需要額外套件 */
export async function fetchRss(cfg) {
  const feeds = (cfg.feeds || []).filter((f) => f && !f.includes('example.com'));
  if (!feeds.length) throw new MissingCredentialsError('config.json 尚未填入 RSS feed 網址');
  const results = [];
  for (const feedUrl of feeds) {
    const res = await fetch(feedUrl, { headers: { 'User-Agent': 'discord-resource-sync/1.0' } });
    if (!res.ok) throw new Error(`RSS ${feedUrl} 回傳 HTTP ${res.status}`);
    results.push(...parseFeed(await res.text(), feedUrl));
  }
  return results;
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decodeEntities(m[1]);
}

function attr(xml, tagName, attrName, where = '') {
  const re = new RegExp(`<${tagName}\\b[^>]*${where}[^>]*>`, 'gi');
  for (const m of xml.matchAll(re)) {
    const a = m[0].match(new RegExp(`\\b${attrName}=["']([^"']+)["']`, 'i'));
    if (a) return decodeEntities(a[1]);
  }
  return '';
}

function findImage(itemXml, html) {
  return (
    attr(itemXml, 'media:content', 'url', 'medium=["\']image') ||
    attr(itemXml, 'media:thumbnail', 'url') ||
    attr(itemXml, 'enclosure', 'url', 'type=["\']image') ||
    (html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? '')
  ) || undefined;
}

function toIso(date) {
  if (!date) return undefined;
  const d = new Date(date.trim());
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseFeed(xml, feedUrl = '') {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)]
    .map((m) => m[0]);
  const siteTitle = stripHtml(tag(xml.replace(/<(item|entry)[\s>][\s\S]*$/i, ''), 'title'));

  return blocks.map((b) => {
    const link = isAtom
      ? attr(b, 'link', 'href', 'rel=["\']alternate') || attr(b, 'link', 'href')
      : stripHtml(tag(b, 'link'));
    const guid = tag(b, isAtom ? 'id' : 'guid') || link;
    const html = tag(b, 'content:encoded') || tag(b, 'content') || tag(b, 'description') || tag(b, 'summary');
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');

    return {
      id: `rss:${guid.trim()}`,
      source: 'rss',
      url: link.trim(),
      title: stripHtml(tag(b, 'title')),
      text: stripHtml(html),
      image: findImage(b, html),
      author: siteTitle || feedUrl,
      publishedAt: toIso(date),
    };
  });
}
