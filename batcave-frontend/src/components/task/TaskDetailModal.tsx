import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changedFields, updateTask } from '@/api/tasks';
import type { Task, TaskPriority, TaskStatus, UpdateTaskInput } from '@/api/types';
import { ApiError } from '@/api/client';
import { Button } from '@/components/primitives/Button';
import { SelectField, TextAreaField, TextField } from '@/components/primitives/Field';
import { Modal } from '@/components/primitives/Modal';
import { ErrorBanner } from '@/components/state/States';
import { TaskSchedule } from '@/components/sched/TaskSchedule';
import { cn } from '@/lib/cn';
import { acknowledge } from '@/lib/mutationLog';
import { fullTimestamp, relativeTime, shortId } from '@/lib/time';
import { PRIORITY_LABELS } from './PriorityRail';
import { STATUS_LABELS } from './StatusPill';

/**
 * View and edit every field of a task.
 *
 * Two behaviours worth knowing about:
 *
 * 1. Only changed fields are sent. `changedFields` builds the PATCH body,
 *    because the backend rejects unknown keys and treats an explicit `null` as
 *    "clear this" — sending the whole record back would be both wasteful and,
 *    for an emptied optional field, wrong.
 *
 * 2. If the agent rewrites this record while the modal is open, the user is
 *    told rather than overwritten. Whatever is in the inputs is theirs until
 *    they choose to reload — silently replacing a field someone is typing into
 *    is how an interface loses an argument it should never have started.
 */

const STATUS_OPTIONS = (['todo', 'in_progress', 'done'] as TaskStatus[]).map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

const PRIORITY_OPTIONS = (['low', 'medium', 'high'] as TaskPriority[]).map((value) => ({
  value,
  label: PRIORITY_LABELS[value],
}));

interface Props {
  task: Task | null;
  onOpenChange: (open: boolean) => void;
}

interface Draft {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string;
}

const draftOf = (task: Task): Draft => ({
  title: task.title,
  description: task.description ?? '',
  status: task.status,
  priority: task.priority,
  due_date: task.due_date ?? '',
});

export function TaskDetailModal({ task, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(task ? draftOf(task) : null);
  const [baseline, setBaseline] = useState<Task | null>(task);

  // Opening a different task resets the draft; the agent changing the *same*
  // task does not, which is what the banner below exists to handle.
  useEffect(() => {
    if (!task) return;
    setDraft((current) => (baseline?.id === task.id ? current : draftOf(task)));
    setBaseline((current) => (current?.id === task.id ? current : task));
  }, [task, baseline?.id]);

  const drifted = Boolean(task && baseline && task.updated_at !== baseline.updated_at);

  const mutation = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: UpdateTaskInput }) =>
      updateTask(id, changes),
    onSuccess: async (updated) => {
      acknowledge(updated.id);
      setBaseline(updated);
      setDraft(draftOf(updated));
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    },
  });

  if (!task || !draft) return null;

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fieldErrors() : {};

  const save = () => {
    const changes = changedFields(baseline ?? task, {
      title: draft.title,
      description: draft.description,
      status: draft.status,
      priority: draft.priority,
      due_date: draft.due_date,
    });

    // Nothing changed: the backend would reject an empty body, and closing is
    // what the user meant anyway.
    if (!changes) {
      onOpenChange(false);
      return;
    }

    mutation.mutate({ id: task.id, changes });
  };

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={baseline?.title ?? task.title}
      meta={
        <>
          <span title={task.id}>ID {shortId(task.id)}</span>
          <span title={fullTimestamp(task.created_at)}>
            Created {relativeTime(task.created_at)}
          </span>
          <span title={fullTimestamp(task.updated_at)}>
            Updated {relativeTime(task.updated_at)}
          </span>
        </>
      }
      banner={
        drifted ? (
          <div
            className={cn(
              'flex items-center justify-between gap-[var(--space-3)]',
              'border-b border-accent-border bg-accent-subtle',
              'px-[var(--modal-pad)] py-[var(--space-2)]',
            )}
          >
            <span className="font-mono text-micro uppercase text-accent">
              The agent changed this record
            </span>
            <div className="flex gap-[var(--space-2)]">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setBaseline(task);
                  setDraft(draftOf(task));
                  acknowledge(task.id);
                }}
              >
                Reload
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBaseline(task)}>
                Keep editing
              </Button>
            </div>
          </div>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-5)]">
        {mutation.error ? (
          <ErrorBanner error={mutation.error} onRetry={() => mutation.reset()} />
        ) : null}

        {fieldErrors._form ? (
          <p className="font-prose text-body-sm text-danger">{fieldErrors._form}</p>
        ) : null}

        <TextField
          label="Title"
          value={draft.title}
          maxLength={200}
          error={fieldErrors.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />

        <TextAreaField
          label="Description"
          value={draft.description}
          maxLength={2000}
          error={fieldErrors.description}
          hint="Leave blank to clear."
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />

        <div className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-3">
          <SelectField
            label="Status"
            value={draft.status}
            options={STATUS_OPTIONS}
            error={fieldErrors.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value as TaskStatus })}
          />
          <SelectField
            label="Priority"
            value={draft.priority}
            options={PRIORITY_OPTIONS}
            error={fieldErrors.priority}
            onChange={(event) =>
              setDraft({ ...draft, priority: event.target.value as TaskPriority })
            }
          />
          <TextField
            label="Due date"
            type="date"
            value={draft.due_date}
            error={fieldErrors.due_date}
            onChange={(event) => setDraft({ ...draft, due_date: event.target.value })}
          />
        </div>

        {/* A schedule is a facet of this task, not a separate record, so it is
            read and cancelled here rather than on a surface of its own. It is
            not part of the draft: cancelling is immediate and has nothing to do
            with the Save button, because it is not an edit to the task. */}
        <TaskSchedule taskId={task.id} />
      </div>
    </Modal>
  );
}
