#!/usr/bin/env node
/**
 * THỬ TẢI phần QR tại máy (công nhân quét mã, báo số) - nhiều "điện thoại ảo" gọi API cùng lúc.
 * Changelog: docs/changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 41.
 *
 * KHÔNG chạy trên production: kịch bản tạo công nhân thử, báo sản lượng, đảo và gửi KCS thật. Mặc định từ chối mọi địa chỉ
 * không phải máy local; chạy trên BẢN SAO của DB dev (xem "Cách chạy").
 *
 * Cách chạy (Node >= 20, không cần cài gì):
 *   1. Nhân bản DB dev:  docker exec dna-erp-be-postgres-1 sh -c "createdb -U erp_user dna_erp_load && pg_dump -U erp_user -Fc dna_erp | pg_restore -U erp_user -d dna_erp_load --no-owner"
 *   2. Đặt danh sách IP xưởng ảo trong bản sao:  UPDATE system_config SET "floorAllowedIps" = ARRAY['10.77.0.0/16'];
 *   3. Chạy một BE riêng trỏ bản sao, giống Render (qua proxy 1 lớp, để mỗi điện thoại ảo có IP riêng bằng X-Forwarded-For):
 *        DATABASE_URL=<bản sao> PORT=3002 TRUST_PROXY_HOPS=1 node dist/main.js
 *   4. node test/load/floor-load.mjs [--workers=24] [--rounds=6] [--only=B,C] [--duration=60] [--rate=1] [--cleanup]
 *   5. Xong: DROP DATABASE dna_erp_load.
 *
 * Biến môi trường: BE_URL (mặc định http://127.0.0.1:3002/api/v1), QLSX_USER/QLSX_PASS (mặc định qlsx/demo1234 - tài khoản demo
 * của seed-demo), FACTORY_NET (mặc định 10.77 - phải nằm trong floorAllowedIps), LOAD_PREFIX (mặc định load).
 *
 * Kịch bản (chữ cái = tên mục trong báo cáo):
 *   A  đăng nhập dồn của CẢ XƯỞNG dùng chung 1 IP công cộng (NAT): bị chặn bao nhiêu người, mất bao lâu để vào hết
 *   L  đối chứng: mỗi điện thoại một IP, đăng nhập cùng lúc (lấy phiên cho các kịch bản sau)
 *   B  nhiều công nhân Phôi báo CẮT cùng lúc vào một máy + một PI: tổng khớp, mỗi người một đợt riêng, không mất số
 *   C  công nhân Hàn/Sơn báo MẢNH cùng lúc
 *   D  điện thoại mất sóng gửi lại: cùng Idempotency-Key bắn 3 lần đồng thời -> chỉ ghi 1 lần
 *   E  đua: đang báo liên tục thì QLSX đảo một lần báo và gửi KCS đúng lúc đó -> không lỗi 500, không treo, số khớp
 *   F  mô phỏng ca làm việc: cả xưởng dùng chung 1 IP, có QLSX ngồi cùng mạng (màn QLSX tự tải lại sau mỗi lần báo)
 * Mặc định chạy L,B,C,D,E,F,A theo thứ tự đó.
 */

import { performance } from 'node:perf_hooks';

// ─── cấu hình ────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? true];
    }),
);
const BASE = process.env.BE_URL ?? 'http://127.0.0.1:3002/api/v1';
const NET = process.env.FACTORY_NET ?? '10.77';
const PREFIX = process.env.LOAD_PREFIX ?? 'load';
const QLSX_USER = process.env.QLSX_USER ?? 'qlsx';
const QLSX_PASS = process.env.QLSX_PASS ?? 'demo1234';
const PIN = '246810';
const W = Number(args.workers ?? 24);
const ROUNDS = Number(args.rounds ?? 6);
const DURATION_S = Number(args.duration ?? 60);
const RATE_PER_MIN = Number(args.rate ?? 1); // số lần báo / công nhân / phút trong kịch bản F
const P95_LIMIT_MS = Number(args.p95 ?? 2000);
const SLACK_MS = 300; // lệch đồng hồ giữa script và máy chủ khi lọc "lần báo của lần chạy này" (cùng một máy nên nhỏ)
const ALL = ['L', 'B', 'C', 'D', 'E', 'F', 'A'];
const ONLY = args.only ? String(args.only).toUpperCase().split(',') : ALL;
const RUN = Date.now().toString(36);

const host = new URL(BASE).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.ALLOW_REMOTE !== '1') {
  console.error(`Từ chối chạy: ${host} không phải máy local. Thử tải tạo công nhân/báo cáo thật - chỉ chạy trên bản sao DB thử.`);
  process.exit(2);
}

