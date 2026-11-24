import { fetchJson, MissingCredentialsError } from '../util.js';

/**
 * 抓自己的 Threads 貼文
 * 需要環境變數 THREADS_ACCESS_TOKEN（長效 token，60 天到期，可用 refresh 延長）
 * 文件：https://developers.facebook.com/docs/threads/threads-media
 */
export async function fetchThreads(cfg, env) {
  const token = env.THREADS_ACCESS_TOKEN;
  if (!token) throw new MissingCredentialsError('尚未設定 THREADS_ACCESS_TOKEN');

  const fields = 'id,media_type,media_url,thumbnail_url,permalink,text,timestamp,username,is_quote_post';
  const url = `https://graph.threads.net/v1.0/me/threads?fields=${fields}&limit=25&access_token=${encodeURIComponent(token)}`;
  const { data = [] } = await fetchJson(url);

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

/** 延長長效 token 的效期（回傳新的 token，需手動更新到 GitHub Secret） */
export async function refreshThreadsToken(token) {
  const url = `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`;
  return fetchJson(url);
}
