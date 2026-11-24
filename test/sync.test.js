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

import { pickCategories, buildCategoryPost, shouldPostCategory, CATEGORIES } from '../src/radar.js';

test('雷達：每個類別每天只發一次，台北 9 點後；首次立刻發', () => {
  const cfg = { postAfterHour: 9 };
  const at = (iso) => new Date(iso);
  assert.equal(shouldPostCategory(cfg, {}, 'news', at('2026-11-24T00:00:00Z')), true);
  assert.equal(shouldPostCategory(cfg, { posted: { news: '2026-11-24' } }, 'news', at('2026-11-24T05:00:00Z')), false);
  assert.equal(shouldPostCategory(cfg, { posted: { news: '2026-11-23' } }, 'news', at('2026-11-23T23:30:00Z')), false);
  assert.equal(shouldPostCategory(cfg, { posted: { news: '2026-11-23' } }, 'news', at('2026-11-24T01:10:00Z')), true);
  assert.equal(shouldPostCategory(cfg, { posted: { news: '2026-11-24' } }, 'tools', at('2026-11-24T05:00:00Z')), true); // 各類別獨立
});

test('雷達：依來源分到正確類別，學習資源與新聞分開', () => {
  const now = Date.parse('2026-11-24T04:00:00Z');
  const s = pickCategories({
    ai: { items: [
      { title: 'Model launch', link: 'n1', source: 'TechCrunch', type: 'media', score: 2, pubDate: '2026-11-24T02:00:00Z' },
      { title: 'Lab post', link: 'o1', source: 'OpenAI', type: 'lab', score: 1, pubDate: '2026-11-24T01:00:00Z' },
      { title: 'Research', link: 'r1', source: 'Google Research', type: 'lab', score: 1, pubDate: '2026-11-23T01:00:00Z' },
      { title: 'Essay', link: 'e1', source: 'Latent Space', type: 'media', score: 9, pubDate: '2026-11-23T01:00:00Z' },
    ] },
    dev: { items: [
      { title: 'repo', link: 'g1', source: 'GitHub 今日趨勢', type: 'github' },
      { title: 'TIL', link: 't1', source: 'Simon Willison', type: 'blogs', pubDate: '2026-11-24T00:00:00Z' },
      { title: '1.0', link: 'v1', source: 'Codex', type: 'releases', pubDate: '2026-11-23T20:00:00Z' },
    ] },
    papers: { items: [{ title: 'P', link: 'p1', type: 'daily', rank: 1, upvotes: 3 }] },
    events: { items: [] },
  }, now);
  const links = (k) => s[k].flatMap((x) => x.items.map((i) => i.link));
  assert.deepEqual(links('news'), ['n1']);          // 深度文章不算新聞
  assert.deepEqual(links('official'), ['o1']);      // 研究部落格不算官方動態
  assert.deepEqual(links('research'), ['r1', 'e1']);
  assert.deepEqual(links('tutorials'), ['t1']);
  assert.deepEqual(links('tools'), ['g1']);
  assert.deepEqual(links('releases'), ['v1']);
  assert.deepEqual(links('papers'), ['p1']);
});

test('雷達：貼文帶標籤、已發過的連結不重複、沒新內容就不發', () => {
  const cat = CATEGORIES.find((c) => c.key === 'papers');
  const sections = [{ title: '論文', items: [{ title: 'A [x]', link: 'a' }, { title: 'B', link: 'b' }], max: 5 }];
  const cfg = { baseUrl: 'https://radar/', tags: { papers: ['T1', 'T2'] } };
  const now = new Date('2026-11-24T04:00:00Z');
  const post = buildCategoryPost(cat, sections, new Set(['a']), cfg, now);
  assert.equal(post.payload.thread_name, '📄 熱門論文｜11/24（二）');
  assert.deepEqual(post.payload.applied_tags, ['T1', 'T2']);
  assert.deepEqual(post.links, ['b']);
  assert.equal(post.payload.embeds[0].description, '• [B](b)');
  assert.equal(buildCategoryPost(cat, sections, new Set(['a', 'b']), cfg, now), null);
});

import { findDuplicate } from '../src/filter.js';

test('跨平台去重：同一段文字、節錄、不同內容、太短、時間差太多', () => {
  const t = '2026-11-24T01:00:00Z';
  const threads = [{ text: '推薦一個超好用的 AI 工具 Raycast，可以用快捷鍵叫出 ChatGPT 幫你翻譯和整理筆記 https://raycast.com', publishedAt: t }];
  const same = { text: '推薦一個超好用的AI工具 Raycast，可以用快捷鍵叫出ChatGPT幫你翻譯和整理筆記！\nhttps://raycast.com/?utm=fb', publishedAt: '2026-11-24T03:00:00Z' };
  const longer = { text: `${threads[0].text}\n\n補充：免費方案就夠用了，Pro 版多了 AI 功能。`, publishedAt: t };
  const other = { text: '今天來聊聊怎麼用 GitHub Actions 自動部署網站，免費又省事', publishedAt: t };
  const short = { text: '早安', publishedAt: t };
  const late = { ...same, publishedAt: '2026-11-30T01:00:00Z' };
  assert.ok(findDuplicate(same, threads));
  assert.ok(findDuplicate(longer, threads));
  assert.equal(findDuplicate(other, threads), null);
  assert.equal(findDuplicate(short, [{ text: '早安', publishedAt: t }]), null);
  assert.equal(findDuplicate(late, threads), null);
});

import { parseYoutubeFeed } from '../src/sources/youtube.js';

const YT = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<title>我的頻道</title>
<entry><id>yt:video:abc123DEF45</id><yt:videoId>abc123DEF45</yt:videoId><title>Claude Code 實測 &amp; 心得</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=abc123DEF45"/><published>2026-11-20T10:00:00+00:00</published>
<media:group><media:title>x</media:title><media:description>第一行介紹
https://example.org/tool
第三行
第四行不會出現</media:description></media:group></entry>
<entry><id>yt:video:short000001</id><yt:videoId>short000001</yt:videoId><title>一分鐘小技巧</title>
<link rel="alternate" href="https://www.youtube.com/shorts/short000001"/><published>2026-11-21T10:00:00+00:00</published></entry>
</feed>`;

test('YouTube：解析影片、Shorts、Discord 內文只預覽影片', () => {
  const [v, s] = parseYoutubeFeed(YT);
  assert.equal(v.id, 'youtube:abc123DEF45');
  assert.equal(v.title, 'Claude Code 實測 & 心得');
  assert.equal(v.image, 'https://i.ytimg.com/vi/abc123DEF45/hqdefault.jpg');
  assert.equal(s.isShort, true);
  assert.equal(s.url, 'https://www.youtube.com/watch?v=short000001');
  const p = buildPayload(v, {}, { forumChannel: true, tags: { source: { youtube: 'YT' } } });
  assert.equal(p.thread_name, 'Claude Code 實測 & 心得');
  assert.equal(p.content, '第一行介紹\n<https://example.org/tool>\n第三行\n\n▶️ https://www.youtube.com/watch?v=abc123DEF45');
  assert.deepEqual(p.applied_tags, ['YT']);
  assert.equal(p.embeds, undefined);
  assert.equal(buildPayload(s, {}, { forumChannel: true }).thread_name, '🩳 一分鐘小技巧');
});
