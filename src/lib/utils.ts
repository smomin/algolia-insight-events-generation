/**
 * Shared utility functions used across scheduler, agent, and insights modules.
 * Extracted to avoid duplication — these were previously copy-pasted into
 * scheduler.ts, IndustryAgent.ts, SupervisorAgent.ts, and insights.ts.
 */

/** Fisher-Yates shuffle — returns a new shuffled array, does not mutate the input. */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Async sleep. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Inclusive integer in [min, max]. */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Generate a short unique ID with a given prefix, e.g. "sess_1234567_abc12de". */
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
