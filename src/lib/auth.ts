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

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<void> {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase isn’t configured');
  const { error } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
}

export async function signUpWithPassword(
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase isn’t configured');
  const name = displayName.trim();
  if (!name) throw new Error('Add a name — it shows on your avatar');

  const { data, error } = await sb.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      // handle_new_user reads this into profiles.display_name (avatar letter).
      data: { display_name: name },
    },
  });
  if (error) throw error;
  // With “Confirm email” on, Supabase creates the user but returns no session
  // until they click a link — which breaks the in-app / PWA flow.
  if (!data.session) {
    throw new Error(
      'Account created, but email confirmation is still on in Supabase. Turn off Authentication → Providers → Email → Confirm email, then sign in.',
    );
  }

  // Belt-and-suspenders if the trigger used a stale default.
  // App reads public.profiles — Auth “Display name” in the dashboard is separate.
  if (data.user) {
    const { error: profErr } = await sb
      .from('profiles')
      .update({ display_name: name })
      .eq('id', data.user.id);
    if (profErr) throwSb(profErr);
  }
}

export async function signOut(): Promise<void> {
  const sb = await getClient();
  if (!sb) return;
  await sb.auth.signOut();
}

/** If signup ran before the “auto-create space” migration, make one now. */
export async function ensureSpace(): Promise<SpaceInfo | null> {
  const existing = await loadSpace();
  if (existing) return existing;

  const sb = await getClient();
  if (!sb) return null;
  const { data: sess } = await sb.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return null;

  const { error } = await sb.from('spaces').insert({
    partner_1_id: uid,
    name: 'Someday',
  });
  if (error) throw error;
  return loadSpace();
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

  const metaName = metaDisplayName(sess.session?.user?.user_metadata);
  const nameOf = (id: string | null) => {
    const fromProfile = profiles?.find((p) => p.id === id)?.display_name?.trim();
    // "Me"/"You" are app placeholders, not real names — prefer Auth metadata.
    if (fromProfile && !isPlaceholderName(fromProfile)) return fromProfile;
    if (id === uid && metaName) return metaName;
    if (fromProfile) return fromProfile;
    return null;
  };

  const me: 0 | 1 = space.partner_1_id === uid ? 0 : 1;
  let myName = nameOf(uid) ?? 'Me';
  const partnerName = nameOf(partnerId);

  // Write Alice (etc.) into profiles when Auth has it but the row still says Me.
  const rowName = profiles?.find((p) => p.id === uid)?.display_name?.trim() ?? '';
  if (metaName && (isPlaceholderName(rowName) || !rowName)) {
    await sb.from('profiles').update({ display_name: metaName }).eq('id', uid);
    myName = metaName;
  }

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
  const clean = name.trim();
  if (!clean) return;

  const { error: profErr } = await sb
    .from('profiles')
    .update({ display_name: clean })
    .eq('id', uid);
  if (profErr) throwSb(profErr);

  // Keep Auth dashboard “Display name” in sync with the app.
  const { error: authErr } = await sb.auth.updateUser({
    data: { display_name: clean },
  });
  if (authErr) throw authErr;

  const config = loadConfig();
  const names: [string, string] = [...config.names];
  names[config.me] = clean;
  saveConfig({ ...config, names });
}

function metaDisplayName(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  for (const key of ['display_name', 'full_name', 'name'] as const) {
    const v = meta[key];
    if (typeof v === 'string' && v.trim() && !isPlaceholderName(v)) return v.trim();
  }
  return null;
}

function isPlaceholderName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return !n || n === 'me' || n === 'you';
}

/** supabase-js still returns plain { message, … } objects, not Error. */
function throwSb(error: { message?: string; hint?: string; code?: string }): never {
  const msg = error.message?.trim() || 'Something went wrong';
  const hint = error.hint?.trim();
  // Missing RPC = invites migration never ran on this project.
  if (/peek_invite|join_space/i.test(msg) && /could not find the function/i.test(msg)) {
    throw new Error(
      'Invite isn’t set up on the server yet. In Supabase SQL, run migrations/001_spans_and_invites.sql.',
    );
  }
  throw new Error(hint && hint !== msg ? `${msg} (${hint})` : msg);
}

export async function peekInvite(code: string): Promise<InvitePeek | null> {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase isn’t configured');
  const cleaned = code.trim().toLowerCase();
  if (!cleaned) throw new Error('That invite link is missing a code');
  const { data, error } = await sb.rpc('peek_invite', { code: cleaned });
  if (error) throwSb(error);
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
  const cleaned = code.trim().toLowerCase();
  if (!cleaned) throw new Error('That invite link is missing a code');
  const fn = bringItems ? 'join_space_bringing_items' : 'join_space';
  const { error } = await sb.rpc(fn, { code: cleaned });
  if (error) throwSb(error);
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
