import { firstUrl, hexToInt, sleep, splitTitle, truncate } from './util.js';
import { pickTags } from './tags.js';

const SOURCE_EMOJI = { threads: '🧵', facebook: '📘', rss: '📝', youtube: '🎬' };

/** 把統一格式的貼文轉成 Discord webhook payload */
export function buildPayload(item, sourceCfg = {}, discordCfg = {}) {
  if (item.source === 'youtube') return buildVideoPayload(item, discordCfg);
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
  // 論壇頻道：每篇是一個貼文（討論串），帶上分類標籤，方便篩選與留言
  if (discordCfg.forumChannel) {
    payload.thread_name = truncate(title, 100);
    const tags = pickTags(item, discordCfg.tags);
    if (tags.length) payload.applied_tags = tags;
  }
  return payload;
}

/**
 * YouTube 影片：內文只放影片網址，讓 Discord 顯示可以直接播放的預覽；
 * 說明欄取前幾行，裡面的連結用 <> 包起來，避免多出其他預覽
 */
function buildVideoPayload(item, discordCfg = {}) {
  const intro = (item.text ?? '')
    .split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join('\n')
    .replace(/(https?:\/\/[^\s<>]+)/g, '<$1>');
  const content = `${intro ? `${truncate(intro, 600)}\n\n` : ''}▶️ ${item.url}`;
  const payload = {
    username: discordCfg.username || undefined,
    avatar_url: discordCfg.avatarUrl || undefined,
    content: truncate(content, 2000),
    allowed_mentions: { parse: [] },
  };
  if (discordCfg.forumChannel) {
    payload.thread_name = truncate(`${item.isShort ? '🩳 ' : ''}${item.title || 'YouTube 新影片'}`, 100);
    const tags = pickTags(item, discordCfg.tags);
    if (tags.length) payload.applied_tags = tags;
  }
  return payload;
}

/** 把一則 Threads 留言轉成論壇貼文裡的一則訊息 */
export function buildReplyPayload(reply) {
  const name = reply.username ? `@${reply.username}` : 'Threads 留言';
  let content = reply.text?.trim() || '';
  if (reply.image) content += `${content ? '\n' : ''}${reply.image}`;
  if (!content) content = reply.url ? `（附件）${reply.url}` : '（沒有文字內容）';
  return {
    // webhook 名稱不能含 "discord"，也限 80 字
    username: truncate(`${name} · Threads`.replace(/discord/gi, 'd1scord'), 80),
    content: truncate(content, 2000),
    allowed_mentions: { parse: [] },
  };
}

export async function postToDiscord(webhookUrl, payload, { retries = 3, threadId } = {}) {
  const url = new URL(webhookUrl);
  url.searchParams.set('wait', 'true');
  if (threadId) url.searchParams.set('thread_id', threadId);

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