// ─── tiện ích ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[rand(0, arr.length - 1)];
const pad = (n) => String(n).padStart(2, '0');
const shuffle = (arr) => arr.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)] : 0);
const add = (map, key, n) => map.set(key, (map.get(key) ?? 0) + n);
const sumMap = (m) => [...m.values()].reduce((s, v) => s + v, 0);
const mapStr = (m) => [...m.entries()].sort().map(([k, v]) => `${k}=${v}`).join(', ');
const sameMap = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const samples = []; // { sc, op, status, ms, at }

async function call(sc, op, method, path, { token, body, ip, headers = {} } = {}) {
  const t0 = performance.now();
  let status = -1;
  let json = null;
  let retryAfter = null;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { 'X-Forwarded-For': ip } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    retryAfter = res.headers.get('retry-after');
    json = await res.json().catch(() => null);
  } catch (e) {
    json = { message: String(e?.cause?.code ?? e?.message ?? e) };
  }
  const ms = performance.now() - t0;
  samples.push({ sc, op, status, ms, at: Date.now() });
  return { status, ok: status >= 200 && status < 300, json, data: json?.data, retryAfter, ms };
}

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 600) : ''}`);
  }
}
const info = (s) => console.log(`  ·     ${s}`);
// Điều cần LƯU Ý nhưng không làm hỏng lần chạy (vd giới hạn tần suất làm đăng nhập đầu ca chậm) - hiện WARN, không tính là hỏng.
const warnings = [];
function warn(name, cond, detail) {
  if (cond) return check(name, true);
  warnings.push(name);
  console.log(`  WARN  ${name}${detail !== undefined ? `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 600) : ''}`);
}
const section = (s) => console.log(`\n=== ${s}`);
function die(msg) {
  console.error(`\nDỪNG: ${msg}`);
  process.exit(1);
}

function latencyOf(sc, op) {
  const xs = samples.filter((s) => s.sc === sc && (!op || s.op === op));
  const ms = xs.map((x) => x.ms);
  const codes = {};
  for (const x of xs) codes[x.status] = (codes[x.status] ?? 0) + 1;
  return { n: xs.length, p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: Math.max(0, ...ms), codes };
}
const fmtLat = (l) => `${l.n} yêu cầu | p50 ${Math.round(l.p50)}ms · p95 ${Math.round(l.p95)}ms · p99 ${Math.round(l.p99)}ms · max ${Math.round(l.max)}ms | mã: ${Object.entries(l.codes).map(([k, v]) => `${k}×${v}`).join(' ')}`;
const noServerError = (sc) => !samples.some((s) => s.sc === sc && (s.status >= 500 || s.status === -1));

// ─── "điện thoại" ảo và tài khoản ───────────────────────────────────────────

const STAGE_LETTER = { PHOI: 'P', HAN: 'H', SON: 'S' };
const QLSX_IP = `${NET}.250.1`;
let qlsx = { token: null, at: 0 };

async function qlsxToken() {
  if (!qlsx.token || Date.now() - qlsx.at > 12 * 60_000) {
    const r = await call('setup', 'login-qlsx', 'POST', '/auth/login', { ip: QLSX_IP, body: { username: QLSX_USER, password: QLSX_PASS } });
    if (!r.ok) die(`không đăng nhập được ${QLSX_USER} (${r.status} ${JSON.stringify(r.json?.message)}) - đặt QLSX_USER/QLSX_PASS`);
    qlsx = { token: r.data.accessToken, at: Date.now() };
  }
  return qlsx.token;
}
const Q = async (sc, op, method, path, o = {}) => call(sc, op, method, path, { token: await qlsxToken(), ip: QLSX_IP, ...o });

function makePhones() {
  const nHan = Math.ceil(W * 0.25);
  const nSon = Math.floor(W * 0.2);
  const plan = [['PHOI', W - nHan - nSon], ['HAN', nHan], ['SON', nSon]];
  const phones = [];
  plan.forEach(([stage, n], si) => {
    for (let i = 1; i <= n; i++) {
      const tag = `${STAGE_LETTER[stage]}${pad(i)}`;
      phones.push({ u: `${PREFIX}.${tag.toLowerCase()}`, firstName: tag, lastName: 'Load', fullName: `Load ${tag}`, stage, ip: `${NET}.${si + 1}.${i}`, token: null, at: 0 });
    }
  });
  return phones;
}
const phones = makePhones();
const byStage = (s) => phones.filter((p) => p.stage === s);

async function loginPhone(sc, p, ip = p.ip) {
  const r = await call(sc, 'login', 'POST', '/auth/login', { ip, body: { username: p.u, password: PIN } });
  if (r.ok) {
    p.token = r.data.accessToken;
    p.at = Date.now();
  }
  return r;
}
async function tok(p) {
  if (!p.token || Date.now() - p.at > 12 * 60_000) await loginPhone('setup', p);
  return p.token;
}

