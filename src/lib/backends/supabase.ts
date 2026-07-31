import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type {
  Backend,
  BackendHandlers,
  ExternalEventInput,
  NewActivity,
} from '../backend';
import type { Activity, AuditLog, ExternalEvent } from '../types';
import { iso } from '../date';
import type { Config } from '../config';
import { getClient } from '../auth';

const pad = (n: number) => String(n).padStart(2, '0');

/** App form ("2026-08-03" or "2026-08-03T19:30") -> timestamptz. */
function toTimestamptz(v: string): string {
  const [datePart, timePart] = v.split('T');
  const [y, m, d] = (datePart ?? '').split('-').map(Number);
  const [hh, mm] = (timePart ?? '00:00').split(':').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0).toISOString();
}

/** timestamptz -> app form, rendered in the reader's own timezone. */
function fromTimestamptz(v: string | null, allDay: boolean): string | null {
  if (!v) return null;
  const d = new Date(v);
  const date = iso(d);
  return allDay ? date : `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ActivityRow {
  id: string;
  space_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  created_by: string;
  date_time: string | null;
  ends_at?: string | null;
  all_day: boolean;
  created_at: string;
  updated_at: string | null;
}

/* Writes are not optimistic: the row must land in Postgres first. We still
   refresh the list ourselves after each write so the UI doesn't depend on
   Realtime being subscribed (Realtime remains for the other phone). */
export class SupabaseBackend implements Backend {
  readonly name = 'supabase' as const;

  private client!: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private handlers!: BackendHandlers;
  private spaceId: string;
  private uid = '';

  constructor(private config: Config) {
    this.spaceId = config.spaceId;
  }

  async init(handlers: BackendHandlers): Promise<void> {
    this.handlers = handlers;

    if (!this.spaceId) {
      throw new Error('No space yet — sign out and sign back in.');
    }

    const client = await getClient(this.config);
    if (!client) {
      throw new Error('Supabase isn’t configured');
    }
    this.client = client;

    const { data: sessionData } = await this.client.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      throw new Error('Sign in first — this space needs an authenticated user.');
    }
    this.uid = user.id;

    await this.refresh();

    this.channel = this.client
      .channel(`space:${this.spaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'activities',
          filter: `space_id=eq.${this.spaceId}`,
        },
        () => void this.refreshActivities(),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_logs',
          filter: `space_id=eq.${this.spaceId}`,
        },
        () => void this.refreshLogs(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'external_events',
          filter: `space_id=eq.${this.spaceId}`,
        },
        () => void this.refreshExternal(),
      )
      .subscribe((status) => {
        handlers.onLive(status === 'SUBSCRIBED', status === 'SUBSCRIBED' ? 'Live' : 'Connecting');
      });
  }

  dispose(): void {
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = null;
  }

  async create(input: NewActivity): Promise<void> {
    // Re-check auth right before write — a stale client can "succeed" with
    // zero rows under RLS when the JWT isn't actually attached.
    const { data: userData, error: userErr } = await this.client.auth.getUser();
    if (userErr || !userData.user) {
      throw new Error('Session expired — sign out and sign back in.');
    }
    this.uid = userData.user.id;

    if (!this.spaceId) {
      throw new Error('No space yet — sign out and sign back in.');
    }

    const row: Record<string, unknown> = {
      space_id: this.spaceId,
      title: input.title,
      description: input.description || null,
      image_url: input.image_url || null,
      created_by: this.uid,
      date_time: input.date_time ? toTimestamptz(input.date_time) : null,
      all_day: !input.date_time || input.date_time.length <= 10,
    };
    // Only send ends_at when set — older DBs without the column still work,
    // and null spans don't need the field.
    if (input.ends_at) row.ends_at = toTimestamptz(input.ends_at);

    const { data, error } = await this.client
      .from('activities')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      const detail = [error.message, error.details, error.hint]
        .filter(Boolean)
        .join(' — ');
      throw new Error(detail || 'Could not save');
    }
    if (!data) {
      throw new Error(
        'Save was blocked (no row returned). In Supabase, confirm schema.sql + migrations ran and you’re a member of the space.',
      );
    }

    // Show the new row immediately, then reconcile with a full refresh.
    this.handlers.onActivities([
      mapActivity(data as ActivityRow),
      ...(await this.fetchActivities()).filter((a) => a.id !== data.id),
    ]);
    void this.refreshLogs();
  }

  async patch(id: string, changes: Partial<Activity>): Promise<void> {
    const patch: Record<string, unknown> = {};
    if ('title' in changes) patch.title = changes.title;
    if ('description' in changes) patch.description = changes.description;
    if ('image_url' in changes) patch.image_url = changes.image_url;
    if ('date_time' in changes) {
      patch.date_time = changes.date_time ? toTimestamptz(changes.date_time) : null;
      patch.all_day = !changes.date_time || changes.date_time.length <= 10;
      // Unscheduling drops the end date too; a bucket-list item has no span.
      if (!changes.date_time) patch.ends_at = null;
    }
    if ('ends_at' in changes) {
      patch.ends_at = changes.ends_at ? toTimestamptz(changes.ends_at) : null;
    }
    const { error } = await this.client.from('activities').update(patch).eq('id', id);
    if (error) throw error;
    await this.refresh();
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from('activities').delete().eq('id', id);
    if (error) throw error;
    await this.refresh();
  }

  async replaceExternal(events: ExternalEventInput[]): Promise<void> {
    const { data: userData, error: userErr } = await this.client.auth.getUser();
    if (userErr || !userData.user) {
      throw new Error('Session expired — sign out and sign back in.');
    }
    this.uid = userData.user.id;
    if (!this.spaceId) {
      throw new Error('No space yet — sign out and sign back in.');
    }

    const { error: delErr } = await this.client
      .from('external_events')
      .delete()
      .eq('space_id', this.spaceId)
      .eq('owner_id', this.uid);
    if (delErr) {
      throw mapExternalError(delErr);
    }

    if (events.length) {
      const rows = events.map((e) => ({
        space_id: this.spaceId,
        owner_id: this.uid,
        source_id: e.sourceId,
        title: e.title,
        starts_at: toTimestamptz(e.startsAt),
        ends_at: toTimestamptz(e.endsAt),
        all_day: e.allDay,
        calendar_name: e.calendar,
        updated_at: new Date().toISOString(),
      }));
      // Chunk so one bad row doesn’t hide behind a giant payload failure.
      const chunk = 80;
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        const { data, error: insErr } = await this.client
          .from('external_events')
          .insert(slice)
          .select('id');
        if (insErr) throw mapExternalError(insErr);
        if (!data?.length) {
          throw new Error(
            'Calendar rows didn’t save — check you’re signed in and migration 003 grants are applied',
          );
        }
      }
    }

    await this.refreshExternal();
  }

  /* ---------------- internals ---------------- */

  private async refresh(): Promise<void> {
    await Promise.all([
      this.refreshActivities(),
      this.refreshLogs(),
      this.refreshExternal(),
    ]);
  }

  private async fetchActivities(): Promise<Activity[]> {
    const { data, error } = await this.client
      .from('activities')
      .select('*')
      .eq('space_id', this.spaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as ActivityRow[]).map(mapActivity);
  }

  private async refreshActivities(): Promise<void> {
    this.handlers.onActivities(await this.fetchActivities());
  }

  private async refreshLogs(): Promise<void> {
    const { data, error } = await this.client
      .from('audit_logs')
      .select('*')
      .eq('space_id', this.spaceId)
      .order('timestamp', { ascending: false })
      .limit(200);
    if (error || !data) return;
    this.handlers.onLogs(data as AuditLog[]);
  }

  private async refreshExternal(): Promise<void> {
    const { data, error } = await this.client
      .from('external_events')
      .select('*')
      .eq('space_id', this.spaceId)
      .order('starts_at', { ascending: true });
    if (error) {
      // Table missing until migration 003 is applied — don’t brick the app.
      if (/external_events|schema cache/i.test(error.message)) {
        this.handlers.onExternal([]);
        return;
      }
      console.error(error);
      return;
    }
    this.handlers.onExternal(((data ?? []) as ExternalRow[]).map(mapExternal));
  }

  /** Exposed so settings can show who you're actually signed in as. */
  get userId(): string {
    return this.uid;
  }

  get configRef(): Config {
    return this.config;
  }
}

