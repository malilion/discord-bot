import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Threads 搬全部舊文：由舊到新分批發，每篇只發一次', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-'));
  const cfg = join(dir, 'config.json');
  const log = join(dir, 'posted.log');
  writeFileSync(cfg, JSON.stringify({
    sources: { threads: { enabled: true, label: 'Threads', firstRunPostLatest: 'all' } },
    filter: {}, discord: { maxPostsPerRun: 25 },
  }));
  const env = {
    ...process.env,
    CONFIG_PATH: cfg,
    STATE_PATH: join(dir, 'seen.json'),
    POSTED_LOG: log,
    THREADS_ACCESS_TOKEN: 't',
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc-DEF_1',
  };
  const run = () => execFileSync(process.execPath,
    ['--import', join(ROOT, 'test/fixtures/mock-fetch.mjs'), join(ROOT, 'src/index.js')], { env });
  const posted = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  const state = () => JSON.parse(readFileSync(env.STATE_PATH, 'utf8')).sources.threads;

  run();
  assert.equal(posted().length, 25);
  assert.equal(posted()[0], '🧵 第 1 篇'); // 從最舊的開始
  assert.equal(state().backfilling, true);

  run();
  assert.equal(posted().length, 50);

  run();
  assert.equal(posted().length, 60);
  assert.equal(posted().at(-1), '🧵 第 60 篇');
  assert.equal(state().backfilling, false);

  run(); // 搬完後再跑不會重發
  assert.equal(posted().length, 60);
  assert.equal(new Set(posted()).size, 60);
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
