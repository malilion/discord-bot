import { fetchJson, truncate } from './util.js';

/**
 * Malilion AI Radar → 依類別分流到不同論壇
 * 讀 https://malilion.github.io/Malilion-AI-Radar/ 每小時更新的 JSON，每天每個類別發一篇論壇貼文：
 *   📡 科技雷達：📰 AI 新聞、🏢 官方動態、🛠️ 開源工具、🚀 版本更新、📅 活動
 *   🎓 學習資源：📄 論文、📘 教學實作、🧠 研究與深度文章
 * 發過的連結會記住，隔天不會重複出現。
 */
const HOUR = 3600_000;
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

// 來源分類（依 AI Radar 的 source 名稱）
const RESEARCH_LABS = new Set(['Anthropic Research', 'Google Research', 'Apple Machine Learning Research', 'Microsoft Research']);
const ESSAYS = new Set(['Eugene Yan', 'Jay Alammar', 'Latent Space', 'Noema Magazine', 'LessWrong']);
const TUTORIALS = new Set(['Simon Willison', 'DEV Claude Code', 'DEV Codex', 'OpenAI 開發者社群', 'n8n Blog']);
const TOOL_SOURCES = new Set(['GitHub 今日趨勢', 'GitHub 本週趨勢', 'GitHub Python 今日', 'Show HN', 'Cursor 論壇 Showcase']);

/** 類別定義：target 決定發到哪個論壇 */
export const CATEGORIES = [
  { key: 'news', target: 'radar', emoji: '📰', name: 'AI 新聞', color: 0xc0392b },
  { key: 'official', target: 'radar', emoji: '🏢', name: '官方動態', color: 0x2980b9 },
  { key: 'tools', target: 'radar', emoji: '🛠️', name: '開源工具', color: 0x24292f },
  { key: 'releases', target: 'radar', emoji: '🚀', name: '版本更新', color: 0x2ecc71 },
  { key: 'events', target: 'radar', emoji: '📅', name: '社群活動', color: 0x5865f2 },
  { key: 'papers', target: 'learn', emoji: '📄', name: '熱門論文', color: 0xffcc4d },
  { key: 'tutorials', target: 'learn', emoji: '📘', name: '教學實作', color: 0x3498db },
  { key: 'research', target: 'learn', emoji: '🧠', name: '研究與深度文章', color: 0x8e44ad },
];

/** 台北時間的日期字串與小時 */
export function taipeiNow(now = new Date()) {
  const t = new Date(now.getTime() + 8 * HOUR);
  return {
    date: t.toISOString().slice(0, 10),
    hour: t.getUTCHours(),
    weekday: WEEKDAY[t.getUTCDay()],
    md: `${t.getUTCMonth() + 1}/${t.getUTCDate()}`,
  };
}

/** 這個類別今天該不該發 */
export function shouldPostCategory(cfg, radarState, key, now = new Date()) {
  const { date, hour } = taipeiNow(now);
  const posted = radarState.posted ?? {};
  if (posted[key] === date) return false;
  if (!posted[key]) return true; // 第一次設定好就先發
  return hour >= (cfg.postAfterHour ?? 9);
}

const esc = (s) => String(s ?? '').replace(/[[\]]/g, (c) => (c === '[' ? '［' : '］')).replace(/\s+/g, ' ').trim();
const age = (it, now) => now - (Date.parse(it.pubDate) || 0);
const fresh = (hours) => (it, now) => !it.pubDate || age(it, now) <= hours * HOUR;
const line = (it, extra = '') => `• [${truncate(esc(it.title), 90)}](${it.link})${extra}`;

