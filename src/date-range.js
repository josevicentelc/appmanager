const validDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
};

const dateFromToken = (token) => {
  const iso = String(token).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const spanish = String(token).match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  return spanish ? validDate(Number(spanish[3]), Number(spanish[2]), Number(spanish[1])) : null;
};

const localDate = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, days) => {
  const result = localDate(date);
  result.setDate(result.getDate() + days);
  return result;
};
const toLocalIsoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const spanishDate = (date) => `${date.getDate()} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][date.getMonth()]} de ${date.getFullYear()}`;
const monday = (date) => addDays(date, -((date.getDay() + 6) % 7));
const firstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const lastDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const firstDayOfQuarter = (date) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
const lastDayOfQuarter = (date) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3 + 3, 0);
const daysRange = (from, to) => ({ from: toLocalIsoDate(from), to: toLocalIsoDate(to) });
const sameDay = (date) => daysRange(date, date);
const nextWeekday = (date, weekday, includeToday = false) => {
  const offset = (weekday - date.getDay() + 7) % 7;
  return addDays(date, offset || (includeToday ? 0 : 7));
};
const weekendStart = (date) => date.getDay() === 0 ? addDays(date, -1) : nextWeekday(date, 6, true);
const currentWeekend = (date) => {
  const saturday = weekendStart(date);
  return daysRange(saturday, addDays(saturday, 1));
};
const previousWeekend = (date) => {
  const saturday = addDays(weekendStart(date), -7);
  return daysRange(saturday, addDays(saturday, 1));
};
const monthSegment = (date, segment) => {
  const startDay = segment === 'start' ? 1 : segment === 'middle' ? 11 : 21;
  const endDay = segment === 'start' ? 10 : segment === 'middle' ? 20 : lastDayOfMonth(date).getDate();
  return daysRange(new Date(date.getFullYear(), date.getMonth(), startDay), new Date(date.getFullYear(), date.getMonth(), endDay));
};
const relativeRanges = (now) => {
  const today = localDate(now);
  const lastWeekEnd = addDays(monday(today), -1);
  const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastQuarterAnchor = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 - 3, 1);
  return {
    today, yesterday: addDays(today, -1), dayBeforeYesterday: addDays(today, -2), tomorrow: addDays(today, 1), dayAfterTomorrow: addDays(today, 2),
    thisWeek: daysRange(monday(today), today), lastWeek: daysRange(addDays(lastWeekEnd, -6), lastWeekEnd),
    thisMonth: daysRange(firstDayOfMonth(today), today), lastMonth: daysRange(firstDayOfMonth(previousMonth), lastDayOfMonth(previousMonth)),
    thisYear: { from: `${today.getFullYear()}-01-01`, to: toLocalIsoDate(today) }, lastYear: { from: `${today.getFullYear() - 1}-01-01`, to: `${today.getFullYear() - 1}-12-31` },
    thisQuarter: daysRange(firstDayOfQuarter(today), today), lastQuarter: daysRange(firstDayOfQuarter(lastQuarterAnchor), lastDayOfQuarter(lastQuarterAnchor)),
    thisWeekend: currentWeekend(today), lastWeekend: previousWeekend(today),
    thisMonday: sameDay(nextWeekday(today, 1, true)), nextMonday: sameDay(nextWeekday(today, 1)), lastMonday: sameDay(addDays(nextWeekday(today, 1, true), -7)),
    last7Days: daysRange(addDays(today, -6), today), last30Days: daysRange(addDays(today, -29), today), last2Weeks: daysRange(addDays(today, -13), today), next7Days: daysRange(addDays(today, 1), addDays(today, 7)),
    startOfMonth: monthSegment(today, 'start'), middleOfMonth: monthSegment(today, 'middle'), endOfMonth: monthSegment(today, 'end'), untilYesterday: { from: '1970-01-01', to: toLocalIsoDate(addDays(today, -1)) }
  };
};

