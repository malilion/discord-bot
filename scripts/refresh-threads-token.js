/**
 * 延長 Threads 長效 token 效期（每 60 天到期，建議每月跑一次）
 *   THREADS_ACCESS_TOKEN=xxx node scripts/refresh-threads-token.js
 * 執行後把印出的新 token 更新到 GitHub Secret：THREADS_ACCESS_TOKEN
 */
import { refreshThreadsToken } from '../src/sources/threads.js';

const token = process.env.THREADS_ACCESS_TOKEN;
if (!token) {
  console.error('請設定 THREADS_ACCESS_TOKEN');
  process.exit(1);
}
const { access_token, expires_in } = await refreshThreadsToken(token);
console.log(`新的 token（${Math.round(expires_in / 86400)} 天後到期）：\n${access_token}`);
