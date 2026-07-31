import { create } from 'zustand';
import type { Activity, AuditLog, ExternalEvent } from './types';
import type { Backend, ExternalEventInput, NewActivity } from './backend';
import { LocalBackend } from './backends/local';
import { loadConfig, saveConfig, isSupabaseConfigured, type Config } from './config';
import {
  authConfigured,
  currentSession,
  ensureSpace,
  pendingInvite,
  signOut,
  type SpaceInfo,
} from './auth';
import { iso, todayISO } from './date';

export type Screen = 'bucket' | 'calendar';

/** The two things this app makes. A plan has a date; a bucket-list item
 *  is the same thing before anyone has committed to one. */
export type Kind = 'plan' | 'bucket';

interface Toast {
  id: number;
  text: string;
}

export type AuthPhase = 'loading' | 'local' | 'signedOut' | 'signedIn';

interface AppState {
  ready: boolean;
  authPhase: AuthPhase;
  backendName: 'local' | 'supabase';
  live: boolean;
  liveLabel: string;

  activities: Activity[];
  logs: AuditLog[];
  external: ExternalEvent[];

  config: Config;
  space: SpaceInfo | null;

  screen: Screen;
  /** Selected day, YYYY-MM-DD. */
  picked: string;
  /** First of the visible month, YYYY-MM-DD. */
  cursor: string;
  /* How far the active screen's scroller has travelled. The nav bar owns
     none of the scrolling but has to react to all of it, the way a large
     title collapses in a real app. */
  navScroll: number;

  detailId: string | null;
  /* Kept apart from detailId because an imported event isn't an activity
     and never becomes one — different data, different sheet. */
  externalId: string | null;
  /* Which of the two things you're making, chosen before the form opens
     rather than inferred from whether a date got filled in. null = shut. */
  composerMode: Kind | null;
  /* The little menu that asks which one. */
  addOpen: boolean;
  settingsOpen: boolean;
  inviteShareOpen: boolean;
  inviteCode: string | null;
  toasts: Toast[];

  boot: () => Promise<void>;
  refreshSpace: () => Promise<void>;
  signOutUser: () => Promise<void>;
  connect: (next: Partial<Config>) => Promise<void>;
  disconnect: () => Promise<void>;

  create: (input: NewActivity) => Promise<void>;
  patch: (id: string, changes: Partial<Activity>) => Promise<void>;
  remove: (id: string) => Promise<void>;

  setScreen: (s: Screen) => void;
  setPicked: (d: string) => void;
  setCursor: (d: string) => void;
  setNavScroll: (y: number) => void;
  openDetail: (id: string | null) => void;
  openExternal: (id: string | null) => void;
  setAddOpen: (v: boolean) => void;
  openComposer: (mode: Kind) => void;
  closeComposer: () => void;
  setSettingsOpen: (v: boolean) => void;
  setInviteShareOpen: (v: boolean) => void;
  setInviteCode: (code: string | null) => void;
  updateConfig: (patch: Partial<Config>) => void;
  setExternal: (events: ExternalEvent[]) => void;
  syncExternal: (events: ExternalEventInput[]) => Promise<void>;
  toast: (text: string) => void;
}

let backend: Backend | null = null;
let toastSeq = 0;

const firstOfMonth = (d: Date) => iso(new Date(d.getFullYear(), d.getMonth(), 1));

