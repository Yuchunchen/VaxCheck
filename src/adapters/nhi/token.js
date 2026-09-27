// 健保雲端 JWT(sessionStorage.token)解析。只取 UserID(僅供雜湊比對)、姓名(只顯示)、性別、生日
import { normDate } from '../../engine/dates.js';

export function decodeJwt(token) {
  if (!token) return null;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

export function userFromPayload(p) {
  if (!p) return null;
  const sex = p.UserSex === 'M' || p.UserSex === '男' ? 'M' : p.UserSex === 'F' || p.UserSex === '女' ? 'F' : null;
  return { userId: p.UserID || null, name: p.UserName || '', sex, birthDate: normDate(p.UserBirthday), exp: p.exp || null };
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text).trim().toUpperCase()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
