#!/usr/bin/env node
/**
 * 把 Facebook 粉專 token 存進 GitHub Secrets（token 不會印在畫面上）
 *
 * 用法：
 *   1. 在 Graph API Explorer 產生「使用者 token」，再用 Access Token Debugger 按「延長存取權杖」，
 *      把延長後的長效 token 複製到剪貼簿
 *   2. node scripts/save-facebook-token.js
 *
 * 程式會：讀剪貼簿 → 確認是長效 token → 列出你管理的粉專讓你選 →
 *        用 gh 存 FB_PAGE_ID、FB_PAGE_ACCESS_TOKEN → 試抓一篇貼文 → 清空剪貼簿
 * 從長效使用者 token 換出來的粉專 token 不會過期。
 */
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const REPO = process.env.REPO || 'malilion/discord-bot';
const API = 'https://graph.facebook.com/v23.0';

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

async function get(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error?.message || `HTTP ${res.status}`);
  return body;
}

function setSecret(name, value) {
  execFileSync('gh', ['secret', 'set', name, '-R', REPO], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
}

const userToken = execFileSync('pbpaste', { encoding: 'utf8' }).trim();
if (!/^EAA[\w-]{50,}$/.test(userToken)) die('剪貼簿裡不是 Facebook token（應該是 EAA 開頭的一長串）。請重新複製延長後的 token');

// 確認是長效 token，不然換出來的粉專 token 一小時就過期
try {
  const { data } = await get(`debug_token?input_token=${encodeURIComponent(userToken)}`, userToken);
  if (!data?.is_valid) die('這個 token 已經失效，請重新產生');
  const days = data.expires_at ? (data.expires_at * 1000 - Date.now()) / 86400_000 : Infinity;
  if (days < 7) die('這是短效 token（約 1 小時到期）。請先到 Access Token Debugger 按「延長存取權杖」，複製延長後的 token 再執行');
  const scopes = data.scopes ?? [];
  const missing = ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content'].filter((s) => !scopes.includes(s));
  if (missing.length) die(`token 少了權限：${missing.join('、')}。請在 Graph API Explorer 勾選後重新產生`);
} catch (err) {
  die(`檢查 token 失敗：${err.message}`);
}

let pages;
try {
  ({ data: pages = [] } = await get('me/accounts?fields=id,name,access_token&limit=100', userToken));
} catch (err) {
  die(`讀取粉專清單失敗：${err.message}`);
}
if (!pages.length) die('這個帳號沒有可管理的粉專，或授權時沒有勾選粉專');

let page = pages[0];
if (pages.length > 1) {
  console.log('你管理的粉專：');
  pages.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = Number(await rl.question('要同步哪一個？輸入編號：'));
  rl.close();
  page = pages[ans - 1] ?? die('編號不對');
}

// 先試抓，確定能讀到貼文再存
try {
  const { data = [] } = await get(`${page.id}/posts?fields=id&limit=1`, page.access_token);
  console.log(`• 「${page.name}」讀取正常（試抓到 ${data.length} 篇）`);
} catch (err) {
  die(`讀不到「${page.name}」的貼文：${err.message}`);
}

setSecret('FB_PAGE_ID', page.id);
setSecret('FB_PAGE_ACCESS_TOKEN', page.access_token);
execFileSync('pbcopy', { input: '' }); // 清空剪貼簿，避免 token 留在裡面
console.log(`✓ 已存好「${page.name}」的 FB_PAGE_ID 和 FB_PAGE_ACCESS_TOKEN，剪貼簿也清空了`);
