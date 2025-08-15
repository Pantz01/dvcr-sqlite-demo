export const API = process.env.NEXT_PUBLIC_API as string;

export function authHeaders() {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...authHeaders() };
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('user') || 'null'); }
  catch { return null; }
}
