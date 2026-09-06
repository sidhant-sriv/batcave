import { Menu } from 'lucide-react';
import { IconButton } from '@/components/primitives/Button';
import { useDueNowCount } from '@/lib/schedules';
import { useShell } from '@/lib/shell';

/**
 * The navigator's handle on a phone, rendered by each surface's own header.
 *
 * It carries a dot, not a number, when something has fired: the count itself is
 * one tap away on the Scheduled row inside, and a numeral at this size next to
 * a 16px glyph is a smudge. What the dot has to say is only "there is something
 * in here you have not seen".
 *
 * Returns null above the narrow breakpoint, where the navigator is always on
 * screen and a button to reveal it would be a lie.
 */

export function NavToggle() {
  const { layout, openNav } = useShell();
  const dueNow = useDueNowCount();

  if (layout !== 'narrow') return null;

  return (
    <IconButton title="Views and conversations" onClick={openNav} className="relative -ml-[6px]">
      <Menu size={18} strokeWidth={1.5} />
      {dueNow > 0 ? (
        <>
          <span
            aria-hidden
            className="absolute right-[3px] top-[3px] size-[6px] rounded-full bg-accent"
          />
          <span className="sr-only">{dueNow} waiting</span>
        </>
      ) : null}
    </IconButton>
  );
}
