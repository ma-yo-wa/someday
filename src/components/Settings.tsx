import { useEffect, useState } from 'react';
import Sheet from './Sheet';
import Switch from './Switch';
import GcalPicker from './GcalPicker';
import { useApp } from '../lib/store';
import { updateDisplayName } from '../lib/auth';
import {
  clearGoogleToken,
  connectGoogle,
  fetchGoogleEvents,
  googleClientId,
  googleToken,
  listGoogleCalendars,
  saveGoogleCalendar,
  savedGoogleCalendar,
  type GoogleCalendar,
} from '../lib/gcal';
import {
  disablePush,
  enablePush,
  pushState,
  registerPush,
  syncPush,
  type PushState,
} from '../lib/push';
import f from './Form.module.css';

function pushCopy(state: PushState, partnerName: string | null | undefined): string {
  const who = partnerName?.trim() || 'your person';
  switch (state) {
    case 'unsupported':
      return "This browser can't do web push";
    case 'ios-install':
      return 'Open Someday from the Home Screen icon to turn notifications on';
    case 'denied':
      return 'Blocked — iPhone Settings → Someday → Notifications';
    case 'granted-idle':
      return 'Allowed — turn the switch on to finish subscribing';
    case 'on':
      return `On — when ${who} joins, locks in a date, or updates notes`;
    default:
      return `Hear when ${who} joins, locks in a date, or updates notes`;
  }
}

