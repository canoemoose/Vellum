// Runs async tasks at most `n` at a time. Title-block reads use it: each holds PDFium while it
// reads, and Print on a 200-page set asks for every page at once, which would hold up the
// preview's renders behind them.

export type Limit = (task: () => Promise<unknown>, first?: boolean) => void;

/** A queue running at most `n` tasks at once; `first` puts a task at the front of the queue. */
export function limiter(n: number): Limit {
  const waiting: (() => Promise<unknown>)[] = [];
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
  return (task, first = false) => {
    if (first) waiting.unshift(task);
    else waiting.push(task);
    pump();
  };
}
