#!/usr/bin/env node
/**
 * 阶段 10.1：直接测量当前产品 SparseSpatialIndex 的纯 Node 基准。
 *
 * 此入口只临时编译 packages/painting/src/core/spatialIndex.ts；不修改产品源码或 lib 构件。
 * 线性 oracle 与计时路径刻意分开，避免把验证所需的排序和数组比较混入采样值。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const PRODUCT_SOURCE = resolve(REPO_ROOT, 'packages/painting/src/core/spatialIndex.ts');
const OUTPUT_PATH = resolve(
  REPO_ROOT,
  'artifacts/research/product-performance/product-performance-measurements.json'
);
const TYPESCRIPT_CLI = resolve(REPO_ROOT, 'node_modules/typescript/bin/tsc');

const SEED = 0x10a1c0de;
const WARMUP_ROUNDS = 5;
const MEASURED_ROUNDS = 25;
const PRODUCT_OPTIONS = Object.freeze({
  cellSize: 256,
  maxCellsPerObject: 64,
  maxCellsPerQuery: 4096,
});

/** 以固定 seed 生成输入；统计值会随同机负载波动，输入不会。 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function bounds(minX, minY, width, height) {
  return { minX, minY, maxX: minX + width, maxY: minY + height };
}

/** 阶段 2.3 的 100k / 16 查询输入形状：4096 世界、8..48 bbox、800x600 窗口。 */
function createComparableNormalRecords(count, seed = SEED + count) {
  const random = mulberry32(seed);
  const records = [];
  const worldSize = 4096;
  const maxSize = 48;
  for (let key = 0; key < count; key += 1) {
    const width = 8 + random() * 40;
    const height = 8 + random() * 40;
    records.push({
      key,
      value: key,
      order: key,
      bounds: bounds(random() * (worldSize - maxSize), random() * (worldSize - maxSize), width, height),
    });
  }
  return records;
}

function createComparableQueries() {
  const queries = [];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      queries.push(bounds(((x + 0.5) / 4) * 4096 - 400, ((y + 0.5) / 4) * 4096 - 300, 800, 600));
    }
  }
  return queries;
}

function createSparseNormalRecords(count, seed) {
  const random = mulberry32(seed);
  const records = [];
  const worldSize = 1_000_000;
  for (let key = 0; key < count; key += 1) {
    records.push({
      key,
      value: key,
      order: key,
      bounds: bounds(random() * worldSize - worldSize / 2, random() * worldSize - worldSize / 2, 8 + random() * 40, 8 + random() * 40),
    });
  }
  return records;
}

function createDistributedQueries(count, seed, worldSize, width, height) {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () =>
    bounds(random() * worldSize - worldSize / 2, random() * worldSize - worldSize / 2, width, height)
  );
}

function createSkewDenseRecords(count, seed) {
  const random = mulberry32(seed);
  const records = [];
  for (let key = 0; key < count; key += 1) {
    // 90% 集中在原点附近，余下对象散布在远处，模拟偏斜且高密度的文档。
    const clustered = key < count * 0.9;
    const span = clustered ? 1024 : 1_000_000;
    records.push({
      key,
      value: key,
      order: key,
      bounds: bounds(random() * span - span / 2, random() * span - span / 2, 16 + random() * 96, 16 + random() * 96),
    });
  }
  return records;
}

function createHugeOverflowRecords(normalCount, hugeCount, seed) {
  const records = createSparseNormalRecords(normalCount, seed);
  const random = mulberry32(seed ^ 0x9e3779b9);
  for (let offset = 0; offset < hugeCount; offset += 1) {
    const key = normalCount + offset;
    // 每个对象覆盖远超 64 个 cell，应走产品 overflow，而不是大量 bucket 复制。
    records.push({
      key,
      value: key,
      order: key,
      bounds: bounds(-500_000 + random() * 10_000, -500_000 + random() * 10_000, 1_000_000, 1_000_000),
    });
  }
  return records;
}

/** oracle 自己实现半开 AABB，不能调用产品 intersectsSpatialBounds。 */
function oracleIntersects(left, right) {
  return left.minX < right.maxX && left.maxX > right.minX && left.minY < right.maxY && left.maxY > right.minY;
}

class LinearOracle {
  constructor() {
    this.records = new Map();
    this.nextOrder = 0;
  }

