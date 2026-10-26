/* eslint-disable */
/**
 * Worker GIẢ cho solver-worker-host.spec.ts (JS thuần để Worker nạp thẳng, không cần ts-node).
 * body.mode: 'echo' (trả ngay), 'sleep' (trả sau body.ms), 'hang' (không trả), 'crash' (process.exit),
 * 'throw' (ném lỗi ngoài handler -> event 'error').
 */
const { parentPort, threadId } = require('node:worker_threads');

parentPort.on('message', (msg) => {
  const body = msg.body || {};
  const reply = () =>
    parentPort.postMessage({
      id: msg.id,
      ok: true,
      result: { status: 'success', echo: body, threadId },
    });
  switch (body.mode) {
    case 'sleep':
      setTimeout(reply, body.ms || 50);
      break;
    case 'hang':
      break;
    case 'reply-then-exit': // như solver.worker.ts khi WASM hỏng: trả lời rồi tự thoát
      reply();
      setImmediate(() => process.exit(3));
      break;
    case 'crash':
      process.exit(7);
      break;
    case 'throw':
      setImmediate(() => {
        throw new Error('worker nổ');
      });
      break;
    default:
      reply();
  }
});
