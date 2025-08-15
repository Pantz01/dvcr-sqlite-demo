export const API = process.env.NEXT_PUBLIC_API as string;

export function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeaders() };
}

export function getUser(): { id: number; name: string; email: string; role: string } | null {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('user') || 'null'); }
  catch { return null; }
}