  upsert(key, value, recordBounds, order) {
    const previousOrder = this.records.get(key)?.order;
    const assignedOrder = order ?? previousOrder ?? this.nextOrder++;
    this.records.set(key, { key, value, order: assignedOrder, bounds: { ...recordBounds } });
  }

  remove(key) {
    return this.records.delete(key);
  }

  query(queryBounds) {
    return [...this.records.values()]
      .filter((record) => oracleIntersects(record.bounds, queryBounds))
      .sort((left, right) => left.order - right.order);
  }
}

function buildProductIndex(SparseSpatialIndex, records, options = PRODUCT_OPTIONS) {
  const index = new SparseSpatialIndex(options);
  for (const record of records) {
    if (!index.upsert(record.key, record.value, record.bounds, record.order)) {
      throw new Error(`产品索引拒绝有效 record ${record.key}`);
    }
  }
  return index;
}

function buildOracle(records) {
  const oracle = new LinearOracle();
  for (const record of records) oracle.upsert(record.key, record.value, record.bounds, record.order);
  return oracle;
}

function assertQueriesMatch(label, index, oracle, queries) {
  let matches = 0;
  for (const queryBounds of queries) {
    const actual = index.query(queryBounds);
    const expected = oracle.query(queryBounds);
    if (actual.length !== expected.length) {
      throw new Error(`${label}: 命中数不一致 actual=${actual.length} expected=${expected.length}`);
    }
    for (let position = 0; position < actual.length; position += 1) {
      if (actual[position].key !== expected[position].key || actual[position].order !== expected[position].order) {
        throw new Error(`${label}: 第 ${position} 项 key/order 不一致`);
      }
    }
    matches += actual.length;
  }
  return { queryCount: queries.length, matchedRecordsAcrossQueries: matches, exactOrderAndKeys: true };
}

/** 计时的线性基线只累加命中数，不包含 oracle 的排序、数组分配和断言。 */
function linearHitCount(records, queryBounds) {
  let hits = 0;
  for (const record of records) if (oracleIntersects(record.bounds, queryBounds)) hits += 1;
  return hits;
}

function queryProductHitCount(index, queries) {
  let hits = 0;
  for (const queryBounds of queries) hits += index.query(queryBounds).length;
  return hits;
}

function queryLinearHitCount(records, queries) {
  let hits = 0;
  for (const queryBounds of queries) hits += linearHitCount(records, queryBounds);
  return hits;
}

function percentile(sorted, ratio) {
  return sorted[Math.floor(ratio * (sorted.length - 1))];
}

function summarize(durationsMs) {
  const sorted = [...durationsMs].sort((left, right) => left - right);
  return {
    rounds: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1),
    minMs: sorted[0],
    meanMs: sorted.reduce((total, value) => total + value, 0) / sorted.length,
  };
}

