/**
 * A five-field cron expression, read back in words.
 *
 * The agent writes these from language — "every Monday at nine" — and the user
 * never types one, so the interface owes them the trip back. A row that says
 * `0 9 * * 1` is a receipt for a request they made in English.
 *
 * Deliberately narrow. It reads the shapes the agent actually produces — a
 * fixed time of day, optionally on set weekdays or a day of the month — and
 * returns the raw expression unchanged for anything else. Half a translation is
 * worse than none: a stepped or ranged field silently rendered as if it were a
 * single value would state a schedule the system does not have.
 *
 * Everything here is UTC, because that is what the backend stores. The surfaces
 * that show it say so once rather than per-row.
 */

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const WEEKDAYS = '1,2,3,4,5';
const WEEKEND = '0,6';

interface Cron {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

function parse(expression: string): Cron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

const isNumber = (field: string): boolean => /^\d+$/.test(field);

/** A list of plain numbers, in the order written. `null` if it is anything else. */
function numbers(field: string): number[] | null {
  const parts = field.split(',');
  if (!parts.every(isNumber)) return null;
  return parts.map(Number);
}

function timeOf(cron: Cron): string | null {
  if (!isNumber(cron.minute) || !isNumber(cron.hour)) return null;

  const hour = Number(cron.hour);
  const minute = Number(cron.minute);
  if (hour > 23 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * `0 16 * * 5` becomes `Every Fri 16:00`. Returns the raw expression when the
 * shape is not one this understands.
 */
export function describeCron(expression: string): string {
  const cron = parse(expression);
  if (!cron) return expression;

  const time = timeOf(cron);
  if (time === null || cron.month !== '*') return expression;

  const everyDayOfWeek = cron.dayOfWeek === '*';
  const everyDayOfMonth = cron.dayOfMonth === '*';

  // Cron's own quirk: constraining both fields means "either", not "both". It
  // is not a shape the agent writes, and guessing at it would be a lie.
  if (!everyDayOfWeek && !everyDayOfMonth) return expression;

  if (!everyDayOfWeek) {
    if (cron.dayOfWeek === WEEKDAYS) return `Weekdays ${time}`;
    if (cron.dayOfWeek === WEEKEND) return `Weekends ${time}`;

    const days = numbers(cron.dayOfWeek);
    if (!days || days.some((day) => day > 7)) return expression;

    // Both 0 and 7 mean Sunday.
    const names = days.map((day) => DAYS[day % 7]!);
    return `Every ${names.join(', ')} ${time}`;
  }

  if (!everyDayOfMonth) {
    if (!isNumber(cron.dayOfMonth)) return expression;
    const day = Number(cron.dayOfMonth);
    if (day < 1 || day > 31) return expression;
    return `Monthly on the ${day}${ordinalSuffix(day)}, ${time}`;
  }

  return `Daily ${time}`;
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  if (day % 10 === 1) return 'st';
  if (day % 10 === 2) return 'nd';
  if (day % 10 === 3) return 'rd';
  return 'th';
}
