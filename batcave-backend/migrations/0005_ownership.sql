-- Migration number: 0005 	 2026-09-07T00:00:00.000Z

-- Ownership. Until now every task and chat belonged to nobody, which is another
-- way of saying they belonged to everybody: one shared list behind an open API.
-- The authorization server added in 0.2 already knows who is calling, so this is
-- the column that finally lets it matter.
--
-- WHY THE COLUMN IS NULLABLE AND CARRIES NO REFERENCES CLAUSE. SQLite will not
-- add a NOT NULL column without a non-null default, and will not add a column
-- with a REFERENCES clause unless its default is NULL. Having both means
-- rebuilding the table — and `tasks` is referenced by `schedules` and
-- `notifications`, so a rebuild needs the `foreign_keys` pragma toggled around
-- it, which D1 does not hand out (see test/schedules.test.ts, which has to turn
-- it on by hand to prove the cascade works). A nullable column plus an
-- invariant the services enforce is the honest trade here, and it fails closed:
-- a row with no owner matches nobody's `user_id = ?` and becomes invisible
-- rather than public.
--
-- WHY THERE IS NO users TABLE. The OAuth grant is already the user registry —
-- `completeAuthorization` stores the GitHub login as its `userId` — and a copy
-- of it in D1 could only go stale. This column holds that same login.

ALTER TABLE tasks ADD COLUMN user_id TEXT;
ALTER TABLE chats ADD COLUMN user_id TEXT;

-- NOTHING IS BACKFILLED HERE. Rows that predate this column keep a null owner
-- and are simply invisible — which is the fail-closed behaviour described
-- above, and the right default for a schema change that ships in a public
-- repository. Claiming them for a particular GitHub login is a fact about one
-- deployment's data, not about the shape of the database, so it belongs in a
-- one-off command against that deployment. README → Deploying has it.
--
-- Every other login starts with an empty list, which is the correct first
-- impression for a multi-user app and the wrong one to fake.

-- Every read now filters on the owner before anything else, so an index that
-- does not lead with `user_id` can only be scanned. Replaced rather than added
-- to: leaving the old ones would cost writes for a prefix no query has.
DROP INDEX idx_tasks_status;
DROP INDEX idx_tasks_due_date;
DROP INDEX idx_chats_recent;

CREATE INDEX idx_tasks_owner_status ON tasks (user_id, status);
CREATE INDEX idx_tasks_owner_due ON tasks (user_id, due_date);

-- Newest first within one person's conversations, which is the only order a
-- chat list is ever read in.
CREATE INDEX idx_chats_owner_recent ON chats (user_id, last_message_at DESC);
