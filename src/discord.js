import { firstUrl, hexToInt, sleep, splitTitle, truncate } from './util.js';

const SOURCE_EMOJI = { threads: '🧵', facebook: '📘', rss: '📝' };

/** 把統一格式的貼文轉成 Discord webhook payload */
export function buildPayload(item, sourceCfg = {}, discordCfg = {}) {
  let title = item.title;
  let body = item.text ?? '';
  if (!title) ({ title, body } = splitTitle(body));
  if (!title) title = `${sourceCfg.label ?? item.source} 新貼文`;

  const link = item.linkUrl || (item.source !== 'rss' ? firstUrl(item.text) : null);
  const fields = [];
  if (link && link !== item.url) {
    fields.push({ name: '🔗 連結', value: truncate(item.linkTitle ? `[${item.linkTitle}](${link})` : link, 1024) });
  }

  const embed = {
    title: truncate(`${SOURCE_EMOJI[item.source] ?? ''} ${title}`.trim(), 256),
    url: item.url || undefined,
    // RSS 文章只放摘要（點標題看全文）；社群貼文通常不長，保留較多
    description: body ? truncate(body, item.source === 'rss' ? 300 : 1500) : undefined,
    color: hexToInt(sourceCfg.color),
    author: item.author ? { name: truncate(item.author, 256) } : undefined,
    fields: fields.length ? fields : undefined,
    image: item.image ? { url: item.image } : undefined,
    footer: { text: `來自 ${sourceCfg.label ?? item.source}` },
    timestamp: item.publishedAt,
  };

  const payload = {
    username: discordCfg.username || undefined,
    avatar_url: discordCfg.avatarUrl || undefined,
    embeds: [embed],
    allowed_mentions: { parse: [] }, // 不要讓貼文裡的 @everyone 真的 tag 到人
  };
  // 論壇頻道：每篇開一個討論串，方便搜尋與留言
  if (discordCfg.forumChannel) payload.thread_name = truncate(title, 100);
  return payload;
}

export async function postToDiscord(webhookUrl, payload, { retries = 3 } = {}) {
  const url = new URL(webhookUrl);
  url.searchParams.set('wait', 'true');

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      // 避免連發撞到 webhook 速率限制（約 5 則 / 2 秒）
      const remaining = Number(res.headers.get('x-ratelimit-remaining'));
      const resetAfter = Number(res.headers.get('x-ratelimit-reset-after'));
      if (remaining === 0 && resetAfter > 0) await sleep(resetAfter * 1000);
      return res.json();
    }
    if (res.status === 429 && attempt < retries) {
      const data = await res.json().catch(() => ({}));
      await sleep(((data.retry_after ?? 2) * 1000) + 250);
      continue;
    }
    if (res.status >= 500 && attempt < retries) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    throw new Error(`Discord webhook HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
