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
  const years = [...new Set((text.match(/\b20\d{2}\b/g) ?? []).map(Number))].sort();
  return years.length ? { from: `${years[0]}-01-01`, to: `${years.at(-1)}-12-31` } : null;
}