// ─── dựng dữ liệu nền ────────────────────────────────────────────────────────

let machines = {}; // cut, recv, han, son
let piId = null;
let orderId = null;
let cutMaterials = []; // [{ materialId, materialCode, segments: [{ segmentSpecId, cutLengthMm }] }]
let pieces = { HAN: [], SON: [] }; // [{ pieceId, pieceCode }]

async function setup() {
  section('Dựng nền (máy, hàng đợi PI, tài khoản công nhân thử)');
  await qlsxToken();

  let ws = (await Q('setup', 'ws', 'GET', '/floor/workstations')).data ?? [];
  if (!ws.some((w) => w.stage === 'SON' && w.kind === 'PIECE')) {
    const r = await Q('setup', 'mk-son', 'POST', '/floor/workstations', { body: { code: 'SON-LOAD', name: 'Điểm sơn (thử tải)', stage: 'SON', kind: 'PIECE' } });
    info(`tạo máy SON-LOAD -> ${r.status}`);
    ws = (await Q('setup', 'ws', 'GET', '/floor/workstations')).data;
  }
  machines = {
    cut: ws.find((w) => w.kind === 'CUT' && w.isActive),
    recv: ws.find((w) => w.kind === 'STEEL_RECEIVE' && w.isActive),
    han: ws.find((w) => w.kind === 'PIECE' && w.stage === 'HAN' && w.isActive),
    son: ws.find((w) => w.kind === 'PIECE' && w.stage === 'SON' && w.isActive),
  };
  for (const [k, v] of Object.entries(machines)) if (!v) die(`thiếu máy ${k} đang bật`);
  info(`máy: cắt ${machines.cut.code}, nhận sắt ${machines.recv.code}, hàn ${machines.han.code}, sơn ${machines.son.code}`);

  let queue = (await Q('setup', 'queue', 'GET', '/floor/queue')).data ?? [];
  const running = (stage) => queue.find((e) => e.stage === stage && e.status === 'RUNNING');
  if (!running('PHOI')) die('tổ Phôi chưa có PI đang chạy - mở một PI ở "Hàng đợi" trước');
  piId = running('PHOI').productionInvoiceId;
  for (const stage of ['HAN', 'SON']) {
    if (running(stage)) continue;
    await Q('setup', 'enqueue', 'POST', '/floor/queue', { body: { stage, productionInvoiceId: piId } });
    const r = await Q('setup', 'advance', 'POST', `/floor/queue/${stage}/advance`);
    info(`tổ ${stage} chưa chạy PI -> đưa PI ${piId} vào và bắt đầu (${r.status})`);
    queue = (await Q('setup', 'queue', 'GET', '/floor/queue')).data;
  }
  for (const stage of ['PHOI', 'HAN', 'SON']) {
    const r = running(stage);
    if (!r || r.productionInvoiceId !== piId) die(`tổ ${stage} đang chạy PI khác (${r?.piCode}) - kịch bản cần cả 3 tổ cùng một PI`);
  }

  // công nhân thử: tạo (hoặc dùng lại) + tự đặt PIN, mỗi người một IP riêng
  const made = await pool(phones, 4, async (p) => {
    const c = await Q('setup', 'mk-worker', 'POST', '/floor/workers', { body: { username: p.u, firstName: p.firstName, lastName: p.lastName, stage: p.stage } });
    if (c.status !== 201 && c.status !== 409) die(`tạo ${p.u} -> ${c.status} ${JSON.stringify(c.json?.message)}`);
    await call('setup', 'pin-setup', 'POST', '/auth/pin-setup', { ip: p.ip, body: { username: p.u, pin: PIN, confirmPin: PIN } });
    return c.status;
  });
  info(`${phones.length} công nhân thử (${made.filter((s) => s === 201).length} mới, ${made.filter((s) => s === 409).length} dùng lại): ${['PHOI', 'HAN', 'SON'].map((s) => `${s} ${byStage(s).length}`).join(' · ')}`);
}