export const useApp = create<AppState>()((set, get) => {
  const handlers = {
    onActivities: (list: Activity[]) => set({ activities: list }),
    onLogs: (list: AuditLog[]) => set({ logs: list }),
    onExternal: (list: ExternalEvent[]) => set({ external: list }),
    onLive: (live: boolean, liveLabel: string) => set({ live, liveLabel }),
  };

  async function start(next: Backend): Promise<void> {
    backend?.dispose();
    backend = next;
    await next.init(handlers);
    set({ backendName: next.name, ready: true });
  }

  /* The Supabase client is over half the bundle and is dead weight until
     someone actually connects a project, so it loads on demand. */
  async function supabaseBackend(config: Config): Promise<Backend> {
    const { SupabaseBackend } = await import('./backends/supabase');
    return new SupabaseBackend(config);
  }

  return {
    ready: false,
    authPhase: 'loading',
    backendName: 'local',
    live: false,
    liveLabel: 'On this device',

    activities: [],
    logs: [],
    external: [],

    config: loadConfig(),
    space: null,

    screen: 'calendar',
    picked: todayISO(),
    cursor: firstOfMonth(new Date()),
    navScroll: 0,
    detailId: null,
    externalId: null,
    composerMode: null,
    addOpen: false,
    settingsOpen: false,
    inviteShareOpen: false,
    inviteCode: pendingInvite(),
    toasts: [],

    async boot() {
      const config = get().config;

      // Auth path: project credentials present, space comes from the session.
      if (authConfigured(config)) {
        try {
          const session = await currentSession();
          if (!session) {
            set({ authPhase: 'signedOut', ready: true });
            return;
          }
          const space = await ensureSpace();
          set({ space, config: loadConfig(), authPhase: 'signedIn' });
          if (space) {
            await start(await supabaseBackend({ ...loadConfig(), spaceId: space.id }));
            void import('./push').then((m) => m.syncPush());
          } else {
            set({ ready: true });
          }
          return;
        } catch (err) {
          get().toast(err instanceof Error ? err.message : 'Could not sign in');
        }
      }

      // Manual connect path (demo / older setup with a pasted space id).
      if (isSupabaseConfigured(config)) {
        try {
          set({ authPhase: 'local' });
          await start(await supabaseBackend(config));
          return;
        } catch (err) {
          get().toast(err instanceof Error ? err.message : 'Could not connect');
        }
      }

      set({ authPhase: 'local' });
      await start(new LocalBackend());
    },

    async refreshSpace() {
      const space = await ensureSpace();
      set({ space, config: loadConfig(), authPhase: 'signedIn' });
      if (space) {
        await start(await supabaseBackend({ ...loadConfig(), spaceId: space.id }));
      }
    },

    async signOutUser() {
      await signOut();
      set({ space: null, authPhase: 'signedOut', activities: [], logs: [] });
      backend?.dispose();
      backend = null;
      set({ ready: true, backendName: 'local', live: false, liveLabel: 'Signed out' });
    },

    async connect(next) {
      const config = { ...get().config, ...next };
      set({ config });
      saveConfig(config);
      if (!isSupabaseConfigured(config) && !authConfigured(config)) {
        get().toast('Needs a URL and a key');
        return;
      }
      // With URL+key only, go through the auth gate.
      if (authConfigured(config) && !config.spaceId) {
        set({ authPhase: 'signedOut', ready: true });
        get().toast('Now sign in with your email');
        return;
      }
      try {
        await start(await supabaseBackend(config));
        set({ authPhase: 'local' });
        get().toast('Connected — syncing live');
      } catch (err) {
        await start(new LocalBackend());
        get().toast(err instanceof Error ? err.message : 'Could not connect');
      }
    },

    async disconnect() {
      // Keep project URL/key (build-time defaults); only drop the space binding.
      const config = { ...get().config, spaceId: '' };
      set({ config, space: null });
      saveConfig(config);
      set({ authPhase: 'signedOut' });
      backend?.dispose();
      backend = null;
      set({ ready: true, backendName: 'local', live: false, liveLabel: 'Signed out' });
      get().toast('Signed out');
    },

    async create(input) {
      if (!backend) throw new Error('Not connected — try signing out and back in');
      await backend.create(input);
    },

    async patch(id, changes) {
      if (!backend) throw new Error('Not connected — try signing out and back in');
      try {
        await backend.patch(id, changes);
      } catch (err) {
        get().toast(err instanceof Error ? err.message : 'Could not save');
      }
    },

    async remove(id) {
      if (!backend) throw new Error('Not connected — try signing out and back in');
      try {
        await backend.remove(id);
      } catch (err) {
        get().toast(err instanceof Error ? err.message : 'Could not delete');
      }
    },

    // A new screen arrives at the top, so the title starts expanded.
    setScreen: (screen) => set({ screen, navScroll: 0 }),
    setPicked: (picked) => set({ picked }),
    setCursor: (cursor) => set({ cursor }),
    setNavScroll: (navScroll) => {
      // Fires on every scroll frame, so don't wake subscribers unless the
      // value they render from actually moved.
      if (Math.abs(get().navScroll - navScroll) > 0.5) set({ navScroll });
    },
    openDetail: (detailId) => set({ detailId }),
    openExternal: (externalId) => set({ externalId }),
    setAddOpen: (addOpen) => set({ addOpen }),
    // The menu always closes behind the form, so backing out of the form
    // returns you to the app rather than to the menu you just left.
    openComposer: (composerMode) => set({ composerMode, addOpen: false }),
    closeComposer: () => set({ composerMode: null }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setInviteShareOpen: (inviteShareOpen) => set({ inviteShareOpen }),
    setInviteCode: (inviteCode) => set({ inviteCode }),

    updateConfig: (patch) => {
      const config = { ...get().config, ...patch };
      set({ config });
      saveConfig(config);
    },

    setExternal: (external) => set({ external }),

    async syncExternal(events) {
      if (!backend) throw new Error('Not connected');
      if (backend.name !== 'supabase') {
        throw new Error(
          'Calendar sharing needs a signed-in cloud space — sign out and sign back in, then import again',
        );
      }
      await backend.replaceExternal(events);
    },

    toast: (text) => {
      const id = ++toastSeq;
      set({ toasts: [...get().toasts, { id, text }] });
      setTimeout(() => {
        set({ toasts: get().toasts.filter((t) => t.id !== id) });
      }, 2600);
    },
  };
});

/** Name of whichever partner created a row, for history lines. */
export function partnerName(config: Config, createdBy: string): string {
  // Local demo uses "0" / "1"; signed-in mode uses profile UUIDs.
  if (createdBy === '0' || createdBy === '1') {
    const idx = createdBy === '1' ? 1 : 0;
    return config.names[idx] || (idx === 0 ? 'Me' : 'You');
  }
  const space = useApp.getState().space;
  if (space) {
    if (createdBy === space.myId) return space.myName;
    if (createdBy === space.partner1Id || createdBy === space.partner2Id) {
      return space.partnerName ?? config.names[1 - space.me] ?? 'Them';
    }
  }
  return 'Someone';
}
