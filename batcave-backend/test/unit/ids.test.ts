import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { derivedUuid, uuidv7 } from '../../src/ids';
import { taskId } from '../../src/agent/taskId';

const versionOf = (uuid: string) => uuid[14];
const variantOf = (uuid: string) => uuid[19];

describe('uuidv7', () => {
  it('is a valid UUID of version 7', () => {
    const id = uuidv7();
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(versionOf(id)).toBe('7');
    expect('89ab').toContain(variantOf(id)!);
  });

  it('is time-ordered, so inserts land at the end of the index', async () => {
    const first = uuidv7();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = uuidv7();
    expect(first < second).toBe(true);
  });

  it('does not repeat inside one millisecond', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuidv7()));
    expect(ids.size).toBe(200);
  });
});

describe('derivedUuid', () => {
  it('gives the same id for the same name, every time', async () => {
    expect(await derivedUuid('ns', 'name')).toBe(await derivedUuid('ns', 'name'));
  });

  it('separates names and namespaces', async () => {
    expect(await derivedUuid('ns', 'a')).not.toBe(await derivedUuid('ns', 'b'));
    expect(await derivedUuid('one', 'a')).not.toBe(await derivedUuid('two', 'a'));
  });

  it('is version 8, the slot for an implementation-defined layout', async () => {
    // Version 5 would claim name-based SHA-1; this hashes with SHA-256.
    const id = await derivedUuid('ns', 'name');
    expect(versionOf(id)).toBe('8');
    expect('89ab').toContain(variantOf(id)!);
  });

  it('passes the same z.uuid() guard the REST routes use', async () => {
    expect(z.uuid().safeParse(await derivedUuid('ns', 'name')).success).toBe(true);
  });
});

describe('taskId', () => {
  it('maps a tool call id to one permanent task id', async () => {
    expect(await taskId('call_abc')).toBe(await taskId('call_abc'));
    expect(await taskId('call_abc')).not.toBe(await taskId('call_def'));
  });
});