function mapExternalError(err: { message?: string; code?: string }): Error {
  const msg = err.message ?? 'Calendar sync failed';
  if (/external_events|schema cache|does not exist/i.test(msg)) {
    return new Error(
      'Calendar sharing isn’t set up yet — run migrations/003_external_events.sql in Supabase',
    );
  }
  if (/permission denied|42501/i.test(msg) || err.code === '42501') {
    return new Error(
      'No permission to save calendar overlays — re-run migrations/003_external_events.sql (includes grants)',
    );
  }
  if (/foreign key|23503/i.test(msg) || err.code === '23503') {
    return new Error('Space or profile missing — sign out and sign back in, then import again');
  }
  return new Error(msg);
}

function mapActivity(r: ActivityRow): Activity {
  return {
    id: r.id,
    space_id: r.space_id,
    title: r.title,
    description: r.description,
    image_url: r.image_url,
    created_by: r.created_by,
    date_time: fromTimestamptz(r.date_time, r.all_day),
    ends_at: fromTimestamptz(r.ends_at ?? null, r.all_day),
    all_day: r.all_day,
    created_at: r.created_at,
    updated_at: r.updated_at ?? undefined,
  };
}

interface ExternalRow {
  id: string;
  owner_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  calendar_name: string;
}

function mapExternal(r: ExternalRow): ExternalEvent {
  return {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    startsAt: fromTimestamptz(r.starts_at, r.all_day) ?? r.starts_at,
    endsAt: fromTimestamptz(r.ends_at, r.all_day) ?? r.ends_at,
    allDay: r.all_day,
    calendar: r.calendar_name,
  };
}
