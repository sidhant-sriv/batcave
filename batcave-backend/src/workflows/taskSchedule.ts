import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { ScheduleService } from '../services/scheduleService';
import type { ScheduleParams } from '../types/schedule';
import type { Env } from '../types/task';

/**
 * The clock behind a schedule, and nothing more.
 *
 * Every decision belongs to `ScheduleService`, which reads D1 on each step, so
 * this class holds no state of its own beyond the sequence number. That is what
 * lets a cancel land as a row update: the loop asks the database what to do next
 * rather than trusting anything it was started with.
 *
 * The instance id is the schedule id, so a row and its clock are addressable
 * from each other with no extra column.
 */

/**
 * A step here is a D1 read and a small batch. Retrying through a database blip
 * costs nothing and is the difference between a missed notification and a late
 * one — which is the entire reason a Workflow owns this rather than a `setTimeout`.
 */
const RETRY = {
  retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
} as const;

export class TaskScheduleWorkflow extends WorkflowEntrypoint<Env, ScheduleParams> {
  async run(event: Readonly<WorkflowEvent<ScheduleParams>>, step: WorkflowStep) {
    const { scheduleId } = event.payload;
    const service = () => new ScheduleService(this.env.DB, this.env.TASK_SCHEDULE);

    // Unbounded on purpose: a recurring schedule ends when its row says so, not
    // when a counter here runs out. `MAX_NOTIFICATIONS` and the one-year horizon
    // both live in the service, where the row they guard is.
    for (let seq = 1; ; seq += 1) {
      const next = await step.do(`plan #${seq}`, RETRY, () => service().plan(scheduleId));
      if (next.stop) return { notifications: seq - 1 };

      // Step names must be unique within an instance, hence the sequence number.
      await step.sleepUntil(`sleep #${seq}`, new Date(next.nextAt));

      const fired = await step.do(`notify #${seq}`, RETRY, () => service().notify(scheduleId, seq));
      if (fired.stop) return { notifications: seq };
    }
  }
}
