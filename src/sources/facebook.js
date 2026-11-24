import { fetchJson, MissingCredentialsError } from '../util.js';

/**
 * 抓 Facebook 粉專貼文
 * 需要環境變數 FB_PAGE_ID、FB_PAGE_ACCESS_TOKEN（從長效使用者 token 換出的粉專 token 不會過期）
 * 文件：https://developers.facebook.com/docs/graph-api/reference/page/feed
 */
export async function fetchFacebook(cfg, env) {
  const pageId = env.FB_PAGE_ID;
  const token = env.FB_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) throw new MissingCredentialsError('尚未設定 FB_PAGE_ID 或 FB_PAGE_ACCESS_TOKEN');

  const version = cfg.graphApiVersion || 'v23.0';
  const fields = 'id,message,permalink_url,created_time,full_picture,attachments{url,title,unshimmed_url}';
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/posts?fields=${encodeURIComponent(fields)}&limit=25&access_token=${encodeURIComponent(token)}`;
  const { data = [] } = await fetchJson(url);

  return data
    .filter((p) => p.message) // 沒有文字的（例如只換大頭貼）略過
    .map((p) => {
      const att = p.attachments?.data?.[0];
      return {
        id: `facebook:${p.id}`,
        source: 'facebook',
        url: p.permalink_url,
        text: p.message,
        linkUrl: att?.unshimmed_url || att?.url,
        linkTitle: att?.title,
        image: p.full_picture,
        publishedAt: p.created_time,
      };
    });
}
