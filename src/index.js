import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fetchThreads, fetchThreadReplies } from './sources/threads.js';
import { fetchFacebook } from './sources/facebook.js';
import { fetchRss } from './sources/rss.js';
import { shouldSync } from './filter.js';
import { buildPayload, buildReplyPayload, postToDiscord } from './discord.js';
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
  if (!DRY_RUN) checkWebhook('DISCORD_WEBHOOK_URL', webhook);

  const queue = [];
  const errors = [];

  for (const [name, cfg] of Object.entries(config.sources)) {
    if (!cfg.enabled) continue;
    // 來源可以指定自己的 webhook（例如部落格發到另一個論壇）；還沒設定就先略過，不要發錯地方
    if (cfg.webhookEnv && !DRY_RUN) {
      if (!process.env[cfg.webhookEnv]) {
        console.log(`– ${name}: 尚未設定 ${cfg.webhookEnv}，略過`);
        continue;
      }
      checkWebhook(cfg.webhookEnv, process.env[cfg.webhookEnv]);
    }
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
    const sourceCfg = config.sources[item.source];
    // 來源可覆寫標籤（不同論壇的標籤 ID 不同）
    const discordCfg = sourceCfg.tags ? { ...config.discord, tags: sourceCfg.tags } : config.discord;
    const payload = buildPayload(item, sourceCfg, discordCfg);
    const target = (sourceCfg.webhookEnv && process.env[sourceCfg.webhookEnv]) || webhook;
    if (DRY_RUN) {
      console.log(`\n[dry-run] ${item.id}\n${JSON.stringify(payload, null, 2)}`);
      continue;
    }
    try {
      const msg = await postToDiscord(target, payload);
      markSeen(sourceState(state, item.source), item.id);
      // 論壇貼文的 channel_id 就是這篇的討論串，之後留言放進去
      if (item.source === 'threads' && config.discord?.forumChannel && msg?.channel_id) {
        state.replies ??= {};
        state.replies[item.id] = { threadId: msg.channel_id, publishedAt: item.publishedAt, seen: [], done: false };
      }
      await saveState(STATE_PATH, state); // 每發一篇就存，中途失敗也不會重發
      console.log(`✓ 已發送 ${item.id}`);
    } catch (err) {
      errors.push(`[discord] ${item.id}: ${err.message}`);
      console.error(`✗ 發送失敗 ${item.id}: ${err.message}`);
    }
  }

  if (!DRY_RUN && config.sources.threads?.replies?.enabled && config.discord?.forumChannel) {
    await syncReplies(state, config.sources.threads.replies, webhook, errors);
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

/** 確認是 Discord Webhook 網址；只印出網址開頭，避免把密碼外洩到 log */
function checkWebhook(name, value) {
  if (/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/.test(value.trim())) return;
  let hint = '無法解析的字串';
  try { const u = new URL(value.trim()); hint = `${u.host}/${u.pathname.split('/')[1] ?? ''}/…`; } catch {}
  throw new Error(`${name} 不是 Webhook 網址（目前是 ${hint}）。請到頻道設定 → 整合 → Webhook →「複製 Webhook 網址」後重新設定`);
}

/**
 * 把 Threads 留言搬進對應的論壇貼文
 * - 剛搬的貼文：一次補齊所有留言
 * - 最近 followDays 天內的貼文：每次檢查有沒有新留言
 */
async function syncReplies(state, cfg, webhook, errors) {
  const entries = Object.entries(state.replies ?? {});
  if (!entries.length) return;
  const followMs = (cfg.followDays ?? 14) * 86400_000;
  const maxPerRun = cfg.maxPerRun ?? 300;
  const now = Date.now();
  let posted = 0;

  for (const [postId, entry] of entries) {
    if (posted >= maxPerRun) break;
    const recent = now - (Date.parse(entry.publishedAt) || 0) < followMs;
    if (entry.done && !recent) continue;

    let replies;
    try {
      replies = await fetchThreadReplies(postId, process.env, { limit: cfg.maxPerPost ?? 100 });
    } catch (err) {
      if (/HTTP (400|403)/.test(err.message) && /permission|OAuth|scope/i.test(err.message)) {
        console.log('! Threads token 沒有讀取留言的權限（threads_read_replies），本次略過留言');
        return;
      }
      errors.push(`[replies] ${postId}: ${err.message}`);
      console.error(`✗ 抓留言失敗 ${postId}: ${err.message}`);
      continue;
    }

    const fresh = replies.filter((r) => !entry.seen.includes(r.id));
    let ok = true;
    for (const reply of fresh) {
      if (posted >= maxPerRun) { ok = false; break; }
      try {
        await postToDiscord(webhook, buildReplyPayload(reply), { threadId: entry.threadId });
        entry.seen.push(reply.id);
        posted++;
      } catch (err) {
        ok = false;
        errors.push(`[replies] ${postId}/${reply.id}: ${err.message}`);
        console.error(`✗ 留言發送失敗 ${reply.id}: ${err.message}`);
        break;
      }
    }
    entry.done = ok;
    await saveState(STATE_PATH, state);
    if (fresh.length) console.log(`💬 ${postId}: 搬了 ${fresh.length} 則留言`);
  }

  // 太舊而且已經補齊的貼文不再追蹤，讓 state 保持精簡
  for (const [postId, entry] of Object.entries(state.replies)) {
    if (entry.done && now - (Date.parse(entry.publishedAt) || 0) >= followMs) delete state.replies[postId];
  }
  if (posted) console.log(`• 本次共搬了 ${posted} 則留言`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
