import { fetchJson, MissingCredentialsError } from '../util.js';

/**
 * 抓自己的 Threads 貼文
 * 需要環境變數 THREADS_ACCESS_TOKEN（長效 token，60 天到期，可用 refresh 延長）
 * 文件：https://developers.facebook.com/docs/threads/threads-media
 */
export async function fetchThreads(cfg, env, { fetchAll = false } = {}) {
  const token = env.THREADS_ACCESS_TOKEN;
  if (!token) throw new MissingCredentialsError('尚未設定 THREADS_ACCESS_TOKEN');

  const fields = 'id,media_type,media_url,thumbnail_url,permalink,text,timestamp,username,is_quote_post';
  let url = `https://graph.threads.net/v1.0/me/threads?fields=${fields}&limit=${fetchAll ? 100 : 25}&access_token=${encodeURIComponent(token)}`;
  const data = [];
  // fetchAll：沿著 paging.next 抓完整歷史（最多 50 頁 = 5000 篇）
  for (let page = 0; url && page < (fetchAll ? 50 : 1); page++) {
    const res = await fetchJson(url);
    data.push(...(res.data ?? []));
    url = res.paging?.next;
  }

  return data
    // REPOST_FACADE 是轉發別人的貼文，不同步
    .filter((p) => p.media_type !== 'REPOST_FACADE')
    .map((p) => ({
      id: `threads:${p.id}`,
      source: 'threads',
      url: p.permalink,
      text: p.text ?? '',
      image: p.media_type === 'IMAGE' ? p.media_url
        : p.media_type === 'VIDEO' ? p.thumbnail_url
        : undefined,
      author: p.username ? `@${p.username}` : undefined,
      publishedAt: p.timestamp,
    }));
}

/**
 * 抓一篇貼文底下的所有留言（含巢狀回覆），由舊到新
 * 需要 token 具備 threads_read_replies 權限
 */
export async function fetchThreadReplies(postId, env, { limit = 100 } = {}) {
  const token = env.THREADS_ACCESS_TOKEN;
  if (!token) throw new MissingCredentialsError('尚未設定 THREADS_ACCESS_TOKEN');
  const rawId = String(postId).replace(/^threads:/, '');
  const fields = 'id,text,username,permalink,timestamp,media_type,media_url,thumbnail_url';
  let url = `https://graph.threads.net/v1.0/${encodeURIComponent(rawId)}/conversation?fields=${fields}&reverse=false&limit=50&access_token=${encodeURIComponent(token)}`;
  const replies = [];
  while (url && replies.length < limit) {
    const res = await fetchJson(url);
    replies.push(...(res.data ?? []));
    url = res.paging?.next;
  }
  return replies.slice(0, limit).map((r) => ({
    id: r.id,
    username: r.username,
    text: r.text ?? '',
    url: r.permalink,
    image: r.media_type === 'IMAGE' ? r.media_url : r.media_type === 'VIDEO' ? r.thumbnail_url : undefined,
    publishedAt: r.timestamp,
  })).sort((a, b) => (Date.parse(a.publishedAt) || 0) - (Date.parse(b.publishedAt) || 0));
}

/** 延長長效 token 的效期（回傳新的 token，需手動更新到 GitHub Secret） */
export async function refreshThreadsToken(token) {
  const url = `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`;
  return fetchJson(url);
}
