import type { ExternalEvent } from './types';
import { addDays } from './date';

/* Lets the overlay be judged before a Google project exists. Generated
   relative to today so the preview always lands on visible days. */
export function sampleEvents(): ExternalEvent[] {
  return [
    {
      id: 'sample-1',
      ownerId: '0',
      title: 'Reservation: Superior Double Room – Paris',
      startsAt: `${addDays(4)}T09:00`,
      endsAt: `${addDays(8)}T05:00`,
      allDay: false,
      calendar: 'Personal',
    },
    {
      id: 'sample-2',
      ownerId: '0',
      title: 'Flight to Montréal (AC 871)',
      startsAt: `${addDays(4)}T08:10`,
      endsAt: `${addDays(4)}T15:45`,
      allDay: false,
      calendar: 'Personal',
    },
    {
      id: 'sample-3',
      ownerId: '0',
      title: 'Flight to Toronto (AC 421)',
      startsAt: `${addDays(8)}T17:30`,
      endsAt: `${addDays(8)}T19:01`,
      allDay: false,
      calendar: 'Personal',
    },
    {
      id: 'sample-4',
      ownerId: '1',
      // Titles are shared by default. A null title is the opt-in
      // busy-only shape — kept here so that path stays visible.
      title: 'Design review',
      startsAt: `${addDays(2)}T14:00`,
      endsAt: `${addDays(2)}T16:00`,
      allDay: false,
      calendar: 'Work',
    },
    {
      id: 'sample-5',
      ownerId: '1',
      title: 'Yoga',
      startsAt: `${addDays(1)}T07:30`,
      endsAt: `${addDays(1)}T08:30`,
      allDay: false,
      calendar: 'Personal',
    },
  ];
}