export default function Settings() {
  const open = useApp((st) => st.settingsOpen);
  const setOpen = useApp((st) => st.setSettingsOpen);
  const config = useApp((st) => st.config);
  const updateConfig = useApp((st) => st.updateConfig);
  const signOutUser = useApp((st) => st.signOutUser);
  const authPhase = useApp((st) => st.authPhase);
  const space = useApp((st) => st.space);
  const syncExternal = useApp((st) => st.syncExternal);
  const setInviteShareOpen = useApp((st) => st.setInviteShareOpen);
  const refreshSpace = useApp((st) => st.refreshSpace);
  const toast = useApp((st) => st.toast);

  const signedIn = authPhase === 'signedIn';
  const [myName, setMyName] = useState(space?.myName ?? config.names[config.me]);
  const [gcalOn, setGcalOn] = useState(Boolean(googleToken()));
  const [gcalName, setGcalName] = useState(savedGoogleCalendar()?.summary ?? null);
  const [gcalList, setGcalList] = useState<GoogleCalendar[] | null>(null);
  const [gcalBusy, setGcalBusy] = useState(false);
  const [bell, setBell] = useState<PushState>('default');
  const [bellBusy, setBellBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMyName(space?.myName ?? config.names[config.me]);
    setGcalOn(Boolean(googleToken()));
    setGcalName(savedGoogleCalendar()?.summary ?? null);
    void registerPush().then(() => setBell(pushState()));
    void syncPush().then(() => setBell(pushState()));
  }, [open, space?.myName, config.names, config.me]);

  async function importGoogleCalendar(cal: GoogleCalendar) {
    const token = googleToken();
    if (!token) {
      toast('Connect Google again');
      setGcalOn(false);
      setGcalList(null);
      return;
    }
    setGcalBusy(true);
    try {
      saveGoogleCalendar(cal);
      setGcalName(cal.summary);
      setGcalList(null);
      const owner = space?.myId ?? String(config.me);
      const events = await fetchGoogleEvents(token, owner, cal.id);
      await syncExternal(events);
      setGcalOn(true);
      const withPlace = events.filter((e) => e.location).length;
      toast(
        events.length
          ? withPlace
            ? `${cal.summary} — ${events.length} events · ${withPlace} with a place`
            : `${cal.summary} — ${events.length} events (no places on those Google events)`
          : `${cal.summary} — nothing in the next few months`,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t load that calendar');
    } finally {
      setGcalBusy(false);
    }
  }

  async function pickGoogleCalendar(cal: GoogleCalendar) {
    await importGoogleCalendar(cal);
  }

  async function refreshGoogleOverlay() {
    const cal = savedGoogleCalendar();
    if (!cal) {
      toast('Choose a calendar first');
      return;
    }
    await importGoogleCalendar(cal);
  }

  function closeGcalPicker() {
    const had = savedGoogleCalendar();
    setGcalList(null);
    if (!had) {
      clearGoogleToken();
      setGcalOn(false);
      setGcalName(null);
    }
  }

  return (
    <>
    <Sheet open={open} onClose={() => setOpen(false)} heading="Settings">
      {signedIn && (
        <>
          <span className={f.label}>Your name</span>
          <div className={f.group}>
            <input
              className={f.input}
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              onBlur={() => {
                void (async () => {
                  const clean = myName.trim();
                  if (!clean || clean === space?.myName) return;
                  try {
                    await updateDisplayName(clean);
                    updateConfig({ names: loadNames(config.me, clean, config.names) });
                    await refreshSpace();
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Couldn’t save name');
                  }
                })();
              }}
              placeholder="Mayowa"
            />
          </div>

          <span className={f.label}>Partner</span>
          <div className={f.group}>
            {space?.partner2Id && space.partnerName ? (
              <div className={f.listRow}>
                <span className={f.rowLabel}>{space.partnerName}</span>
              </div>
            ) : (
              <button
                type="button"
                className={f.listRow}
                onClick={() => {
                  setOpen(false);
                  setInviteShareOpen(true);
                }}
              >
                <span className={f.rowLabel}>Invite your person</span>
                <span className={f.hint}>›</span>
              </button>
            )}
          </div>
          {!space?.partner2Id && (
            <p className={f.rowNote}>
              One open seat — share an invite when you’re ready
            </p>
          )}
        </>
      )}

      <span className={f.label}>Calendars</span>
      <div className={f.group}>
        <div className={f.listRow}>
          <span className={f.rowLabel}>Google Calendar</span>
          <Switch
            on={gcalOn}
            disabled={gcalBusy}
            label="Connect Google Calendar"
            onChange={(on) => {
              void (async () => {
                if (!on) {
                  clearGoogleToken();
                  saveGoogleCalendar(null);
                  setGcalList(null);
                  setGcalName(null);
                  setGcalOn(false);
                  void syncExternal([])
                    .then(() => toast('Google Calendar disconnected'))
                    .catch((err) =>
                      toast(err instanceof Error ? err.message : 'Couldn’t clear overlay'),
                    );
                  return;
                }
                setGcalBusy(true);
                try {
                  const token = await connectGoogle();
                  const calendars = await listGoogleCalendars(token);
                  if (!calendars.length) {
                    setGcalOn(false);
                    toast('No calendars found on that Google account');
                    return;
                  }
                  setGcalOn(true);
                  setGcalList(calendars);
                } catch (err) {
                  setGcalOn(false);
                  toast(err instanceof Error ? err.message : 'Google connect failed');
                } finally {
                  setGcalBusy(false);
                }
              })();
            }}
          />
        </div>
        {gcalOn && (
          <button
            type="button"
            className={f.listRow}
            disabled={gcalBusy}
            onClick={() => {
              void (async () => {
                const token = googleToken();
                if (!token) {
                  toast('Connect Google again');
                  setGcalOn(false);
                  return;
                }
                setGcalBusy(true);
                try {
                  setGcalList(await listGoogleCalendars(token));
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Couldn’t list calendars');
                } finally {
                  setGcalBusy(false);
                }
              })();
            }}
          >
            <span className={f.rowLabel}>{gcalName ?? 'Choose calendar'}</span>
            <span className={f.hint}>{gcalName ? 'Change ›' : '›'}</span>
          </button>
        )}
        {gcalOn && gcalName && (
          <button
            type="button"
            className={f.listRow}
            disabled={gcalBusy}
            onClick={() => void refreshGoogleOverlay()}
          >
            <span className={f.rowLabel}>Refresh overlay</span>
            <span className={f.hint}>{gcalBusy ? '…' : '›'}</span>
          </button>
        )}
      </div>
      <p className={f.rowNote}>
        Overlay one calendar so your person can see what reshapes the week —
        trips, stays, appointments. Skip daily routines and private clutter;
        still not plans. Best from Safari/Chrome the first time you connect
      </p>

      <span className={f.label}>Notifications</span>
      <div className={f.group}>
        <div className={f.listRow}>
          <span className={f.rowLabel}>Push</span>
          <Switch
            on={bell === 'on'}
            disabled={bellBusy || bell === 'ios-install' || bell === 'unsupported'}
            label="Notifications"
            onChange={(on) => {
              if (bellBusy) return;
              void (async () => {
                setBellBusy(true);
                try {
                  const msg = on ? await enablePush() : await disablePush();
                  await registerPush();
                  setBell(pushState());
                  toast(msg);
                } finally {
                  setBellBusy(false);
                }
              })();
            }}
          />
        </div>
      </div>
      <p className={f.rowNote}>
        {bellBusy ? 'Working…' : pushCopy(bell, space?.partnerName)}
      </p>

      {(!googleClientId() || !config.vapidPublicKey.trim()) && (
        <details className={f.advanced}>
          <summary className={f.advancedSum}>Advanced</summary>
          {!googleClientId() && (
            <>
              <span className={f.label}>Google client ID</span>
              <div className={f.group}>
                <input
                  className={f.input}
                  value={config.googleClientId}
                  onChange={(e) => updateConfig({ googleClientId: e.target.value })}
                  placeholder="xxxx.apps.googleusercontent.com"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
              <p className={f.rowNote}>
                Usually set at deploy — only paste here if Calendar won’t connect
              </p>
            </>
          )}
          {!config.vapidPublicKey.trim() && (
            <>
              <span className={f.label}>VAPID public key</span>
              <div className={f.group}>
                <input
                  className={f.input}
                  value={config.vapidPublicKey}
                  onChange={(e) => updateConfig({ vapidPublicKey: e.target.value })}
                  placeholder="BNxxx…"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
              <p className={f.rowNote}>
                Usually set at deploy — only paste here if push won’t subscribe
              </p>
            </>
          )}
        </details>
      )}

      <div className={f.row}>
        <button
          type="button"
          className={`${f.btn} ${f.ghost}`}
          onClick={() => void signOutUser()}
        >
          Sign out
        </button>
      </div>
    </Sheet>

    {/* Outside Settings sheet — nested fixed sheets get clipped by the
        parent’s transform and never cover the screen. */}
    <GcalPicker
      open={!!gcalList?.length}
      calendars={gcalList ?? []}
      selectedId={savedGoogleCalendar()?.id ?? null}
      busy={gcalBusy}
      onClose={closeGcalPicker}
      onPick={(cal) => void pickGoogleCalendar(cal)}
    />
    </>
  );
}

function loadNames(
  me: 0 | 1,
  myName: string,
  current: [string, string],
): [string, string] {
  return me === 0 ? [myName, current[1]] : [current[0], myName];
}
