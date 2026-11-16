/** One in-flight aggregate request; writes during it always get a trailing read. */
export function createSyncQueue(run: () => Promise<void>, options: {
  visible: () => boolean;
  now?: () => number;
  delay?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  gap?: number;
}) {
  const now = options.now ?? Date.now;
  const delay = options.delay ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const cancel = options.cancel ?? clearTimeout;
  let lastStart = -Infinity, pending = false, running = false, stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    if (stopped || running || timer || !pending || !options.visible()) return;
    const wait = Math.max(0, (options.gap ?? 4000) - (now() - lastStart));
    timer = delay(() => {
      timer = undefined;
      if (stopped || !options.visible()) return;
      pending = false;
      running = true;
      lastStart = now();
      void run().finally(() => { running = false; flush(); });
    }, wait);
  }
  return {
    request() { pending = true; flush(); },
    resume: flush,
    stop() { stopped = true; pending = false; if (timer) cancel(timer); },
  };
}
