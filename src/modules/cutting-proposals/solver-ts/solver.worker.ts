/**
 * Worker thread chạy solver TS + HiGHS (WASM). `model.run()` của HiGHS CHẶN luồng JS hàng chục giây,
 * nên không được chạy trên luồng chính của API - SolverWorkerHost (luồng chính) gửi body qua
 * `postMessage`, worker trả kết quả về; quá giờ thì host `terminate()` cả worker.
 *
 * Giao thức: nhận `{ id, body }` -> trả `{ id, ok: true, result }`. Mọi exception bên trong
 * `propose()` được ép về đúng dạng Django từng trả cho ca lỗi 500 (`status: 'error', code:
 * 'SOLVER_ERROR'`) để SolverClientService ném ExternalApiHttpError(500) như nhánh http.
 */
import { parentPort } from 'node:worker_threads';
import { propose } from './propose';
import { ProposeRequest, ProposeResponse } from './types';

export interface WorkerJobMessage {
  id: number;
  body: unknown;
}

export interface WorkerResultMessage {
  id: number;
  ok: true;
  result: ProposeResponse;
}

/** Mã thoát khi worker tự khởi động lại vì runtime WASM hỏng (host chỉ log, bài đã được trả lời). */
export const WASM_DEAD_EXIT_CODE = 3;

export function isWasmRuntimeDead(message: string): boolean {
  return /Aborted\(|WebAssembly|wasm|out of memory|Cannot enlarge memory|RuntimeError/i.test(
    message,
  );
}

if (!parentPort) {
  throw new Error('solver.worker.ts chỉ chạy được trong worker_threads (parentPort rỗng)');
}
const port = parentPort;

port.on('message', (msg: WorkerJobMessage) => {
  void (async () => {
    let result: ProposeResponse;
    let fatal = false;
    try {
      result = await propose(msg.body as ProposeRequest);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Runtime WASM của HiGHS đã hỏng (Emscripten abort / hết bộ nhớ WebAssembly) thì MỌI lần giải sau
      // trong cùng worker đều lỗi ngay (đo 2026-10-20: sau 1 lần giải 658 s, 37 request kế tiếp lỗi 0,0 s).
      // -> trả lỗi cho bài này rồi tự thoát; host thấy 'exit' và tạo worker mới (WASM mới) cho bài sau.
      fatal = isWasmRuntimeDead(message);
      result = {
        status: 'error',
        code: 'SOLVER_ERROR',
        message: fatal ? `${message} (worker tự khởi động lại)` : message,
        http_status: 500,
      };
    }
    const reply: WorkerResultMessage = { id: msg.id, ok: true, result };
    port.postMessage(reply);
    if (fatal) {
      // postMessage là bất đồng bộ - nhường 1 nhịp để message kịp đi trước khi thoát.
      setImmediate(() => process.exit(WASM_DEAD_EXIT_CODE));
    }
  })();
});
