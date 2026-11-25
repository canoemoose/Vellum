// Runs async tasks at most `n` at a time. Title-block reads use it: each holds PDFium while it
// reads, and Print on a 200-page set asks for every page at once, which would hold up the
// preview's renders behind them.

export type Task = () => Promise<unknown>;

export interface Limit {
  /** Queue a task; `first` puts it at the front of the queue. */
  (task: Task, first?: boolean): void;
  /** Move a task still waiting to the front (the same function that was queued); no-op once it has started. */
  promote(task: Task): void;
}

/** A queue running at most `n` tasks at once. */
export function limiter(n: number): Limit {
  const waiting: Task[] = [];
  let running = 0;
  const pump = () => {
    while (running < n && waiting.length) {
      const task = waiting.shift()!;
      running++;
      let p: Promise<unknown>;
      try {
        p = Promise.resolve(task());
      } catch (e) {
        p = Promise.reject(e);
      }
      void p
        .catch(() => {})
        .finally(() => {
          running--;
          pump();
        });
    }
  };
  const add = (task: Task, first = false) => {
    if (first) waiting.unshift(task);
    else waiting.push(task);
    pump();
  };
  add.promote = (task: Task) => {
    const i = waiting.indexOf(task);
    if (i > 0) waiting.unshift(...waiting.splice(i, 1));
  };
  return add;
}
