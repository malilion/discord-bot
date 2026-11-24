import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFeed } from '../src/sources/rss.js';
import { fetchThreads } from '../src/sources/threads.js';
import { fetchFacebook } from '../src/sources/facebook.js';
import { buildPayload } from '../src/discord.js';
import { shouldSync } from '../src/filter.js';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>我的部落格</title>
<item>
  <title><![CDATA[10 個 AI 工具 & 使用心得]]></title>
  <link>https://blog.example.org/ai-tools</link>
  <guid>post-1</guid>
  <pubDate>Mon, 23 Nov 2026 08:00:00 GMT</pubDate>
  <content:encoded><![CDATA[<p>第一段</p><img src="https://img.example.org/a.png"><p>第二段</p>]]></content:encoded>
</item>
<item>
  <title>壞日期</title><link>https://blog.example.org/2</link>
  <pubDate>not a date</pubDate><description>&lt;b&gt;粗體&lt;/b&gt;</description>
</item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Blog</title>
<entry><title>Atom 文章</title><id>tag:x,1</id>
<link rel="alternate" href="https://atom.example.org/1"/>
<published>2026-11-20T10:00:00Z</published><summary>摘要</summary></entry>
</feed>`;

test('RSS 解析：CDATA、圖片、HTML、壞日期', () => {
  const [a, b] = parseFeed(RSS);
  assert.equal(a.id, 'rss:post-1');
  assert.equal(a.title, '10 個 AI 工具 & 使用心得');
  assert.equal(a.url, 'https://blog.example.org/ai-tools');
  assert.equal(a.image, 'https://img.example.org/a.png');
  assert.equal(a.author, '我的部落格');
  assert.match(a.text, /第一段\s+第二段/);
  assert.equal(a.publishedAt, '2026-11-23T08:00:00.000Z');
  assert.equal(b.publishedAt, undefined);
  assert.equal(b.text, '粗體');
  assert.equal(b.id, 'rss:https://blog.example.org/2'); // 沒 guid 用連結
});

test('Atom 解析', () => {
  const [e] = parseFeed(ATOM);
  assert.equal(e.url, 'https://atom.example.org/1');
  assert.equal(e.id, 'rss:tag:x,1');
  assert.equal(e.author, 'Atom Blog');
});

test('Threads：略過轉發、取圖片', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(String(url), /graph\.threads\.net/);
    return new Response(JSON.stringify({ data: [
      { id: '1', media_type: 'IMAGE', media_url: 'https://i/1.jpg', permalink: 'https://threads.net/p/1', text: '推薦工具\nhttps://tool.example.org', timestamp: '2026-11-24T01:00:00+0000', username: 'me' },
      { id: '2', media_type: 'REPOST_FACADE', permalink: 'x', timestamp: '2026-11-24T02:00:00+0000' },
    ] }));
  });
  const items = await fetchThreads({}, { THREADS_ACCESS_TOKEN: 't' });
  assert.equal(items.length, 1);
  assert.equal(items[0].image, 'https://i/1.jpg');
  assert.equal(items[0].author, '@me');
});

test('Facebook：略過無文字貼文、取附件連結', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: [
    { id: 'p_1', message: '好文分享', permalink_url: 'https://fb/1', created_time: '2026-11-24T00:00:00+0000', attachments: { data: [{ unshimmed_url: 'https://article.example.org', title: '文章標題' }] } },
    { id: 'p_2', permalink_url: 'https://fb/2', created_time: '2026-11-24T00:00:00+0000' },
  ] })));
  const items = await fetchFacebook({}, { FB_PAGE_ID: '1', FB_PAGE_ACCESS_TOKEN: 't' });
  assert.equal(items.length, 1);
  assert.equal(items[0].linkUrl, 'https://article.example.org');
});

test('Discord payload：第一行當標題、附連結欄位、擋 mention、論壇模式', () => {
  const item = { id: 'threads:1', source: 'threads', url: 'https://threads.net/p/1', text: '推薦工具 @everyone\n說明文字 https://tool.example.org', publishedAt: '2026-11-24T01:00:00Z' };
  const p = buildPayload(item, { label: 'Threads', color: '#000000' }, { username: 'Bot', forumChannel: true });
  const e = p.embeds[0];
  assert.equal(e.title, '🧵 推薦工具 @everyone');
  assert.equal(e.description, '說明文字 https://tool.example.org');
  assert.equal(e.fields[0].value, 'https://tool.example.org');
  assert.equal(e.color, 0);
  assert.deepEqual(p.allowed_mentions, { parse: [] });
  assert.equal(p.thread_name, '推薦工具 @everyone');
});

test('Discord payload：長度限制', () => {
  const p = buildPayload({ source: 'rss', title: 'a'.repeat(400), text: 'b'.repeat(5000) }, {}, {});
  assert.ok([...p.embeds[0].title].length <= 256);
  assert.ok([...p.embeds[0].description].length <= 1500);
  assert.equal(p.thread_name, undefined);
});

test('過濾規則', () => {
  const base = { source: 'threads', text: '今天天氣好' };
  assert.equal(shouldSync(base, {}), true);
  assert.equal(shouldSync({ ...base, text: '心得 #不同步' }, { excludeKeywords: ['#不同步'] }), false);
  assert.equal(shouldSync(base, { includeKeywords: ['#工具'] }), false);
  assert.equal(shouldSync({ ...base, text: '#工具 好用' }, { includeKeywords: ['#工具'] }), true);
  assert.equal(shouldSync(base, { requireLink: true }), false);
  assert.equal(shouldSync({ ...base, text: 'see https://x.org' }, { requireLink: true }), true);
  assert.equal(shouldSync({ source: 'rss', text: '' }, { requireLink: true }), true);
});

import { pickTags } from '../src/tags.js';
import { buildReplyPayload } from '../src/discord.js';

test('自動標籤：來源 + 關鍵字分類，英文用字邊界，沒命中走 fallback，最多 5 個', () => {
  const cfg = {
    source: { threads: 'S' },
    rules: [
      { id: 'AI', keywords: ['ai', 'claude'] },
      { id: 'UI', keywords: ['設計', 'figma'] },
      { id: 'OSS', keywords: ['github'] },
      { id: 'CODE', keywords: ['react'] },
      { id: 'GAME', keywords: ['遊戲'] },
    ],
    fallback: 'MISC',
  };
  assert.deepEqual(pickTags({ source: 'threads', text: '用 Claude 做 Figma 設計' }, cfg), ['S', 'AI', 'UI']);
  assert.deepEqual(pickTags({ source: 'threads', text: '寄 email 給你' }, cfg), ['S', 'MISC']); // email 不算 ai
  assert.deepEqual(pickTags({ source: 'threads', text: 'AI 設計 github react 遊戲' }, cfg), ['S', 'AI', 'UI', 'OSS', 'CODE']);
  assert.deepEqual(pickTags({ source: 'rss', text: 'x' }, undefined), []);
});

test('留言 payload：作者名、圖片、空內容、擋 mention', () => {
  const p = buildReplyPayload({ username: 'amy', text: '好文 @everyone', image: 'https://i/1.jpg' });
  assert.equal(p.username, '@amy · Threads');
  assert.equal(p.content, '好文 @everyone\nhttps://i/1.jpg');
  assert.deepEqual(p.allowed_mentions, { parse: [] });
  assert.equal(buildReplyPayload({ username: 'x', text: '', url: 'https://t/1' }).content, '（附件）https://t/1');
});
