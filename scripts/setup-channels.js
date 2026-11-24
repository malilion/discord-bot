/**
 * 一鍵建立 Discord 頻道結構（依 channels.json）
 *
 *   DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=123 node scripts/setup-channels.js
 *   加 --dry-run 只列出會做什麼，不實際建立
 *
 * - 已存在的同名分類／頻道會略過，可以重複執行
 * - 會在 syncTarget 頻道建立 Webhook，並印出網址（請放到 GitHub Secret：DISCORD_WEBHOOK_URL）
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://discord.com/api/v10';
const DRY_RUN = process.argv.includes('--dry-run');

const TYPES = { text: 0, voice: 2, category: 4, announcement: 5, forum: 15 };
const SEND_MESSAGES = 1n << 11n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

async function api(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        'X-Audit-Log-Reason': 'setup-channels script',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      await sleep((data.retry_after ?? 1) * 1000 + 250);
      continue;
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  throw new Error(`${method} ${path} 一直被速率限制`);
}

// Discord 會把文字頻道名稱轉小寫、空白換成 -，比對時要用同樣規則
const normalize = (name, type) =>
  type === TYPES.voice || type === TYPES.category ? name.trim() : name.trim().toLowerCase().replace(/\s+/g, '-');

async function createChannel(def, parentId, existing) {
  const wantedType = TYPES[def.type ?? 'text'];
  const found = existing.find(
    (c) => c.parent_id === (parentId ?? null) && normalize(c.name, c.type) === normalize(def.name, wantedType),
  );
  if (found) {
    console.log(`  ↷ 已存在：${def.name}`);
    return found;
  }

  const body = {
    name: def.name,
    type: wantedType,
    parent_id: parentId,
    topic: def.topic,
  };
  if (def.readOnly) {
    // @everyone 的 role id 就是 guild id
    body.permission_overwrites = [{ id: guildId, type: 0, deny: SEND_MESSAGES.toString(), allow: '0' }];
  }

  if (DRY_RUN) {
    console.log(`  + [dry-run] ${def.name}（${def.type ?? 'text'}${def.readOnly ? '，唯讀' : ''}）`);
    return { id: `dry-${def.name}`, name: def.name };
  }

  try {
    const ch = await api('POST', `/guilds/${guildId}/channels`, body);
    console.log(`  + 已建立：${def.name}`);
    return ch;
  } catch (err) {
    // 公告／論壇頻道需要先把伺服器開成「社群伺服器」，不行就退回一般文字頻道
    if (err.status === 400 && (wantedType === TYPES.announcement || wantedType === TYPES.forum)) {
      console.warn(`  ! ${def.name} 無法建立為 ${def.type}（可能尚未啟用社群伺服器），改建一般文字頻道`);
      const ch = await api('POST', `/guilds/${guildId}/channels`, { ...body, type: TYPES.text });
      console.log(`  + 已建立：${def.name}（文字）`);
      return ch;
    }
    throw err;
  }
}

async function ensureWebhook(channel) {
  if (DRY_RUN) {
    console.log(`  🔗 [dry-run] 會在 ${channel.name} 建立 Webhook`);
    return;
  }
  const hooks = await api('GET', `/channels/${channel.id}/webhooks`);
  const hook = hooks.find((h) => h.name === '資源同步') ?? (await api('POST', `/channels/${channel.id}/webhooks`, { name: '資源同步' }));
  console.log(`\n🔗 「${channel.name}」的同步 Webhook 網址（請當作密碼保管，貼到 GitHub Secret DISCORD_WEBHOOK_URL）：`);
  console.log(`   https://discord.com/api/webhooks/${hook.id}/${hook.token}\n`);
}

async function main() {
  if (!guildId) throw new Error('請設定 DISCORD_GUILD_ID（伺服器 ID）');
  if (!token && !DRY_RUN) throw new Error('請設定 DISCORD_BOT_TOKEN');

  const layout = JSON.parse(await readFile(join(ROOT, 'channels.json'), 'utf8'));
  const existing = token ? await api('GET', `/guilds/${guildId}/channels`) : [];

  for (const cat of layout.categories) {
    console.log(`\n${cat.name}`);
    const category = await createChannel({ name: cat.name, type: 'category' }, undefined, existing);
    for (const def of cat.channels) {
      const ch = await createChannel(def, category.id, existing);
      if (def.syncTarget) await ensureWebhook(ch);
    }
  }
  console.log('\n完成 ✅');
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  if (/HTTP 403/.test(err.message)) console.error('  → Bot 需要「管理頻道」和「管理 Webhook」權限');
  process.exit(1);
});
