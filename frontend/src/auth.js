import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const auth = url && key ? createClient(url, key) : null;

export async function apiFetch(url, options = {}) {
  const { data, error } = await auth.auth.getSession();
  if (error || !data.session) throw new Error('Sign in to continue.');
  return fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${data.session.access_token}` },
  });
}
