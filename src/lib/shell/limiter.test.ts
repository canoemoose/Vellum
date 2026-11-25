import { describe, expect, it } from "vitest";
import { limiter } from "./limiter";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("limiter", () => {
  it("runs at most n at once, in order, with first-in-line jumping the queue", async () => {
    const run = limiter(2);
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const task = (name: string) => () => {
      started.push(name);
      const d = deferred();
      gates.set(name, d);
      return d.promise;
    };
    run(task("a"));
    run(task("b"));
    run(task("c"));
    run(task("d"), true);
    expect(started).toEqual(["a", "b"]);
    gates.get("a")!.resolve();
    await flush();
    expect(started).toEqual(["a", "b", "d"]);
    gates.get("b")!.reject(new Error("read failed")); // a failure still frees its place
    await flush();
    expect(started).toEqual(["a", "b", "d", "c"]);
  });

  it("survives a task that throws before returning a promise", async () => {
    const run = limiter(1);
    const started: string[] = [];
    run(() => {
      throw new Error("boom");
    });
    run(async () => void started.push("next"));
    await flush();
    expect(started).toEqual(["next"]);
  });
});
