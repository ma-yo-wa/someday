import type { Config } from './config';
import { loadConfig, saveConfig } from './config';

export interface SpaceInfo {
  id: string;
  name: string;
  inviteCode: string;
  partner1Id: string;
  partner2Id: string | null;
  myId: string;
  myName: string;
  partnerName: string | null;
  /** 0 if you're partner_1, 1 if partner_2. */
  me: 0 | 1;
}

export interface InvitePeek {
  spaceId: string;
  spaceName: string;
  inviterName: string;
  isOpen: boolean;
}

type Client = Awaited<ReturnType<typeof makeClient>>;

let client: Client | null = null;

async function makeClient(url: string, key: string) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export function authConfigured(c: Config = loadConfig()): boolean {
  return Boolean(c.supabaseUrl && c.supabaseKey);
}

export async function getClient(c: Config = loadConfig()): Promise<Client | null> {
  if (!authConfigured(c)) return null;
  if (!client) client = await makeClient(c.supabaseUrl, c.supabaseKey);
  return client;
}

export async function currentSession() {
  const sb = await getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function sendCode(email: string): Promise<void> {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase isn’t configured');
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string): Promise<void> {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase isn’t configured');
  const { error } = await sb.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const sb = await getClient();
  if (!sb) return;
  await sb.auth.signOut();
}

export async function loadSpace(): Promise<SpaceInfo | null> {
  const sb = await getClient();
  if (!sb) return null;
  const { data: sess } = await sb.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return null;

  const { data: space, error } = await sb
    .from('spaces')
    .select('id, name, invite_code, partner_1_id, partner_2_id')
    .or(`partner_1_id.eq.${uid},partner_2_id.eq.${uid}`)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!space) return null;

  const partnerId =
    space.partner_1_id === uid ? space.partner_2_id : space.partner_1_id;
  const ids = [space.partner_1_id, partnerId].filter(Boolean) as string[];
  const { data: profiles } = await sb
    .from('profiles')
    .select('id, display_name')
    .in('id', ids);

  const nameOf = (id: string | null) =>
    profiles?.find((p) => p.id === id)?.display_name ?? null;

  const me: 0 | 1 = space.partner_1_id === uid ? 0 : 1;
  const myName = nameOf(uid) ?? 'Me';
  const partnerName = nameOf(partnerId);

  // Keep the local config in step so the rest of the app keeps working.
  const config = loadConfig();
  saveConfig({
    ...config,
    spaceId: space.id,
    me,
    names: me === 0 ? [myName, partnerName ?? 'You'] : [partnerName ?? 'You', myName],
  });

  return {
    id: space.id,
    name: space.name,
    inviteCode: space.invite_code,
    partner1Id: space.partner_1_id,
    partner2Id: space.partner_2_id,
    myId: uid,
    myName,
    partnerName,
    me,
  };
}

export async function updateDisplayName(name: string): Promise<void> {
  const sb = await getClient();
  if (!sb) return;
  const { data: sess } = await sb.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return;
  await sb.from('profiles').update({ display_name: name.trim() }).eq('id', uid);
}

export async function peekInvite(code: string): Promise<InvitePeek | null> {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase isn’t configured');
  const { data, error } = await sb.rpc('peek_invite', { code: code.trim().toLowerCase() });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    spaceId: row.space_id,
    spaceName: row.space_name,
    inviterName: row.inviter_name,
    isOpen: row.is_open,
  };
}

export async function joinInvite(code: string, bringItems = false): Promise<void> {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase isn’t configured');
  const fn = bringItems ? 'join_space_bringing_items' : 'join_space';
  const { error } = await sb.rpc(fn, { code: code.trim().toLowerCase() });
  if (error) throw error;
}

export function inviteUrl(code: string): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}?invite=${encodeURIComponent(code)}`;
}

export function pendingInvite(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('invite');
}

export function clearInviteFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('invite')) return;
  url.searchParams.delete('invite');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
