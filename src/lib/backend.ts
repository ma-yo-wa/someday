import type { Activity, AuditLog, ExternalEvent } from './types';

export interface NewActivity {
  title: string;
  description?: string | null;
  image_url?: string | null;
  date_time?: string | null;
  ends_at?: string | null;
}

/** One imported overlay row, before it has a database id. */
export interface ExternalEventInput {
  sourceId: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  calendar: string;
}

/** What a backend pushes back up into the store. Both implementations
 *  drive the UI through these same three callbacks, so a local write and
 *  a remote realtime event land on exactly one code path. */
export interface BackendHandlers {
  onActivities(list: Activity[]): void;
  onLogs(list: AuditLog[]): void;
  onExternal(list: ExternalEvent[]): void;
  onLive(live: boolean, label: string): void;
}

export interface Backend {
  readonly name: 'local' | 'supabase';
  init(handlers: BackendHandlers): Promise<void>;
  create(input: NewActivity): Promise<void>;
  patch(id: string, changes: Partial<Activity>): Promise<void>;
  remove(id: string): Promise<void>;
  /** Replace this user’s imported calendar overlay for the space. */
  replaceExternal(events: ExternalEventInput[]): Promise<void>;
  dispose(): void;
}

export const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