async function discover() {
  const p0 = byStage('PHOI')[0];
  // nhận hết sắt kho đã xuất để máy cắt có loại sắt báo được
  const recv = await call('setup', 'ctx-recv', 'GET', `/floor/scan/${machines.recv.qrToken}`, { token: await tok(p0), ip: p0.ip });
  for (const s of recv.data?.steelToReceive ?? []) {
    const r = await call('setup', 'receive', 'POST', `/floor/scan/${machines.recv.qrToken}/steel-issues/${s.steelIssueId}/receive`, { token: await tok(p0), ip: p0.ip, body: { receivedBarCount: s.barCount } });
    info(`nhận sắt ${s.materialCode} (${s.barCount} cây) -> ${r.status}`);
  }
  const cut = await call('setup', 'ctx-cut', 'GET', `/floor/scan/${machines.cut.qrToken}`, { token: await tok(p0), ip: p0.ip });
  const pi = cut.data?.pi;
  if (!pi) die('máy cắt không trả PI - tổ Phôi chưa chạy PI?');
  orderId = pi.orders[0].productionOrderId;
  cutMaterials = pi.materials
    .filter((m) => m.hasReceivedSteel && m.segments.length)
    .map((m) => ({ materialId: m.materialId, materialCode: m.materialCode, segments: m.segments.map((s) => ({ segmentSpecId: s.segmentSpecId, cutLengthMm: s.cutLengthMm })) }));
  if (!cutMaterials.length) die('không loại sắt nào đã nhận - cần ít nhất 1 lần kho xuất sắt đã được nhận');
  info(`máy cắt: ${cutMaterials.length} loại sắt báo được (${cutMaterials.map((m) => m.materialCode).join(', ')}), SKU ${orderId}`);
  for (const [stage, m] of [['HAN', machines.han], ['SON', machines.son]]) {
    const p = byStage(stage)[0];
    if (!p) continue;
    const r = await call('setup', `ctx-${stage}`, 'GET', `/floor/scan/${m.qrToken}`, { token: await tok(p), ip: p.ip });
    pieces[stage] = (r.data?.pi?.piecePlans?.[orderId]?.items ?? []).map((i) => ({ pieceId: i.pieceId, pieceCode: i.pieceCode }));
    info(`máy ${m.code}: ${pieces[stage].length} loại mảnh`);
  }
}

// ─── thao tác ────────────────────────────────────────────────────────────────

const cutBody = (mat, segs) => ({ productionInvoiceId: piId, productionOrderId: orderId, materialId: mat.materialId, segments: segs.map((s) => ({ segmentSpecId: s.segmentSpecId, qty: s.qty })) });
const pieceBody = (piece, qty) => ({ productionInvoiceId: piId, productionOrderId: orderId, pieceId: piece.pieceId, qty });
const randomCut = () => {
  const mat = pick(cutMaterials);
  const segs = shuffle(mat.segments).slice(0, Math.min(rand(1, 2), mat.segments.length)).map((s) => ({ ...s, qty: rand(1, 3), key: `${mat.materialCode}|${s.cutLengthMm}` }));
  return { mat, segs };
};

