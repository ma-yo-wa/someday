import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { Backend, BackendHandlers, NewActivity } from '../backend';
import type { Activity, AuditLog } from '../types';
import { iso } from '../date';
import type { Config } from '../config';

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
  ends_at: string | null;
  all_day: boolean;
  created_at: string;
  updated_at: string | null;
}

/* Writes are deliberately not optimistic. The insert goes to Postgres,
   the trigger writes history, and the realtime event is what updates the
   UI — so both partners' screens are driven by the same event and the
   history timeline can never drift from the item it describes. */
export class SupabaseBackend implements Backend {
  readonly name = 'supabase' as const;

  private client: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private handlers!: BackendHandlers;
  private spaceId: string;
  private uid = '';

  constructor(private config: Config) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey);
    this.spaceId = config.spaceId;
  }

  async init(handlers: BackendHandlers): Promise<void> {
    this.handlers = handlers;

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
      .subscribe((status) => {
        handlers.onLive(status === 'SUBSCRIBED', status === 'SUBSCRIBED' ? 'Live' : 'Connecting');
      });
  }

  dispose(): void {
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = null;
  }

  async create(input: NewActivity): Promise<void> {
    const { error } = await this.client.from('activities').insert({
      space_id: this.spaceId,
      title: input.title,
      description: input.description || null,
      image_url: input.image_url || null,
      created_by: this.uid,
      date_time: input.date_time ? toTimestamptz(input.date_time) : null,
      ends_at: input.ends_at ? toTimestamptz(input.ends_at) : null,
      all_day: !input.date_time || input.date_time.length <= 10,
    });
    if (error) throw error;
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
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from('activities').delete().eq('id', id);
    if (error) throw error;
  }

  /* ---------------- internals ---------------- */

  private async refresh(): Promise<void> {
    await Promise.all([this.refreshActivities(), this.refreshLogs()]);
  }

  private async refreshActivities(): Promise<void> {
    const { data, error } = await this.client
      .from('activities')
      .select('*')
      .eq('space_id', this.spaceId)
      .order('created_at', { ascending: false });
    if (error || !data) return;

    const rows = data as ActivityRow[];
    this.handlers.onActivities(
      rows.map<Activity>((r) => ({
        id: r.id,
        space_id: r.space_id,
        title: r.title,
        description: r.description,
        image_url: r.image_url,
        created_by: r.created_by,
        date_time: fromTimestamptz(r.date_time, r.all_day),
        ends_at: fromTimestamptz(r.ends_at, r.all_day),
        all_day: r.all_day,
        created_at: r.created_at,
        updated_at: r.updated_at ?? undefined,
      })),
    );
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

  /** Exposed so settings can show who you're actually signed in as. */
  get userId(): string {
    return this.uid;
  }

  get configRef(): Config {
    return this.config;
  }
}
