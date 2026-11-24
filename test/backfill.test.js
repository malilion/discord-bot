import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function setup(discordCfg = {}, threadsCfg = {}, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-'));
  const cfg = join(dir, 'config.json');
  const log = join(dir, 'posted.log');
  writeFileSync(cfg, JSON.stringify({
    sources: { threads: { enabled: true, label: 'Threads', firstRunPostLatest: 'all', ...threadsCfg } },
    filter: {}, discord: { maxPostsPerRun: 25, ...discordCfg },
  }));
  const env = {
    ...process.env,
    CONFIG_PATH: cfg,
    STATE_PATH: join(dir, 'seen.json'),
    POSTED_LOG: log,
    THREADS_ACCESS_TOKEN: 't',
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc-DEF_1',
    ...extraEnv,
  };
  return {
    env,
    run: () => execFileSync(process.execPath,
      ['--import', join(ROOT, 'test/fixtures/mock-fetch.mjs'), join(ROOT, 'src/index.js')], { env, stdio: 'pipe' }).toString(),
    posted: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []),
    state: () => JSON.parse(readFileSync(env.STATE_PATH, 'utf8')),
  };
}

test('Threads 搬全部舊文：由舊到新分批發，每篇只發一次', () => {
  const t = setup();
  const titles = () => t.posted().map((p) => p.title);

  t.run();
  assert.equal(titles().length, 25);
  assert.equal(titles()[0], '🧵 第 1 篇'); // 從最舊的開始
  assert.equal(t.state().sources.threads.backfilling, true);

  t.run();
  assert.equal(titles().length, 50);

  t.run();
  assert.equal(titles().length, 60);
  assert.equal(titles().at(-1), '🧵 第 60 篇');
  assert.equal(t.state().sources.threads.backfilling, false);

  t.run(); // 搬完後再跑不會重發
  assert.equal(titles().length, 60);
  assert.equal(new Set(titles()).size, 60);
});

test('論壇模式：每篇是一個貼文、帶標籤，留言搬進該貼文且不重複', () => {
  const t = setup(
    { forumChannel: true, maxPostsPerRun: 60, tags: { source: { threads: 'TAG_THREADS' }, rules: [], fallback: 'TAG_MISC' } },
    { replies: { enabled: true, followDays: 99999 } },
  );
  t.run();
  const all = t.posted();
  const posts = all.filter((p) => !p.threadId);
  const replies = all.filter((p) => p.threadId);

  assert.equal(posts.length, 60);
  assert.equal(posts[0].threadName, '第 1 篇');
  assert.deepEqual(posts[0].tags, ['TAG_THREADS', 'TAG_MISC']);

  // 30 篇單數貼文各 2 則留言，放進對應的討論串，由舊到新
  assert.equal(replies.length, 60);
  const firstThread = posts[0].channelId;
  const inFirst = replies.filter((r) => r.threadId === firstThread);
  assert.deepEqual(inFirst.map((r) => r.content), ['回覆 1-1', '回覆 1-2']);
  assert.equal(inFirst[0].username, '@amy · Threads');

  t.run(); // 再跑一次：最近的貼文會重新檢查，但已搬過的留言不會重發
  assert.equal(t.posted().length, 120);
});

test('token 沒有留言權限時只發貼文、不讓整個同步失敗', () => {
  const t = setup(
    { forumChannel: true, maxPostsPerRun: 5 },
    { replies: { enabled: true } },
    { MOCK_REPLIES_FORBIDDEN: '1' },
  );
  const out = t.run(); // 不會丟出例外（exit code 0）
  assert.equal(t.posted().length, 5);
  assert.match(out, /沒有讀取留言的權限/);
});

test('Webhook 網址格式錯誤時直接報錯，且不洩漏完整網址', () => {
  const dir = mkdtempSync(join(tmpdir(), 'badhook-'));
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ sources: {}, filter: {}, discord: {} }));
  let out = '';
  try {
    execFileSync(process.execPath, [join(ROOT, 'src/index.js')], {
      env: { ...process.env, CONFIG_PATH: cfg, STATE_PATH: join(dir, 's.json'),
        DISCORD_WEBHOOK_URL: 'https://discord.com/channels/111/222secret' },
      stdio: 'pipe',
    });
  } catch (e) { out = String(e.stderr); }
  assert.match(out, /不是 Webhook 網址（目前是 discord\.com\/channels\/…）/);
  assert.doesNotMatch(out, /222secret/);
});
