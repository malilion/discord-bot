import { fetchJson, truncate } from './util.js';

/**
 * Malilion AI Radar 每日摘要
 * 讀 https://malilion.github.io/Malilion-AI-Radar/ 每小時更新的 JSON，
 * 每天整理成一篇論壇貼文：AI 業界動態、GitHub 趨勢、Hacker News、版本更新、HF 熱門論文、近期活動
 */
const DAY = 86400_000;
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** 台北時間的日期字串與小時 */
export function taipeiNow(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 3600_000);
  const date = t.toISOString().slice(0, 10);
  return { date, hour: t.getUTCHours(), weekday: WEEKDAY[t.getUTCDay()], md: `${t.getUTCMonth() + 1}/${t.getUTCDate()}` };
}

/** 現在該不該發今天的日報 */
export function shouldPostRadar(cfg, radarState = {}, now = new Date()) {
  const { date, hour } = taipeiNow(now);
  if (radarState.lastDate === date) return false;
  if (!radarState.lastDate) return true; // 第一次設定好就先發一篇
  return hour >= (cfg.postAfterHour ?? 9);
}

const esc = (s) => String(s ?? '').replace(/[[\]]/g, (c) => (c === '[' ? '［' : '］')).replace(/\s+/g, ' ').trim();
const line = (it, extra = '') => `• [${truncate(esc(it.title), 80)}](${it.link})${extra}`;
const within = (it, ms, now) => now - (Date.parse(it.pubDate) || 0) <= ms;

function section(title, color, lines, max = 1000) {
  if (!lines.length) return null;
  let desc = '';
  for (const l of lines) {
    if ((desc + l + '\n').length > max) break;
    desc += `${l}\n`;
  }
  return { title, color, description: desc.trim() };
}

export function buildRadarPayload(data, cfg = {}, now = new Date()) {
  const t = now.getTime();
  const ai = data.ai?.items ?? [];
  const dev = data.dev?.items ?? [];
  const papers = data.papers?.items ?? [];
  const events = data.events?.items ?? [];
  const n = cfg.itemsPerSection ?? 6;

  const aiTop = ai.filter((i) => within(i, DAY, t))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, n + 2)
    .map((i) => line(i, ` · ${i.source}`));
  const gh = dev.filter((i) => i.source === 'GitHub 今日趨勢').slice(0, n).map((i) => line(i));
  const hn = dev.filter((i) => i.type === 'hn').slice(0, n).map((i) => line(i, ` · ${i.source.replace('Hacker News ', 'HN ')}`));
  // 每個專案只列最新一版，避免 LangChain 這種一次發一堆子套件的洗版
  const seenProject = new Set();
  const releases = dev.filter((i) => i.type === 'releases' && within(i, 2 * DAY, t))
    .filter((i) => !seenProject.has(i.source) && seenProject.add(i.source)).slice(0, n)
    .map((i) => `• [${esc(i.source)} ${esc(i.title)}](${i.link})`);
  const daily = papers.filter((p) => /daily/i.test(p.type ?? '')).length ? papers.filter((p) => /daily/i.test(p.type)) : papers;
  const hf = [...daily].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 5)
    .map((p) => line(p, p.upvotes ? ` · 👍 ${p.upvotes}` : ''));
  const ev = events.filter((e) => (Date.parse(e.start) || 0) >= t - 3600_000).slice(0, 5).map((e) => {
    const d = taipeiNow(new Date(e.start));
    return line(e, ` · ${d.md}（${d.weekday}）${e.source ? ` · ${e.source}` : ''}`);
  });

  const embeds = [
    section('🏢 AI 業界動態（24 小時內）', 0xc0392b, aiTop),
    section('🔥 GitHub 今日趨勢', 0x24292f, gh),
    section('🗞️ Hacker News', 0xff6600, hn),
    section('🚀 版本更新', 0x2ecc71, releases),
    section('📄 Hugging Face 熱門論文', 0xffcc4d, hf),
    section('📅 近期社群活動', 0x5865f2, ev),
  ].filter(Boolean);

  const base = (cfg.baseUrl ?? '').replace(/\/$/, '');
  const { md, weekday } = taipeiNow(now);
  embeds.push({
    color: 0x2c2c2c,
    description: `📰 看完整版面：[Malilion AI Radar](${base}/)　✉️ [本期電子報](${base}/newsletter/latest.html)`,
    footer: { text: '資料來源：Malilion AI Radar，每小時自動更新' },
    timestamp: now.toISOString(),
  });

  return {
    username: cfg.username || '科技雷達',
    avatar_url: cfg.avatarUrl || undefined,
    thread_name: `📡 科技雷達日報｜${md}（${weekday}）`,
    embeds: embeds.slice(0, 10),
    allowed_mentions: { parse: [] },
  };
}

export async function fetchRadarData(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  const get = (f) => fetchJson(`${base}/${f}`).catch(() => null); // 單一來源壞掉不影響其他區塊
  const [ai, dev, papers, events] = await Promise.all(['ai.json', 'dev.json', 'hf-papers.json', 'events.json'].map(get));
  if (!ai && !dev) throw new Error(`讀不到 ${base} 的資料`);
  return { ai, dev, papers, events };
}
