import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fetchThreads } from './sources/threads.js';
import { fetchFacebook } from './sources/facebook.js';
import { fetchRss } from './sources/rss.js';
import { shouldSync } from './filter.js';
import { buildPayload, postToDiscord } from './discord.js';
import { loadState, saveState, sourceState, markSeen } from './state.js';
import { MissingCredentialsError } from './util.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FETCHERS = { threads: fetchThreads, facebook: fetchFacebook, rss: fetchRss };

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONFIG_PATH = process.env.CONFIG_PATH || join(ROOT, 'config.json');
const STATE_PATH = process.env.STATE_PATH || join(ROOT, 'state', 'seen.json');

const byDate = (a, b) => (Date.parse(a.publishedAt) || 0) - (Date.parse(b.publishedAt) || 0);

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const state = await loadState(STATE_PATH);
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!DRY_RUN && !webhook) {
    console.log('– 尚未設定 DISCORD_WEBHOOK_URL，本次不執行同步');
    return;
  }

  const queue = [];
  const errors = [];

  for (const [name, cfg] of Object.entries(config.sources)) {
    if (!cfg.enabled) continue;
    const src = sourceState(state, name);
    let items;
    try {
      // 首次執行或舊文還沒搬完時，抓完整歷史；平常只抓最新一頁
      const fetchAll = !src.initialized || src.backfilling;
      items = await FETCHERS[name](cfg, process.env, { fetchAll });
    } catch (err) {
      if (err instanceof MissingCredentialsError) {
        console.log(`– ${name}: ${err.message}，略過`);
        continue;
      }
      errors.push(`[${name}] ${err.message}`);
      console.error(`✗ ${name}: ${err.message}`);
      continue;
    }

    const fresh = items.filter((it) => !src.seen.includes(it.id)).sort(byDate);
    const wanted = fresh.filter((it) => shouldSync(it, config.filter));
    // 被過濾掉的直接記為已看過，之後不再判斷
    for (const it of fresh) if (!wanted.includes(it)) markSeen(src, it.id);

    if (!src.initialized) {
      // 第一次執行：預設只發最新 N 篇，其餘標記已讀，避免洗版
      // 來源設定 firstRunPostLatest: "all" 則搬全部舊文（由舊到新，分批發）
      const n = cfg.firstRunPostLatest ?? config.firstRun?.postLatest ?? 3;
      const keep = n === 'all' ? wanted : n > 0 ? wanted.slice(-n) : [];
      for (const it of wanted) if (!keep.includes(it)) markSeen(src, it.id);
      queue.push(...keep);
      src.initialized = true;
      console.log(`• ${name}: 首次執行，抓到 ${items.length} 篇，要發 ${keep.length} 篇`);
    } else {
      queue.push(...wanted);
      console.log(`• ${name}: 抓到 ${items.length} 篇，新貼文 ${wanted.length} 篇`);
    }
  }

  queue.sort(byDate);
  const max = config.discord?.maxPostsPerRun ?? 10;
  const batch = queue.slice(0, max);
  if (queue.length > max) console.log(`• 本次只發 ${max} 篇，剩下 ${queue.length - max} 篇下次再發`);
  // 還有沒發完的來源，下次繼續抓完整歷史
  for (const name of Object.keys(config.sources)) {
    if (!state.sources?.[name]) continue;
    state.sources[name].backfilling = queue.slice(max).some((it) => it.source === name);
  }

  for (const item of batch) {
    const payload = buildPayload(item, config.sources[item.source], config.discord);
    if (DRY_RUN) {
      console.log(`\n[dry-run] ${item.id}\n${JSON.stringify(payload, null, 2)}`);
      continue;
    }
    try {
      await postToDiscord(webhook, payload);
      markSeen(sourceState(state, item.source), item.id);
      await saveState(STATE_PATH, state); // 每發一篇就存，中途失敗也不會重發
      console.log(`✓ 已發送 ${item.id}`);
    } catch (err) {
      errors.push(`[discord] ${item.id}: ${err.message}`);
      console.error(`✗ 發送失敗 ${item.id}: ${err.message}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\n[dry-run] 共 ${batch.length} 篇會被發送，state 未變更`);
  } else {
    await saveState(STATE_PATH, state);
  }

  if (errors.length) {
    console.error(`\n有 ${errors.length} 個錯誤：\n${errors.join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
