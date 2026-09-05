import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { createTask } from '@/api/tasks';
import type { CreateTaskInput, TaskPriority } from '@/api/types';
import { Button } from '@/components/primitives/Button';
import { SelectField, TextAreaField, TextField } from '@/components/primitives/Field';
import { Modal } from '@/components/primitives/Modal';
import { ErrorBanner } from '@/components/state/States';
import { PRIORITY_LABELS } from './PriorityRail';

/**
 * Create a task.
 *
 * The field set is smaller than the edit form by one: there is no status
 * picker, because the backend sets `status` to `todo` on every creation and
 * offering a control that is ignored would be a lie. `id`, `created_at` and
 * `updated_at` are server-generated for the same reason.
 */

const PRIORITY_OPTIONS = (['low', 'medium', 'high'] as TaskPriority[]).map((value) => ({
  value,
  label: PRIORITY_LABELS[value],
}));

const EMPTY = { title: '', description: '', priority: 'medium' as TaskPriority, due_date: '' };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskCreateForm({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY);

  const mutation = useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setDraft(EMPTY);
      onOpenChange(false);
    },
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fieldErrors() : {};

  const submit = () => {
    mutation.mutate({
      title: draft.title.trim(),
      // The backend normalises "" to null itself, but sending the intent
      // explicitly keeps the wire honest about what was meant.
      description: draft.description.trim() || null,
      priority: draft.priority,
      due_date: draft.due_date || null,
    });
  };

  if (!open) return null;

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) {
          setDraft(EMPTY);
          mutation.reset();
        }
        onOpenChange(next);
      }}
      title="New task"
      meta={<span>Status is set to TODO on creation</span>}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={mutation.isPending || draft.title.trim().length === 0}
          >
            {mutation.isPending ? 'Creating' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-5)]">
        {mutation.error ? (
          <ErrorBanner error={mutation.error} onRetry={() => mutation.reset()} />
        ) : null}

        <TextField
          label="Title"
          autoFocus
          value={draft.title}
          maxLength={200}
          placeholder="What needs doing"
          error={fieldErrors.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.title.trim()) submit();
          }}
        />

        <TextAreaField
          label="Description"
          value={draft.description}
          maxLength={2000}
          placeholder="Optional"
          error={fieldErrors.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />

        <div className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2">
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
      </div>
    </Modal>
  );
}
