import { decodeEntities, MissingCredentialsError } from '../util.js';
import { parseFeed } from './rss.js';

/**
 * 抓 YouTube 頻道的新影片（公開 RSS，不需要 API key）
 * config: sources.youtube.channels = ["UCxxxx…"]（頻道 ID，UC 開頭）
 * RSS 只提供最新 15 部影片。
 */
export async function fetchYoutube(cfg) {
  const channels = (cfg.channels || []).filter((c) => /^UC[\w-]{22}$/.test(c));
  if (!channels.length) throw new MissingCredentialsError('config.json 尚未填入 YouTube 頻道 ID');
  const results = [];
  for (const id of channels) {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'discord-resource-sync/1.0' } });
    if (!res.ok) throw new Error(`YouTube ${id} 回傳 HTTP ${res.status}`);
    results.push(...parseYoutubeFeed(await res.text()));
  }
  return results;
}

export function parseYoutubeFeed(xml) {
  const blocks = [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  const base = parseFeed(xml);
  return base.map((it, i) => {
    const b = blocks[i] ?? '';
    const videoId = b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim();
    const desc = b.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? '';
    const isShort = /\/shorts\//.test(it.url);
    return {
      ...it,
      id: `youtube:${videoId || it.id}`,
      source: 'youtube',
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : it.url,
      text: decodeEntities(desc).trim(),
      image: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : it.image,
      isShort,
    };
  });
}
