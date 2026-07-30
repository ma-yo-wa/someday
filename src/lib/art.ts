/* A glyph per item, matched off the title. Cheap, and it does more work
   than an icon set would: an emoji reads at 28px on a crowded agenda row
   and tells you what kind of thing it is before you read a word. */
const ART: Array<[RegExp, string]> = [
  [/flight|fly|airline|airport|boarding|depart|arriv/i, '✈️'],
  [/hotel|reservation|booking|check-?in|airbnb|room|suite/i, '🏨'],
  [/train|rail|via |amtrak/i, '🚆'],
  [/hike|hiking|trail|mountain|camp|banff|cabin/i, '🏔'],
  [/beach|sunset|ocean|island|swim/i, '🌅'],
  [/kayak|canoe|paddle|river|boat|cruise|harbou?r/i, '🛶'],
  [/bike|cycl|ride/i, '🚲'],
  [/dinner|restaurant|ramen|sushi|food|brunch|lunch|eat|waffle/i, '🍜'],
  [/coffee|cafe|espresso/i, '☕'],
  [/movie|film|cinema|screening/i, '🎞'],
  [/concert|music|gig|festival|album/i, '🎶'],
  [/museum|gallery|exhibit/i, '🖼'],
  [/birthday|anniversary|celebrat|wedding/i, '🎂'],
  [/read|book|library/i, '📖'],
  [/garden|plant|flower|picnic|park/i, '🌿'],
  [/dance|salsa|club/i, '💃'],
  [/cook|bake|kitchen|recipe/i, '🍳'],
  [/game|arcade|board/i, '🎲'],
  [/spa|massage|rest|lazy|sleep/i, '🛁'],
  [/drive|road ?trip/i, '🛣'],
  [/gym|workout|run|yoga|training|climb/i, '🏃'],
  [/doctor|dentist|appointment|clinic|therapy/i, '🩺'],
  [/call|sync|standup|stand-up|1:1|meeting|review|interview/i, '💬'],
  [/deadline|due|launch|ship/i, '🚩'],
];

export function artFor(title: string | null | undefined): string {
  if (!title) return '🗓';
  for (const [re, glyph] of ART) if (re.test(title)) return glyph;
  return '✦';
}