async function myOutput(p, sinceMs) {
  const r = await call('verify', 'my-output', 'GET', `/floor/my-output?from=${encodeURIComponent(new Date(sinceMs).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, { token: await tok(p), ip: p.ip });
  return (r.data ?? []).filter((x) => Date.parse(x.createdAt) >= sinceMs);
}
const outSums = (rows, kind) => {
  const m = new Map();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    for (const l of row.lines) add(m, kind === 'CUT' ? `${l.segment.materialCode}|${l.segment.cutLengthMm}` : l.piece.code, l.qty);
  }
  return m;
};
// tổng số đoạn đang nằm trong các đợt CẮT ĐANG MỞ của 1 công nhân (màn QLSX)
async function openBundleSums(p) {
  const r = await Q('verify', 'review', 'GET', '/floor/review?stage=PHOI');
  const m = new Map();
  const bundles = (r.data?.cutBundles ?? []).filter((b) => b.openedByName === p.fullName);
  for (const b of bundles) for (const s of b.segments) add(m, `${b.material.code}|${s.cutLengthMm}`, s.qty);
  return { sums: m, bundles };
}

// ─── kịch bản ────────────────────────────────────────────────────────────────

async function scenL() {
  section('L. Đối chứng: mỗi điện thoại một IP, đăng nhập cùng lúc');
  const res = await Promise.all(phones.map((p) => loginPhone('L', p)));
  check(`cả ${phones.length} công nhân đăng nhập được (IP riêng, không bị giới hạn lẫn nhau)`, res.every((r) => r.ok), res.filter((r) => !r.ok).map((r) => r.status));
  info(fmtLat(latencyOf('L')));
}

async function scenB() {
  section(`B. ${byStage('PHOI').length} công nhân Phôi báo CẮT cùng lúc vào 1 máy + 1 PI (${ROUNDS} lần/người)`);
  const workers = byStage('PHOI');
  const since = Date.now() - SLACK_MS;
  const expected = new Map(workers.map((w) => [w.u, new Map()]));
  const before = new Map(await Promise.all(workers.map(async (w) => [w.u, (await openBundleSums(w)).sums])));
  const t0 = Date.now();
  let ok = 0;
  await Promise.all(workers.map(async (w, wi) => {
    for (let r = 0; r < ROUNDS; r++) {
      await sleep(rand(0, 250));
      const { mat, segs } = randomCut();
      const res = await call('B', 'report-cut', 'POST', `/floor/scan/${machines.cut.qrToken}/reports`, { token: await tok(w), ip: w.ip, headers: { 'Idempotency-Key': `${RUN}-b-${wi}-${r}` }, body: cutBody(mat, segs) });
      if (res.ok) {
        ok++;
        for (const s of segs) add(expected.get(w.u), s.key, s.qty);
      }
    }
  }));
  const secs = (Date.now() - t0) / 1000;
  const total = workers.length * ROUNDS;
  check(`mọi lần báo đều thành công (${ok}/${total})`, ok === total, latencyOf('B').codes);
  check('không lỗi 500 / mất kết nối', noServerError('B'), latencyOf('B').codes);
  info(`${fmtLat(latencyOf('B'))} | ${(ok / secs).toFixed(1)} lần báo/giây`);
  check(`p95 báo cắt ≤ ${P95_LIMIT_MS}ms`, latencyOf('B').p95 <= P95_LIMIT_MS, `${Math.round(latencyOf('B').p95)}ms`);

  let rowsOk = 0;
  let sumsOk = 0;
  let bundleOk = 0;
  const bad = [];
  for (const w of workers) {
    const rows = await myOutput(w, since);
    const got = outSums(rows, 'CUT');
    if (rows.length === ROUNDS) rowsOk++;
    if (sameMap(got, expected.get(w.u))) sumsOk++;
    else bad.push(`${w.u}: nhận ${mapStr(got)} / báo ${mapStr(expected.get(w.u))}`);
    const { sums } = await openBundleSums(w);
    const delta = new Map([...sums].map(([k, v]) => [k, v - (before.get(w.u).get(k) ?? 0)]).filter(([, v]) => v !== 0));
    if (sameMap(delta, expected.get(w.u))) bundleOk++;
    else bad.push(`${w.u}: đợt cắt tăng ${mapStr(delta)} / báo ${mapStr(expected.get(w.u))}`);
  }
  check(`mỗi công nhân thấy đủ ${ROUNDS} lần báo trong "Sản lượng của tôi" (${rowsOk}/${workers.length})`, rowsOk === workers.length);
  check(`tổng từng cỡ đoạn trong "Sản lượng của tôi" khớp số đã báo (${sumsOk}/${workers.length})`, sumsOk === workers.length, bad.slice(0, 3));
  check(`số đoạn trong đợt cắt đang mở của QLSX khớp số đã báo, mỗi người một đợt riêng (${bundleOk}/${workers.length})`, bundleOk === workers.length, bad.slice(0, 3));
}

async function scenC() {
  for (const stage of ['HAN', 'SON']) {
    const workers = byStage(stage);
    const list = pieces[stage];
    section(`C. ${workers.length} công nhân ${stage} báo MẢNH cùng lúc (${ROUNDS} lần/người)`);
    if (!workers.length || !list.length) {
      info(`bỏ qua: ${!workers.length ? 'không có công nhân' : 'máy không có loại mảnh nào'}`);
      continue;
    }
    const m = stage === 'HAN' ? machines.han : machines.son;
    const since = Date.now() - SLACK_MS;
    const expected = new Map(workers.map((w) => [w.u, new Map()]));
    let ok = 0;
    await Promise.all(workers.map(async (w, wi) => {
      for (let r = 0; r < ROUNDS; r++) {
        await sleep(rand(0, 250));
        const piece = pick(list);
        const qty = rand(1, 5);
        const res = await call(`C-${stage}`, 'report-piece', 'POST', `/floor/scan/${m.qrToken}/reports`, { token: await tok(w), ip: w.ip, headers: { 'Idempotency-Key': `${RUN}-c${stage}-${wi}-${r}` }, body: pieceBody(piece, qty) });
        if (res.ok) {
          ok++;
          add(expected.get(w.u), piece.pieceCode, qty);
        }
      }
    }));
    const total = workers.length * ROUNDS;
    check(`mọi lần báo đều thành công (${ok}/${total})`, ok === total, latencyOf(`C-${stage}`).codes);
    check('không lỗi 500 / mất kết nối', noServerError(`C-${stage}`));
    info(fmtLat(latencyOf(`C-${stage}`)));
    let sumsOk = 0;
    const bad = [];
    for (const w of workers) {
      const got = outSums(await myOutput(w, since), 'PIECE');
      if (sameMap(got, expected.get(w.u))) sumsOk++;
      else bad.push(`${w.u}: nhận ${mapStr(got)} / báo ${mapStr(expected.get(w.u))}`);
    }
    check(`tổng từng loại mảnh khớp số đã báo (${sumsOk}/${workers.length})`, sumsOk === workers.length, bad.slice(0, 3));
  }
}

async function scenD() {
  const workers = byStage('PHOI');
  section(`D. Gửi lại khi mất sóng: ${workers.length} công nhân, mỗi người bắn 3 lần cùng Idempotency-Key đồng thời`);
  const since = Date.now() - SLACK_MS;
  const mat = cutMaterials[0];
  const seg = mat.segments[0];
  const body = cutBody(mat, [{ ...seg, qty: 1 }]);
  const results = await Promise.all(workers.map(async (w, wi) => {
    const key = `${RUN}-d-${wi}`;
    const send = async () => call('D', 'report-retry', 'POST', `/floor/scan/${machines.cut.qrToken}/reports`, { token: await tok(w), ip: w.ip, headers: { 'Idempotency-Key': key }, body });
    const burst = await Promise.all([send(), send(), send()]);
    await sleep(800);
    const later = await send();
    return { w, rs: [...burst, later] };
  }));
  check('cả 4 lần gửi của mỗi người đều được trả thành công', results.every((x) => x.rs.every((r) => r.ok)), results.flatMap((x) => x.rs.map((r) => r.status)).filter((s) => s >= 300));
  check('cả 4 lần của mỗi người trả về CÙNG một đợt cắt', results.every((x) => new Set(x.rs.map((r) => r.data?.cutBundle?.id)).size === 1));
  let once = 0;
  for (const { w } of results) {
    const rows = await myOutput(w, since);
    if (rows.length === 1 && outSums(rows, 'CUT').get(`${mat.materialCode}|${seg.cutLengthMm}`) === 1) once++;
  }
  check(`mỗi người chỉ có ĐÚNG 1 lần báo, số lượng 1 - không bị cộng 2-4 lần (${once}/${workers.length})`, once === workers.length);
  check('không lỗi 500 / mất kết nối', noServerError('D'));
  info(fmtLat(latencyOf('D')));
}

async function scenE() {
  const w = byStage('PHOI')[0];
  section(`E. Đua: ${w.u} báo liên tục trong khi QLSX đảo 1 lần báo và gửi KCS đúng lúc đó`);
  const mat = cutMaterials[0];
  const seg = mat.segments[0];
  const one = () => cutBody(mat, [{ ...seg, qty: 1 }]);
  const post = async (op, key) => call('E', op, 'POST', `/floor/scan/${machines.cut.qrToken}/reports`, { token: await tok(w), ip: w.ip, headers: { 'Idempotency-Key': key }, body: one() });
  // lần báo của người khác (không bị gửi KCS cùng) để chắc có đợt mở dưới tay: 3 lần báo trước
  const since = Date.now() - SLACK_MS;
  for (let i = 0; i < 3; i++) await post('pre', `${RUN}-e-pre-${i}`);
  const pre = await myOutput(w, since);
  const reverseId = pre[pre.length - 1]?.id;
  const { bundles } = await openBundleSums(w);
  const bundleId = bundles.find((b) => b.material.code === mat.materialCode)?.cutBundleId;
  if (!reverseId || !bundleId) {
    check('có sẵn lần báo để đảo và đợt để gửi KCS', false, { reverseId, bundleId });
    return;
  }
  const t0 = Date.now();
  const timed = (delay, fn) => sleep(delay).then(fn);
  const tasks = [
    ...Array.from({ length: 12 }, (_, i) => timed(i * 40, () => post('race-report', `${RUN}-e-${i}`))),
    timed(120, () => Q('E', 'race-reverse', 'POST', `/floor/reports/${reverseId}/reverse`, { body: { reason: 'thử tải: đảo lúc đang báo' } })),
    timed(200, () => Q('E', 'race-send-kcs', 'POST', `/floor/review/cut-bundles/${bundleId}/send-kcs`)),
  ];
  const out = await Promise.all(tasks);
  const reports = out.slice(0, 12);
  const [rev, kcs] = out.slice(12);
  const okReports = reports.filter((r) => r.ok).length;
  info(`báo thêm: ${okReports}/12 thành công | đảo: ${rev.status} ${rev.ok ? '' : String(rev.json?.message ?? '').slice(0, 70)} | gửi KCS: ${kcs.status} ${kcs.ok ? '' : String(kcs.json?.message ?? '').slice(0, 70)} | ${Date.now() - t0}ms`);
  check('không lỗi 500 / mất kết nối / treo (mọi yêu cầu xong < 10 giây)', noServerError('E') && Math.max(...samples.filter((s) => s.sc === 'E').map((s) => s.ms)) < 10_000, latencyOf('E').codes);
  check('đảo và gửi KCS trả kết quả hợp lệ (thành công hoặc 409 "đã gửi KCS")', [201, 200, 409].includes(rev.status) && [201, 200, 409].includes(kcs.status), { rev: rev.status, kcs: kcs.status });
  check('mọi lần báo của công nhân vẫn thành công dù đợt vừa bị gửi KCS (lần sau mở đợt mới)', okReports === 12, latencyOf('E', 'race-report').codes);
  const rows = await myOutput(w, since);
  const reversed = rows.filter((r) => r.reversed).length;
  check(`công nhân thấy đủ lần báo: ${3 + okReports} (3 trước + ${okReports} lúc đua), thấy ${rows.length}`, rows.length === 3 + okReports);
  check(`số lần báo bị đảo = ${rev.ok ? 1 : 0} (thấy ${reversed})`, reversed === (rev.ok ? 1 : 0));
}

async function scenF() {
  const natIp = `${NET}.201.1`;
  const withQlsx = args['no-qlsx'] ? false : true;
  section(`F. Ca làm việc ${DURATION_S}s: ${phones.length} công nhân dùng chung 1 IP, mỗi người báo ~${RATE_PER_MIN} lần/phút${withQlsx ? ', QLSX ngồi cùng mạng (màn tự tải lại sau mỗi lần báo)' : ''}`);
  const since = Date.now();
  const end = since + DURATION_S * 1000;
  const bucket = []; // { op, at } của mọi yêu cầu từ IP chung (giới hạn 100/phút tính RIÊNG cho từng route trên mỗi IP)
  const track = (r, op) => { bucket.push({ op, at: Date.now() }); return r; };
  let reportsOk = 0;
  let qlsxTimer = null;
  const refetchQlsx = () => {
    if (!withQlsx || qlsxTimer) return;
    qlsxTimer = setTimeout(async () => {
      qlsxTimer = null;
      for (const path of ['/floor/queue', '/floor/review?stage=PHOI', '/floor/summary', '/floor/summary']) track(await Q('F', 'qlsx-refetch', 'GET', path, { ip: natIp }), path.split('?')[0]);
    }, 400); // trễ 400ms như useRealtimeRefetch
  };
  await Promise.all(phones.map(async (p, i) => {
    await sleep(rand(0, (60_000 / RATE_PER_MIN) * 0.8));
    while (Date.now() < end) {
      const m = p.stage === 'PHOI' ? machines.cut : p.stage === 'HAN' ? machines.han : machines.son;
      track(await call('F', 'scan-context', 'GET', `/floor/scan/${m.qrToken}`, { token: await tok(p), ip: natIp }), 'scan-context');
      await sleep(rand(1500, 4000)); // đọc màn hình, nhập số
      let body;
      if (p.stage === 'PHOI') {
        const { mat, segs } = randomCut();
        body = cutBody(mat, segs);
      } else if (pieces[p.stage].length) body = pieceBody(pick(pieces[p.stage]), rand(1, 5));
      if (body) {
        const r = track(await call('F', 'report', 'POST', `/floor/scan/${m.qrToken}/reports`, { token: await tok(p), ip: natIp, headers: { 'Idempotency-Key': `${RUN}-f-${i}-${Date.now()}` }, body }), 'report');
        if (r.ok) {
          reportsOk++;
          refetchQlsx();
        }
        track(await call('F', 'my-output', 'GET', '/floor/my-output', { token: await tok(p), ip: natIp }), 'my-output');
      }
      await sleep((60_000 / RATE_PER_MIN) * (0.5 + Math.random()));
    }
  }));
  const l = latencyOf('F');
  const throttled = samples.filter((s) => s.sc === 'F' && s.status === 429);
  info(fmtLat(l));
  // số yêu cầu nhiều nhất của 1 route trong BẤT KỲ khoảng 60 giây nào (đúng cách bộ giới hạn đếm)
  const slidingMax = (times) => {
    const t = [...times].sort((a, b) => a - b);
    let max = 0;
    let j = 0;
    for (let i = 0; i < t.length; i++) {
      while (t[i] - t[j] >= 60_000) j++;
      max = Math.max(max, i - j + 1);
    }
    return max;
  };
  const routes = [...new Set(bucket.map((b) => b.op))].map((op) => [op, slidingMax(bucket.filter((b) => b.op === op).map((b) => b.at))]);
  const busiest = routes.sort((a, b) => b[1] - a[1])[0] ?? ['-', 0];
  const busiestPerMin = busiest[1];
  info(`${bucket.length} yêu cầu từ 1 IP chung trong ${DURATION_S}s | route đông nhất: ${busiest[0]} = ${busiestPerMin} yêu cầu trong 60 giây (giới hạn 100/phút TÍNH RIÊNG cho từng route trên mỗi IP) | báo thành công: ${reportsOk}`);
  if (throttled.length) {
    const first = Math.min(...throttled.map((s) => s.at));
    info(`BỊ CHẶN 429: ${throttled.length} yêu cầu, bắt đầu sau ${Math.round((first - since) / 1000)}s (công nhân thấy "Bạn thao tác quá nhanh - đợi khoảng 1 phút")`);
  } else info('không yêu cầu nào bị chặn 429');
  check('không lỗi 500 / mất kết nối', noServerError('F'), l.codes);
  check(`p95 ≤ ${P95_LIMIT_MS}ms với tải thường (không tính yêu cầu bị chặn)`, pct(samples.filter((s) => s.sc === 'F' && s.status !== 429).map((s) => s.ms), 95) <= P95_LIMIT_MS);
  warn(`cả xưởng dùng chung 1 IP không chạm giới hạn 100/phút của route nào (đông nhất ${busiest[0]}: ${busiestPerMin} trong 60 giây)`, throttled.length === 0, `${throttled.length} yêu cầu bị 429 - giảm --rate hoặc cân nhắc nâng giới hạn`);
}

async function scenA() {
  section(`A. Đăng nhập dồn: ${phones.length} công nhân cùng đăng nhập từ 1 IP công cộng (NAT xưởng) - giới hạn 8 lần/phút/IP`);
  const natIp = `${NET}.200.1`;
  const t0 = Date.now();
  const done = new Map(); // u -> ms từ lúc bắt đầu tới khi vào được
  const blocked = new Map(); // u -> số lần bị chặn
  const retryAfterSeen = new Set();
  await Promise.all(phones.map(async (p) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await call('A', 'login-nat', 'POST', '/auth/login', { ip: natIp, body: { username: p.u, password: PIN } });
      if (r.ok) {
        done.set(p.u, Date.now() - t0);
        return;
      }
      if (r.status !== 429) return;
      blocked.set(p.u, (blocked.get(p.u) ?? 0) + 1);
      if (r.retryAfter) retryAfterSeen.add(r.retryAfter);
      await sleep(Math.max(1, Number(r.retryAfter ?? 60)) * 1000 + rand(0, 3000));
    }
  }));
  const firstWave = [...done.values()].filter((ms) => ms < 5000).length;
  const everyone = done.size === phones.length;
  const total = Math.max(0, ...done.values());
  info(`lượt đầu (ngay lập tức): ${firstWave}/${phones.length} vào được, ${phones.length - firstWave} bị chặn 429 (Retry-After: ${[...retryAfterSeen].join(',') || 'không có'})`);
  info(`${everyone ? 'cả xưởng vào hết' : `chỉ ${done.size}/${phones.length} vào được`} sau ${Math.round(total / 1000)} giây nếu mỗi người bị chặn tự thử lại sau Retry-After`);
  check('không lỗi 500 / mất kết nối', noServerError('A'));
  check('mọi công nhân cuối cùng cũng vào được (thử lại sau khi hết chặn)', everyone, { vao: done.size, tong: phones.length });
  warn('đăng nhập đầu ca: không ai phải chờ quá 60 giây', total <= 60_000, `${Math.round(total / 1000)}s - giới hạn 8 lần/phút/IP làm cả xưởng đăng nhập chậm; xem mục 41 của changelog`);
}

// ─── chạy ────────────────────────────────────────────────────────────────────

async function cleanup() {
  section('Dọn: khoá các công nhân thử');
  await pool(phones, 4, (p) => (async () => {
    const list = (await Q('cleanup', 'workers', 'GET', '/floor/workers')).data ?? [];
    const w = list.find((x) => x.username === p.u);
    if (w) await Q('cleanup', 'lock', 'PATCH', `/floor/workers/${w.id}`, { body: { isActive: false } });
  })());
  info('đã khoá (đợt/báo cáo thử vẫn còn trong DB - bỏ cả DB bản sao khi xong)');
}

const t0 = Date.now();
console.log(`Thử tải QR: ${BASE} | ${W} công nhân ảo | chạy: ${ONLY.join(',')} | mã lần chạy ${RUN}`);
await setup();
await scenL(); // luôn cần phiên của mọi điện thoại cho các kịch bản sau
await discover();
const table = { B: scenB, C: scenC, D: scenD, E: scenE, F: scenF, A: scenA };
for (const key of ALL) if (key !== 'L' && ONLY.includes(key)) await table[key]();
if (args.cleanup) await cleanup();

section('Tổng kết');
console.log(`  ${passed} kiểm tra qua, ${failures.length} hỏng | ${samples.length} yêu cầu | ${Math.round((Date.now() - t0) / 1000)}s`);
if (failures.length) {
  console.log('  Hỏng:');
  for (const f of failures) console.log(`   - ${f}`);
}
if (warnings.length) {
  console.log('  Cần lưu ý (không làm hỏng):');
  for (const w of warnings) console.log(`   - ${w}`);
}
process.exit(failures.length ? 1 : 0);
