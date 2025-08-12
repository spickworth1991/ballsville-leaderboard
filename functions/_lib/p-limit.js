// functions/_lib/p-limit.js
export default function pLimit(concurrency = 1) {
  let activeCount = 0;
  const queue = [];

  const next = () => {
    activeCount--;
    if (queue.length) {
      const { fn, resolve, reject } = queue.shift();
      run(fn).then(resolve, reject);
    }
  };

  const run = async (fn) => {
    activeCount++;
    try {
      const r = await fn();
      next();
      return r;
    } catch (e) {
      next();
      throw e;
    }
  };

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      if (activeCount < concurrency) {
        run(fn).then(resolve, reject);
      } else {
        queue.push({ fn, resolve, reject });
      }
    });
  };
}