/** 每轮只包围被测操作；warmup 和正确性检查均在采样时钟外。 */
function measure(operation, warmup = WARMUP_ROUNDS, rounds = MEASURED_ROUNDS) {
  let checksum = 0;
  for (let round = 0; round < warmup; round += 1) checksum += operation();
  const durationsMs = [];
  for (let round = 0; round < rounds; round += 1) {
    const started = process.hrtime.bigint();
    checksum += operation();
    durationsMs.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return { ...summarize(durationsMs), checksum };
}

/** setup 每轮生成全新索引但不进入时钟，适合测量独立 update/remove 成本。 */
function measureWithSetup(setup, operation, warmup = WARMUP_ROUNDS, rounds = MEASURED_ROUNDS) {
  let checksum = 0;
  for (let round = 0; round < warmup; round += 1) checksum += operation(setup());
  const durationsMs = [];
  for (let round = 0; round < rounds; round += 1) {
    const subject = setup();
    const started = process.hrtime.bigint();
    checksum += operation(subject);
    durationsMs.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return { ...summarize(durationsMs), checksum };
}

function makeUpdates(records, count) {
  return Array.from({ length: count }, (_, position) => {
    const original = records[(position * 17) % records.length];
    return {
      ...original,
      bounds: bounds(original.bounds.minX + 173, original.bounds.minY - 211, original.bounds.maxX - original.bounds.minX, original.bounds.maxY - original.bounds.minY),
    };
  });
}

function makeRemovalKeys(records, count) {
  return Array.from({ length: count }, (_, position) => records[records.length - 1 - position * 19].key);
}

function applyUpdates(index, updates) {
  for (const record of updates) index.upsert(record.key, record.value, record.bounds, record.order);
  return index.size;
}

function applyRemovals(index, keys) {
  for (const key of keys) index.remove(key);
  return index.size;
}

function memorySnapshot(label) {
  if (typeof global.gc === 'function') global.gc();
  const usage = process.memoryUsage();
  return { label, rss: usage.rss, heapTotal: usage.heapTotal, heapUsed: usage.heapUsed, external: usage.external, arrayBuffers: usage.arrayBuffers };
}

function inputFingerprint(records, queries) {
  let hash = 0x811c9dc5;
  for (const item of [...records, ...queries]) {
    for (const value of Object.values(item.bounds ?? item)) {
      const text = String(value);
      for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
    }
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function runB1(SparseSpatialIndex) {
  const records = createComparableNormalRecords(100_000);
  const queries = createComparableQueries();
  const index = buildProductIndex(SparseSpatialIndex, records);
  const correctness = assertQueriesMatch('B1 comparable normal', index, buildOracle(records), queries);
  const expectedHits = queryLinearHitCount(records, queries);
  const indexed = measure(() => queryProductHitCount(index, queries));
  const linear = measure(() => queryLinearHitCount(records, queries));
  if (indexed.checksum / (WARMUP_ROUNDS + MEASURED_ROUNDS) !== expectedHits || linear.checksum / (WARMUP_ROUNDS + MEASURED_ROUNDS) !== expectedHits) {
    throw new Error('B1 计时路径命中总数偏离 oracle');
  }
  return {
    id: 'B1-comparable-normal-100k-16q',
    purpose: '复核阶段 2.3 输入规模，但实际测量当前 SparseSpatialIndex，绝不将旧 dense-grid 数值当作 sparse 数值。',
    recordCount: records.length,
    queryCount: queries.length,
    queryShape: { width: 800, height: 600, worldSize: 4096 },
    options: PRODUCT_OPTIONS,
    seed: SEED + records.length,
    inputFingerprint: inputFingerprint(records, queries),
    correctness,
    hitsPerRound: expectedHits,
    baselineLinearScan: linear,
    productSparseIndexQuery: indexed,
  };
}

function runB2(SparseSpatialIndex) {
  const records = createComparableNormalRecords(100_000, SEED ^ 0xb2000000);
  const queries = createComparableQueries();
  const updates = makeUpdates(records, 5_000);
  const removals = makeRemovalKeys(records, 5_000);
  const snapshots = [memorySnapshot('before-build')];
  const retained = buildProductIndex(SparseSpatialIndex, records);
  const oracle = buildOracle(records);
  const correctness = { beforeMutation: assertQueriesMatch('B2 before mutation', retained, oracle, queries) };
  snapshots.push(memorySnapshot('after-build-100k'));
  applyUpdates(retained, updates);
  for (const record of updates) oracle.upsert(record.key, record.value, record.bounds, record.order);
  correctness.afterUpdate = assertQueriesMatch('B2 after update', retained, oracle, queries);
  snapshots.push(memorySnapshot('after-update-5k'));
  applyRemovals(retained, removals);
  for (const key of removals) oracle.remove(key);
  correctness.afterRemove = assertQueriesMatch('B2 after remove', retained, oracle, queries);
  snapshots.push(memorySnapshot('after-remove-5k'));

  const build = measure(() => buildProductIndex(SparseSpatialIndex, records).size);
  const update = measureWithSetup(
    () => buildProductIndex(SparseSpatialIndex, records),
    (index) => applyUpdates(index, updates)
  );
  const remove = measureWithSetup(
    () => buildProductIndex(SparseSpatialIndex, records),
    (index) => applyRemovals(index, removals)
  );
  const query = measure(() => queryProductHitCount(retained, queries));
  return {
    id: 'B2-lifecycle-and-memory',
    recordCount: records.length,
    updateCount: updates.length,
    removeCount: removals.length,
    queryCount: queries.length,
    options: PRODUCT_OPTIONS,
    seed: SEED ^ 0xb2000000,
    inputFingerprint: inputFingerprint(records, queries),
    correctness,
    operations: { build, update, remove, query },
    memory: {
      gcAvailable: typeof global.gc === 'function',
      snapshots,
      note: '快照包含进程级 Node 堆与 RSS；它们不是对象精确占用，也会受 V8 分配器和其他进程内对象影响。',
    },
  };
}

function runProductScenario(SparseSpatialIndex, definition) {
  const index = buildProductIndex(SparseSpatialIndex, definition.records, definition.options);
  const correctness = assertQueriesMatch(definition.id, index, buildOracle(definition.records), definition.queries);
  const hitsPerRound = queryLinearHitCount(definition.records, definition.queries);
  const query = measure(() => queryProductHitCount(index, definition.queries));
  if (query.checksum / (WARMUP_ROUNDS + MEASURED_ROUNDS) !== hitsPerRound) {
    throw new Error(`${definition.id}: 计时路径命中总数偏离 oracle`);
  }
  return {
    id: definition.id,
    scope: definition.scope,
    recordCount: definition.records.length,
    queryCount: definition.queries.length,
    options: definition.options,
    seed: definition.seed,
    inputFingerprint: inputFingerprint(definition.records, definition.queries),
    correctness,
    hitsPerRound,
    productSparseIndexQuery: query,
  };
}

function runB3(SparseSpatialIndex) {
  const sparseRecords = createSparseNormalRecords(50_000, SEED ^ 0x301);
  const sparseQueries = createDistributedQueries(16, SEED ^ 0x302, 1_000_000, 1_200, 900);
  const denseRecords = createSkewDenseRecords(50_000, SEED ^ 0x303);
  const denseQueries = Array.from({ length: 16 }, (_, index) => bounds(-512 + (index % 4) * 128, -512 + Math.floor(index / 4) * 128, 768, 768));
  const hugeRecords = createHugeOverflowRecords(30_000, 250, SEED ^ 0x304);
  const hugeQueries = createDistributedQueries(16, SEED ^ 0x305, 1_000_000, 1_200, 900);
  const fallbackRecords = createSparseNormalRecords(30_000, SEED ^ 0x306);
  const fallbackQueries = Array.from({ length: 8 }, (_, index) => bounds(-500_000 + index * 1_000, -500_000 + index * 1_000, 64_000, 64_000));
  const scenarios = [
    runProductScenario(SparseSpatialIndex, { id: 'B3-sparse-normal', scope: '50k 对象分散在 1,000,000 DIP 世界，16 个局部查询。', records: sparseRecords, queries: sparseQueries, options: PRODUCT_OPTIONS, seed: SEED ^ 0x301 }),
    runProductScenario(SparseSpatialIndex, { id: 'B3-skew-dense', scope: '50k 对象中 90% 聚集于 1024 DIP 区域，16 个局部密集查询。', records: denseRecords, queries: denseQueries, options: PRODUCT_OPTIONS, seed: SEED ^ 0x303 }),
    runProductScenario(SparseSpatialIndex, { id: 'B3-huge-overflow', scope: '30k 常规对象加 250 个 1,000,000 DIP huge bbox；每个 huge bbox 超过 maxCellsPerObject=64，应以 overflow 参与候选。', records: hugeRecords, queries: hugeQueries, options: PRODUCT_OPTIONS, seed: SEED ^ 0x304 }),
    runProductScenario(SparseSpatialIndex, { id: 'B3-large-query-fallback', scope: '30k 稀疏对象、64,000x64,000 DIP 查询。该尺寸约覆盖 62,500 个 256 DIP cell，超过 maxCellsPerQuery=4,096，产品应回退到全 records 精确过滤。', records: fallbackRecords, queries: fallbackQueries, options: PRODUCT_OPTIONS, seed: SEED ^ 0x306 }),
  ];

  const cellSizeSweep = [64, 128, 256, 512, 1024].map((cellSize) =>
    runProductScenario(SparseSpatialIndex, {
      id: `B3-cell-size-${cellSize}`,
      scope: `使用 B3 sparse-normal 的相同 50k 输入，cellSize=${cellSize} DIP。`,
      records: sparseRecords,
      queries: sparseQueries,
      options: { ...PRODUCT_OPTIONS, cellSize },
      seed: SEED ^ 0x301,
    })
  );
  return { scenarios, cellSizeSweep };
}

function collectEnvironment() {
  const cpus = os.cpus();
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    commit = 'unavailable';
  }
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? null,
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    commit,
    timingSource: 'process.hrtime.bigint() monotonic nanoseconds, converted to milliseconds',
  };
}

async function loadProductIndex() {
  if (!existsSync(TYPESCRIPT_CLI)) throw new Error(`未找到 TypeScript CLI: ${TYPESCRIPT_CLI}`);
  const temporaryOutput = mkdtempSync(join(os.tmpdir(), 'hamster-note-product-performance-'));
  try {
    execFileSync(process.execPath, [TYPESCRIPT_CLI, PRODUCT_SOURCE, '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--rootDir', dirname(PRODUCT_SOURCE), '--outDir', temporaryOutput, '--skipLibCheck', '--declaration', 'false', '--sourceMap', 'false'], { cwd: REPO_ROOT, stdio: 'pipe' });
    return await import(`${pathToFileURL(join(temporaryOutput, 'spatialIndex.js')).href}?run=${Date.now()}`);
  } finally {
    // ESM 已完成加载，模块没有相对依赖；清理临时编译目录不影响已加载定义。
    rmSync(temporaryOutput, { recursive: true, force: true });
  }
}

async function main() {
  const { SparseSpatialIndex } = await loadProductIndex();
  const result = {
    spike: 'phase-10-product-performance',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: 'node --expose-gc spikes/product-performance/run.mjs',
    verificationOwner: 'parent orchestrator',
    productSource: 'packages/painting/src/core/spatialIndex.ts',
    method: {
      productLoading: '每次运行用仓库已安装的 TypeScript CLI 将当前 spatialIndex.ts 编译到 OS 临时目录后直接 ESM import；不导入旧 coordinate-performance dense grid，不修改 packages 或 lib。',
      input: '全部场景使用确定性 mulberry32 seed；JSON 记录 seed 和 FNV-1a 输入 fingerprint。',
      correctness: '每个场景先以独立 LinearOracle 的半开 AABB 谓词全扫描并按 order 排序，再逐项比较产品 query 的 key 与 order。oracle 与计时逻辑分离。',
      timing: `${WARMUP_ROUNDS} 次 warmup 后测量 ${MEASURED_ROUNDS} 轮；query 每轮完整遍历该场景 query bank。B2 的 update/remove 每轮在计时前构建全新 100k 索引，因此只记录 mutation 本身。p50/p95 使用排序样本 floor(p*(n-1))，计时来源为 process.hrtime.bigint()。`,
      memory: 'B2 使用 process.memoryUsage()，在 --expose-gc 可用时于每个快照前调用 global.gc()；快照本身不在操作计时中。',
    },
    limitations: [
      '所有耗时仅用于同一机器、相近 Node/V8 条件下的趋势与回归观察；不可跨机器、跨 Node 版本或跨负载比较。',
      '这是 Node CPU 的产品逻辑微基准，不是 Web、CanvasKit、Skia、native 或 GPU 帧时间 SLA。',
      'B1 复用阶段 2.3 的 100k/16-query 输入形状，但旧阶段的 dense fixed grid 仅是历史 control，绝不作为本 sparse 产品索引的性能值或阈值。',
      '线性基线仅累计精确 AABB 命中；产品 query 返回排序匹配数组，因此该对照用于测量趋势，不是端到端 UI 成本。',
      '内存快照为进程级近似值，受 V8 GC、分配器、Node 本身和同时驻留对象影响，不能解释为单一索引的精确字节数。',
      '场景是确定性合成 bbox，不包含真实绘制、手势、序列化、React、Web Skia 或真机工作负载。',
      '本报告只记录测得基线，不自行设定任何百分比回归阈值或 SLA。',
    ],
    environment: collectEnvironment(),
    inputs: { seed: SEED, warmupRounds: WARMUP_ROUNDS, measuredRounds: MEASURED_ROUNDS, defaultOptions: PRODUCT_OPTIONS },
    B1: runB1(SparseSpatialIndex),
    B2: runB2(SparseSpatialIndex),
    B3: runB3(SparseSpatialIndex),
  };
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`[product-performance] wrote ${OUTPUT_PATH}\nB1 sparse p50=${result.B1.productSparseIndexQuery.p50Ms.toFixed(3)}ms p95=${result.B1.productSparseIndexQuery.p95Ms.toFixed(3)}ms max=${result.B1.productSparseIndexQuery.maxMs.toFixed(3)}ms\n`);
}

await main();
