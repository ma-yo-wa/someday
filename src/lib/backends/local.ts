import type {
  Backend,
  BackendHandlers,
  ExternalEventInput,
  NewActivity,
} from '../backend';
import { uid } from '../backend';
import type { Activity, ActionType, AuditLog, ExternalEvent } from '../types';
import { addDays, describeDT } from '../date';
import { loadConfig } from '../config';

const KEY = 'someday.data.v1';

interface Snapshot {
  activities: Activity[];
  logs: AuditLog[];
  external: ExternalEvent[];
}

/* Demo mode is not fake-realtime: it syncs over BroadcastChannel, so two
   tabs side by side behave the way two phones will. In Supabase mode the
   history is written by database triggers; here the client has to stand
   in for them, which is why the log-writing lives next to every write. */
export class LocalBackend implements Backend {
  readonly name = 'local' as const;

  private handlers!: BackendHandlers;
  private channel: BroadcastChannel | null = null;
  private onStorage: ((e: StorageEvent) => void) | null = null;
  private data: Snapshot = { activities: [], logs: [], external: [] };

  async init(handlers: BackendHandlers): Promise<void> {
    this.handlers = handlers;
    this.read();
    if (!this.data.activities.length) this.seed();

    try {
      this.channel = new BroadcastChannel('someday');
      this.channel.onmessage = () => {
        this.read();
        this.emit();
      };
    } catch {
      // Safari <15.4 and friends: fall back to storage events, which fire
      // in other tabs but never in the one that wrote.
      this.onStorage = (e) => {
        if (e.key !== KEY) return;
        this.read();
        this.emit();
      };
      window.addEventListener('storage', this.onStorage);
    }

    handlers.onLive(false, 'On this device');
    this.emit();
  }

  dispose(): void {
    this.channel?.close();
    if (this.onStorage) window.removeEventListener('storage', this.onStorage);
  }

  async create(input: NewActivity): Promise<void> {
    const row: Activity = {
      id: uid(),
      title: input.title,
      description: input.description ?? null,
      image_url: input.image_url ?? null,
      date_time: input.date_time ?? null,
      ends_at: input.ends_at ?? null,
      all_day: !input.date_time || input.date_time.length <= 10,
      created_by: String(loadConfig().me),
      created_at: new Date().toISOString(),
    };
    this.data.activities.push(row);
    this.log(
      row.id,
      'created',
      row.date_time
        ? `created the plan “${row.title}”`
        : `added the idea “${row.title}”`,
    );
    if (row.date_time) {
      this.log(row.id, 'scheduled', `set it for ${describeDT(row.date_time)}`);
    }
    this.commit();
  }

  async patch(id: string, changes: Partial<Activity>): Promise<void> {
    const a = this.data.activities.find((x) => x.id === id);
    if (!a) return;

    if ('date_time' in changes && changes.date_time !== a.date_time) {
      const before = a.date_time;
      const after = changes.date_time ?? null;
      if (!before && after) {
        this.log(id, 'scheduled', `set it for ${describeDT(after)}`);
      } else if (before && !after) {
        this.log(id, 'unscheduled', 'moved it back to the ideas list');
      } else if (before && after) {
        this.log(id, 'rescheduled', `moved it to ${describeDT(after)}`);
      }
    }
    if ('title' in changes && changes.title !== a.title) {
      this.log(id, 'edited', `renamed it to “${changes.title}”`);
    }
    if ('description' in changes && changes.description !== a.description) {
      this.log(id, 'edited', 'updated the notes');
    }
    if ('image_url' in changes && changes.image_url !== a.image_url) {
      this.log(id, 'edited', 'changed the cover');
    }
    if ('ends_at' in changes && changes.ends_at !== a.ends_at) {
      this.log(
        id,
        'edited',
        changes.ends_at
          ? `made it run until ${describeDT(changes.ends_at)}`
          : 'made it a single day',
      );
    }

    Object.assign(a, changes, { updated_at: new Date().toISOString() });
    if ('date_time' in changes) {
      a.all_day = !a.date_time || a.date_time.length <= 10;
      // Going back to the bucket list takes the end date with it.
      if (!a.date_time) a.ends_at = null;
    }
    this.commit();
  }

  async remove(id: string): Promise<void> {
    const a = this.data.activities.find((x) => x.id === id);
    if (a) this.log(id, 'deleted', `deleted “${a.title}”`);
    this.data.activities = this.data.activities.filter((x) => x.id !== id);
    this.commit();
  }

  async replaceExternal(events: ExternalEventInput[]): Promise<void> {
    const me = String(loadConfig().me);
    const mine = events.map(
      (e): ExternalEvent => ({
        id: `gcal-${e.sourceId}`,
        ownerId: me,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        calendar: e.calendar,
      }),
    );
    this.data.external = [
      ...this.data.external.filter((e) => e.ownerId !== me),
      ...mine,
    ];
    this.commit();
  }

  /* ---------------- internals ---------------- */

  private log(activityId: string, action: ActionType, details: string): void {
    this.data.logs.push({
      id: uid(),
      activity_id: activityId,
      user_id: String(loadConfig().me),
      action_type: action,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  private read(): void {
    try {
      const raw = localStorage.getItem(KEY);
      this.data = raw
        ? (JSON.parse(raw) as Snapshot)
        : { activities: [], logs: [], external: [] };
      this.data.activities ??= [];
      this.data.logs ??= [];
      this.data.external ??= [];
    } catch {
      this.data = { activities: [], logs: [], external: [] };
    }
  }

  private commit(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* quota — keep the in-memory copy working anyway */
    }
    this.channel?.postMessage('changed');
    this.emit();
  }

  private emit(): void {
    this.handlers.onActivities([...this.data.activities]);
    this.handlers.onLogs([...this.data.logs]);
    this.handlers.onExternal([...this.data.external]);
  }

  private seed(): void {
    const now = Date.now();
    const mk = (
      title: string,
      description: string | null,
      date_time: string | null,
      by: 0 | 1,
      minutesAgo: number,
      ends_at: string | null = null,
    ): Activity => ({
      id: uid(),
      title,
      description,
      image_url: null,
      date_time,
      ends_at,
      all_day: !date_time || date_time.length <= 10,
      created_by: String(by),
      created_at: new Date(now - minutesAgo * 60000).toISOString(),
    });

    this.data.activities = [
      mk('Kayak the Grand River', 'Rent from the place by the bridge.', null, 0, 900),
      mk('Banff, properly', 'Not a long weekend. Two weeks.', null, 1, 780),
      mk('Learn to make dumplings', null, null, 0, 600),
      mk('That listening bar in the east end', null, null, 1, 420),
      mk('Dinner at Alma', 'Booked the 7:30.', `${addDays(3)}T19:30`, 1, 300),
      mk('Farmers market', null, addDays(6), 0, 180),
      mk('Prince Edward County', 'The cabin with the wood stove.', addDays(12), 1, 90, addDays(15)),
    ];
    this.data.logs = this.data.activities.map((a) => ({
      id: uid(),
      activity_id: a.id,
      user_id: a.created_by,
      action_type: 'created' as const,
      details: a.date_time
        ? `created the plan “${a.title}”`
        : `added the idea “${a.title}”`,
      timestamp: a.created_at,
    }));
    this.commit();
  }
}