/** Resolves the relative temporal phrases supported by chat in local server time. */
export function relativeTemporalScope(question, now = new Date()) {
  const text = String(question ?? '');
  const ranges = relativeRanges(now);
  const expressions = [
    [/\b(?:los\s+)?[uú]ltimos\s+30\s+d[ií]as\b|\blast\s+30\s+days\b/i, ranges.last30Days],
    [/\b(?:las\s+)?[uú]ltimas\s+dos\s+semanas\b|\blast\s+two\s+weeks\b/i, ranges.last2Weeks],
    [/\b(?:los\s+)?[uú]ltimos\s+7\s+d[ií]as\b|\blast\s+7\s+days\b/i, ranges.last7Days],
    [/\b(?:los\s+)?pr[oó]ximos\s+7\s+d[ií]as\b|\bnext\s+7\s+days\b/i, ranges.next7Days],
    [/\b(?:el\s+)?a[ñn]o\s+pasado\b|\blast\s+year\b/i, ranges.lastYear], [/\beste\s+a[ñn]o\b|\bthis\s+year\b/i, ranges.thisYear],
    [/\b(?:el\s+)?trimestre\s+pasado\b|\blast\s+quarter\b/i, ranges.lastQuarter], [/\beste\s+trimestre\b|\bthis\s+quarter\b/i, ranges.thisQuarter],
    [/\b(?:el\s+)?mes\s+pasado\b|\blast\s+month\b/i, ranges.lastMonth], [/\beste\s+mes\b|\bthis\s+month\b/i, ranges.thisMonth],
    [/\b(?:el\s+)?fin\s+de\s+semana\s+pasado\b|\blast\s+weekend\b/i, ranges.lastWeekend], [/\beste\s+fin\s+de\s+semana\b|\bthis\s+weekend\b/i, ranges.thisWeekend],
    [/\b(?:la\s+)?semana\s+pasada\b|\blast\s+week\b/i, ranges.lastWeek], [/\b(?:esta|ésta)\s+semana\b|\bthis\s+week\b/i, ranges.thisWeek],
    [/\b(?:el\s+)?lunes\s+pasado\b|\blast\s+monday\b/i, ranges.lastMonday], [/\bpr[oó]ximo\s+lunes\b|\bnext\s+monday\b/i, ranges.nextMonday], [/\bel\s+lunes\b(?!\s+pasado)|\bmonday\b(?!\s+ago)/i, ranges.thisMonday],
    [/\bdesde\s+(?:principios|inicio)\s+de(?:l)?\s+mes\b/i, { from: ranges.startOfMonth.from, to: ranges.today ? toLocalIsoDate(ranges.today) : ranges.startOfMonth.to }],
    [/\bhasta\s+ayer\b|\buntil\s+yesterday\b/i, ranges.untilYesterday],
    [/\b(?:a\s+)?principios\s+de(?:l)?\s+mes\b/i, ranges.startOfMonth], [/\b(?:a\s+)?mediados\s+de(?:l)?\s+mes\b/i, ranges.middleOfMonth], [/\b(?:a\s+)?finales\s+de(?:l)?\s+mes\b/i, ranges.endOfMonth],
    [/\bpasado\s+ma[ñn]ana\b|\bday\s+after\s+tomorrow\b/i, sameDay(ranges.dayAfterTomorrow)], [/\bma[ñn]ana\b|\btomorrow\b/i, sameDay(ranges.tomorrow)],
    [/\banteayer\b|\bday\s+before\s+yesterday\b/i, sameDay(ranges.dayBeforeYesterday)], [/\bayer\b|\byesterday\b/i, sameDay(ranges.yesterday)], [/\bhoy\b|\btoday\b/i, sameDay(ranges.today)]
  ];
  return expressions.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/**
 * Adds a concrete, human-readable date beside relative expressions before the
 * prompt reaches the LLM. The original wording remains intact for the user.
 */
export function expandRelativeDates(question, now = new Date()) {
  const rangeLabel = (scope) => scope.from === scope.to
    ? spanishDate(new Date(`${scope.from}T00:00:00`))
    : `del ${spanishDate(new Date(`${scope.from}T00:00:00`))} al ${spanishDate(new Date(`${scope.to}T00:00:00`))}`;
  const annotate = (pattern, scope) => (text) => text.replace(pattern, (match) => `${match} (${rangeLabel(scope)})`);
  const ranges = relativeRanges(now);
  let result = String(question ?? '');
  const annotations = [
    [/\b(?:los\s+)?[uú]ltimos\s+30\s+d[ií]as\b|\blast\s+30\s+days\b/gi, ranges.last30Days], [/\b(?:las\s+)?[uú]ltimas\s+dos\s+semanas\b|\blast\s+two\s+weeks\b/gi, ranges.last2Weeks], [/\b(?:los\s+)?[uú]ltimos\s+7\s+d[ií]as\b|\blast\s+7\s+days\b/gi, ranges.last7Days], [/\b(?:los\s+)?pr[oó]ximos\s+7\s+d[ií]as\b|\bnext\s+7\s+days\b/gi, ranges.next7Days],
    [/\b(?:el\s+)?a[ñn]o\s+pasado\b|\blast\s+year\b/gi, ranges.lastYear], [/\beste\s+a[ñn]o\b|\bthis\s+year\b/gi, ranges.thisYear], [/\b(?:el\s+)?trimestre\s+pasado\b|\blast\s+quarter\b/gi, ranges.lastQuarter], [/\beste\s+trimestre\b|\bthis\s+quarter\b/gi, ranges.thisQuarter],
    [/\b(?:el\s+)?mes\s+pasado\b|\blast\s+month\b/gi, ranges.lastMonth], [/\beste\s+mes\b|\bthis\s+month\b/gi, ranges.thisMonth], [/\b(?:el\s+)?fin\s+de\s+semana\s+pasado\b|\blast\s+weekend\b/gi, ranges.lastWeekend], [/\beste\s+fin\s+de\s+semana\b|\bthis\s+weekend\b/gi, ranges.thisWeekend],
    [/\b(?:la\s+)?semana\s+pasada\b|\blast\s+week\b/gi, ranges.lastWeek], [/\b(?:esta|ésta)\s+semana\b|\bthis\s+week\b/gi, ranges.thisWeek], [/\b(?:el\s+)?lunes\s+pasado\b|\blast\s+monday\b/gi, ranges.lastMonday], [/\bpr[oó]ximo\s+lunes\b|\bnext\s+monday\b/gi, ranges.nextMonday], [/(?<!pasado\s)(?<!pr[oó]ximo\s)\bel\s+lunes\b(?!\s+pasado)|(?<!last\s)(?<!next\s)\bmonday\b(?!\s+ago)/gi, ranges.thisMonday],
    [/\bdesde\s+(?:principios|inicio)\s+de(?:l)?\s+mes\b/gi, { from: ranges.startOfMonth.from, to: toLocalIsoDate(ranges.today) }], [/\bhasta\s+ayer\b|\buntil\s+yesterday\b/gi, ranges.untilYesterday], [/(?<!desde\s)\b(?:a\s+)?principios\s+de(?:l)?\s+mes\b/gi, ranges.startOfMonth], [/\b(?:a\s+)?mediados\s+de(?:l)?\s+mes\b/gi, ranges.middleOfMonth], [/\b(?:a\s+)?finales\s+de(?:l)?\s+mes\b/gi, ranges.endOfMonth],
    [/\bpasado\s+ma[ñn]ana\b|\bday\s+after\s+tomorrow\b/gi, sameDay(ranges.dayAfterTomorrow)], [/(?<!pasado\s)\bma[ñn]ana\b|(?<!after\s)\btomorrow\b/gi, sameDay(ranges.tomorrow)], [/\banteayer\b|\bday\s+before\s+yesterday\b/gi, sameDay(ranges.dayBeforeYesterday)], [/(?<!hasta\s)\bayer\b|(?<!until\s)\byesterday\b/gi, sameDay(ranges.yesterday)], [/\bhoy\b|\btoday\b/gi, sameDay(ranges.today)]
  ];
  for (const [pattern, scope] of annotations) result = annotate(pattern, scope)(result);
  return result;
}

export function temporalScope(question, now = new Date()) {
  const text = String(question ?? '');
  const today = now.toISOString().slice(0, 10);
  const dates = [...text.matchAll(/\b(?:20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})\b/g)].map((match) => dateFromToken(match[0])).filter(Boolean);
  if (dates.length) {
    const from = dates[0];
    const hasOpenEnd = /\b(en\s+adelante|a\s+partir\s+de|desde|from)\b/i.test(text);
    const hasEnd = /\b(hasta|hasta\s+el|to|through|until)\b/i.test(text);
    const to = hasEnd && dates[1] ? dates[1] : hasOpenEnd ? today : dates[1] ?? from;
    return from <= to ? { from, to } : null;
  }
  const relative = relativeTemporalScope(text, now);
  if (relative) return relative;
  const years = [...new Set((text.match(/\b20\d{2}\b/g) ?? []).map(Number))].sort();
  return years.length ? { from: `${years[0]}-01-01`, to: `${years.at(-1)}-12-31` } : null;
}
