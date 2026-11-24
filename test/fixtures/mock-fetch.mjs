// 以 --import 預載：假的 Threads API（60 篇、分頁、留言）與 Discord webhook
// 送出的內容記到 POSTED_LOG（每行一筆 JSON）
import { appendFileSync } from 'node:fs';

const TOTAL = 60;
const posts = Array.from({ length: TOTAL }, (_, i) => ({
  id: String(i + 1),
  media_type: 'TEXT_POST',
  permalink: `https://www.threads.net/@me/post/${i + 1}`,
  text: `第 ${i + 1} 篇`,
  timestamp: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
  username: 'me',
})).reverse(); // API 由新到舊

// 單數篇各有 2 則留言
const repliesFor = (id) => (Number(id) % 2 ? [
  { id: `${id}-r2`, text: `回覆 ${id}-2`, username: 'bob', timestamp: '2026-02-01T00:00:02Z', permalink: 'x' },
  { id: `${id}-r1`, text: `回覆 ${id}-1`, username: 'amy', timestamp: '2026-02-01T00:00:01Z', permalink: 'x' },
] : []);

let threadSeq = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'graph.threads.net') {
    const conv = url.pathname.match(/\/v1\.0\/([^/]+)\/conversation$/);
    if (conv) {
      if (process.env.MOCK_REPLIES_FORBIDDEN) {
        return new Response(JSON.stringify({ error: { message: 'Application does not have permission for this action', type: 'OAuthException', code: 10 } }), { status: 403 });
      }
      return new Response(JSON.stringify({ data: repliesFor(conv[1]), paging: {} }));
    }
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const data = posts.slice(offset, offset + limit);
    const next = offset + limit < TOTAL ? (() => { const n = new URL(url); n.searchParams.set('offset', offset + limit); return n.toString(); })() : undefined;
    return new Response(JSON.stringify({ data, paging: next ? { next } : {} }));
  }
  if (url.hostname === 'discord.com') {
    const body = JSON.parse(init.body);
    const threadId = url.searchParams.get('thread_id');
    const channelId = threadId ?? (body.thread_name ? `thread-${++threadSeq}` : 'channel');
    appendFileSync(process.env.POSTED_LOG, JSON.stringify({
      threadId,
      title: body.embeds?.[0]?.title,
      threadName: body.thread_name,
      tags: body.applied_tags,
      username: body.username,
      content: body.content,
      channelId,
    }) + '\n');
    return new Response(JSON.stringify({ id: 'm', channel_id: channelId }));
  }
  throw new Error('unexpected fetch ' + url);
};
