// 以 --import 預載：假的 Threads API（60 篇、分頁）與 Discord webhook，把送出的貼文記到 POSTED_LOG
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

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'graph.threads.net') {
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const data = posts.slice(offset, offset + limit);
    const next = offset + limit < TOTAL ? (() => { const n = new URL(url); n.searchParams.set('offset', offset + limit); return n.toString(); })() : undefined;
    return new Response(JSON.stringify({ data, paging: next ? { next } : {} }));
  }
  if (url.hostname === 'discord.test') {
    const body = JSON.parse(init.body);
    appendFileSync(process.env.POSTED_LOG, body.embeds[0].title + '\n');
    return new Response(JSON.stringify({ id: 'x' }));
  }
  throw new Error('unexpected fetch ' + url);
};