/** 從 AI Radar 資料挑出各類別的項目（尚未過濾已發過的） */
export function pickCategories(data, now = Date.now()) {
  const ai = data.ai?.items ?? [];
  const dev = data.dev?.items ?? [];
  const papers = data.papers?.items ?? [];
  const events = data.events?.items ?? [];
  const byScore = (a, b) => (b.score ?? 0) - (a.score ?? 0);
  const newest = (a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0);

  const daily = papers.some((p) => p.type === 'daily') ? papers.filter((p) => p.type === 'daily') : papers;

  return {
    news: [
      { title: '媒體報導', items: ai.filter((i) => i.type === 'media' && !ESSAYS.has(i.source) && fresh(36)(i, now)).sort(byScore), max: 8, suffix: (i) => ` · ${i.source}` },
      { title: 'Hacker News 熱議', items: dev.filter((i) => i.source === 'Hacker News 首頁' || i.source === 'HN 最新 AI'), max: 6, suffix: (i) => ` · ${i.source.replace('Hacker News ', 'HN ')}` },
    ],
    official: [
      { title: 'AI 公司官方部落格', items: ai.filter((i) => i.type === 'lab' && !RESEARCH_LABS.has(i.source) && fresh(48)(i, now)).sort(byScore), max: 8, suffix: (i) => ` · ${i.source}` },
    ],
    tools: [
      { title: 'GitHub 趨勢', items: dev.filter((i) => i.type === 'github'), max: 8, suffix: (i) => (i.summary ? ` — ${truncate(esc(i.summary), 60)}` : '') },
      { title: 'Show HN／社群作品', items: dev.filter((i) => i.source === 'Show HN' || i.source === 'Cursor 論壇 Showcase'), max: 5, suffix: () => '' },
    ],
    releases: [
      { title: '新版本', items: dev.filter((i) => i.type === 'releases' && fresh(72)(i, now)).sort(newest), max: 10, render: (i) => `• [${esc(i.source)} ${esc(i.title)}](${i.link})` },
    ],
    events: [
      { title: '近期活動', items: events.filter((e) => (Date.parse(e.start) || 0) >= now - HOUR).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), max: 6, render: (e) => {
        const d = taipeiNow(new Date(e.start));
        return line(e, ` · ${d.md}（${d.weekday}）${e.source ? ` · ${e.source}` : ''}`);
      } },
    ],
    papers: [
      { title: 'Hugging Face 每日熱門論文', items: [...daily].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)), max: 6, suffix: (p) => (p.upvotes ? ` · 👍 ${p.upvotes}` : '') },
    ],
    tutorials: [
      { title: '教學與實作筆記', items: dev.filter((i) => TUTORIALS.has(i.source) && fresh(72)(i, now)).sort(newest), max: 10, suffix: (i) => ` · ${i.source}` },
    ],
    research: [
      { title: '研究部落格', items: ai.filter((i) => RESEARCH_LABS.has(i.source) && fresh(120)(i, now)).sort(newest), max: 6, suffix: (i) => ` · ${i.source}` },
      { title: '深度文章', items: [...ai, ...dev].filter((i) => ESSAYS.has(i.source) && fresh(120)(i, now)).sort(newest), max: 6, suffix: (i) => ` · ${i.source}` },
    ],
  };
}

/**
 * 組出一個類別的論壇貼文；seen 是已發過的連結。
 * 回傳 { payload, links }，沒有新內容時回傳 null
 */
export function buildCategoryPost(cat, sections, seen = new Set(), cfg = {}, now = new Date()) {
  const links = [];
  const embeds = [];
  for (const s of sections) {
    const picked = [];
    for (const it of s.items) {
      if (!it.link || seen.has(it.link) || links.includes(it.link)) continue;
      picked.push(it);
      links.push(it.link);
      if (picked.length >= s.max) break;
    }
    if (!picked.length) continue;
    let desc = '';
    for (const it of picked) {
      const l = s.render ? s.render(it) : line(it, s.suffix ? s.suffix(it) : '');
      if ((desc + l).length > 3800) break;
      desc += `${l}\n`;
    }
    embeds.push({ title: s.title, color: cat.color, description: desc.trim() });
  }
  if (!embeds.length) return null;

  const base = (cfg.baseUrl ?? '').replace(/\/$/, '');
  const { md, weekday } = taipeiNow(now);
  embeds.push({
    color: 0x2c2c2c,
    description: `📰 完整版面：[Malilion AI Radar](${base}/)　✉️ [本期電子報](${base}/newsletter/latest.html)`,
    footer: { text: '資料來源：Malilion AI Radar，每小時自動更新' },
    timestamp: now.toISOString(),
  });

  const tags = [].concat(cfg.tags?.[cat.key] ?? []).filter(Boolean);
  return {
    links,
    payload: {
      username: cfg.username || '科技雷達',
      avatar_url: cfg.avatarUrl || undefined,
      thread_name: `${cat.emoji} ${cat.name}｜${md}（${weekday}）`,
      embeds: embeds.slice(0, 10),
      applied_tags: tags.length ? tags.slice(0, 5) : undefined,
      allowed_mentions: { parse: [] },
    },
  };
}

export async function fetchRadarData(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  const get = (f) => fetchJson(`${base}/${f}`).catch(() => null); // 單一來源壞掉不影響其他類別
  const [ai, dev, papers, events] = await Promise.all(['ai.json', 'dev.json', 'hf-papers.json', 'events.json'].map(get));
  if (!ai && !dev) throw new Error(`讀不到 ${base} 的資料`);
  return { ai, dev, papers, events };
}
