const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('keepit.token');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw Object.assign(new Error(res.statusText), { status: res.status, body: await res.json().catch(() => null) });
  return res.status === 204 ? (undefined as T) : res.json();
}
