import type { ScheduleParams } from '../../src/types/schedule';

/**
 * A Workflow binding that records instead of running.
 *
 * Service tests are about what the rows say, and every real `create` starts an
 * instance that sleeps for an hour, which then has to be torn down when the
 * test empties the tables underneath it. The stub keeps those tests fast and
 * quiet; the cases that are genuinely about the instance use `env.TASK_SCHEDULE`.
 */
export interface FakeWorkflow extends Workflow<ScheduleParams> {
  readonly created: string[];
  readonly terminated: string[];
}

export function fakeWorkflow(
  options: { createFails?: boolean; exists?: boolean } = {},
): FakeWorkflow {
  const created: string[] = [];
  const terminated: string[] = [];

  const instance = (id: string) =>
    ({
      id,
      terminate: async () => {
        terminated.push(id);
        return { status: 'terminated' as const };
      },
    }) as unknown as WorkflowInstance;

  return {
    created,
    terminated,
    create: async (opts?: WorkflowInstanceCreateOptions<ScheduleParams>) => {
      const id = opts?.id ?? crypto.randomUUID();
      if (options.createFails) throw new Error('WORKFLOW_UNAVAILABLE');
      created.push(id);
      return instance(id);
    },
    get: async (id: string) => {
      // Mirrors the real binding: an id nobody created is not a handle.
      if (!created.includes(id) && !options.exists) throw new Error('instance not found');
      return instance(id);
    },
  } as unknown as FakeWorkflow;
}
