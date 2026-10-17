#!/usr/bin/env node

/**
 * Phase 10 Web-only production 性能合同 runner。
 * 它不启动 Metro，也不调用 core；每一轮仅通过 production root 的正式 PointerEvent adapter 输入。
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { cpus, platform, release, totalmem, arch } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  CORRECTNESS_PENDING_PAGE_FIELDS,
  requiredCorrectnessFields,
  validateCorrectness,
  validateRebaseProbe,
} from './editor-production-performance-oracle.mjs';
import {
  BASELINE_SCHEMA_VERSION,
  PRODUCT_TREE_ELIGIBILITY,
  compareCandidateToBaseline,
  validateFrozenBaseline as validateFrozenBaselineContract,
} from './editor-production-baseline-gate.mjs';
import { createSourceIdentityManifest } from './source-identity.mjs';

const runnerPath = fileURLToPath(import.meta.url);
const here = dirname(runnerPath);
const workspace = resolve(here, '../..');
const outputPath = resolve(
  workspace,
  'openspec/changes/migrate-expo57-skia-surface/spikes/phase-10/editor-production-performance.json'
);
// 冻结性能基线使用独立、显式路径；runner 绝不自动创建或覆写它。
const baselinePath = resolve(
  workspace,
  'openspec/changes/migrate-expo57-skia-surface/spikes/phase-10/editor-production-performance-baseline.json'
);
// 覆盖候选报告前，先把上一份完整 artifact 复制到 history 目录，绝不给“无证据覆写”留口子。
const historyDir = resolve(
  workspace,
  'openspec/changes/migrate-expo57-skia-surface/spikes/phase-10/editor-production-performance-history'
);
const baselineDegradationRatio = 0.2;
// 冻结基线 compact artifact 的 kind/schema 由 editor-production-baseline-gate.mjs 统一校验：
// v2 的 compact JSON 只允许引用被 sha256 钉死的完整候选 artifact，绝不自带可信 metrics。
const distPath = resolve(workspace, 'apps/playground/dist');
const serverPath = resolve(here, 'static-spa-server.mjs');
const viewport = { width: 1440, height: 900 };
const deviceScaleFactors = [1, 2];
const contextsPerScale = 5;
const input = { eventsPerSecond: 120, durationMs: 10_000 };
const browserArgs = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];
const performanceContracts = {
  eventToNextFrameP95Ms: 50,
  commitP95Ms: 50,
  rafIntervalP95Ms: 33.4,
  maximumLongTaskMs: 100,
};

function command(command, args) {
  return execFileSync(command, args, { cwd: workspace, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function tryCommand(commandName, args, fallback = null) {
  try {
    return command(commandName, args);
  } catch {
    return fallback;
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function serializedError(error) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };
}

async function treeHash(paths) {
  const hash = createHash('sha256');
  async function visit(path) {
    const stat = await fs.stat(path);
    if (stat.isDirectory()) {
      for (const child of (await fs.readdir(path)).sort()) {
        if (child === 'node_modules' || child === 'dist' || child === '.expo') continue;
        await visit(resolve(path, child));
      }
      return;
    }
    hash.update(`${relative(workspace, path)}\0`);
    hash.update(await fs.readFile(path));
    hash.update('\0');
  }
  for (const path of paths) if (existsSync(path)) await visit(path);
  return hash.digest('hex');
}

function percentile(samples, p) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(p * (sorted.length - 1))];
}

function summary(samples, invalidSamples = []) {
  const finite = samples.filter(Number.isFinite);
  const invalid = invalidSamples.filter(Boolean);
  return {
    count: finite.length,
    negativeCount: finite.filter((sample) => sample < 0).length,
    invalidCount: invalid.length,
    p50Ms: percentile(finite, 0.5),
    p95Ms: percentile(finite, 0.95),
    maxMs: finite.length === 0 ? null : Math.max(...finite),
  };
}

function invalidReasonCounts(samples) {
  return Object.fromEntries(
    [
      ...samples.reduce((counts, sample) => {
        const reason = sample.invalidReason ?? 'unspecified-invalid-sample';
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
        return counts;
      }, new Map()),
    ].sort(([left], [right]) => left.localeCompare(right))
  );
}

function inspectPointerSamples(pointerSamples, expectedCount, enforcePerContextIdentity = true) {
  const invalidSamples = [];
  const sequenceCounts = new Map();
  const eventIdCounts = new Map();
  let negativeLatencyCount = 0;
  let orderingViolationCount = 0;

  for (const sample of pointerSamples) {
    const reasons = [];
    if (sample?.invalidReason !== null && sample?.invalidReason !== undefined) {
      reasons.push(`sampler:${String(sample.invalidReason)}`);
    }
    if (typeof sample?.eventId !== 'string' || sample.eventId.length === 0) {
      reasons.push('missing-event-id');
    } else {
      eventIdCounts.set(sample.eventId, (eventIdCounts.get(sample.eventId) ?? 0) + 1);
    }
    if (
      !Number.isInteger(sample?.sequence) ||
      sample.sequence < 1 ||
      (enforcePerContextIdentity && sample.sequence > expectedCount)
    ) {
      reasons.push('invalid-sequence');
    } else {
      sequenceCounts.set(sample.sequence, (sequenceCounts.get(sample.sequence) ?? 0) + 1);
    }
    if (!Number.isFinite(sample?.emittedAt) || !Number.isFinite(sample?.receivedAt)) {
      reasons.push('missing-emission-or-receipt-clock');
    } else if (sample.receivedAt < sample.emittedAt) {
      reasons.push('receipt-before-emission');
      orderingViolationCount += 1;
    }
    if (!Number.isFinite(sample?.scheduledAt) || !Number.isFinite(sample?.callbackAt)) {
      reasons.push('missing-open-loop-deadline-or-callback-clock');
    } else if (sample.callbackAt < sample.scheduledAt || sample.emittedAt < sample.callbackAt) {
      reasons.push('open-loop-clock-order-violation');
      orderingViolationCount += 1;
    }
    if (!Number.isFinite(sample?.nextFrameAt) || !Number.isFinite(sample?.nextFrameLatencyMs)) {
      reasons.push('missing-next-frame');
    } else {
      if (sample.nextFrameLatencyMs < 0) negativeLatencyCount += 1;
      if (
        !Number.isFinite(sample?.receivedAt) ||
        !Number.isFinite(sample?.emittedAt) ||
        sample.nextFrameAt < sample.receivedAt ||
        sample.nextFrameAt < sample.emittedAt
      ) {
        reasons.push('next-frame-before-receipt-or-emission');
        orderingViolationCount += 1;
      }
      if (sample.nextFrameLatencyMs < 0) reasons.push('negative-next-frame-latency');
    }
    if (reasons.length > 0) invalidSamples.push({ ...sample, invalidReason: reasons.join(';') });
  }

  if (enforcePerContextIdentity) {
    for (let sequence = 1; sequence <= expectedCount; sequence += 1) {
      if (sequenceCounts.get(sequence) !== 1) {
        invalidSamples.push({
          invalidReason: `sequence-count:${sequence}:${sequenceCounts.get(sequence) ?? 0}`,
        });
      }
    }
    for (const [eventId, count] of eventIdCounts) {
      if (count !== 1) invalidSamples.push({ invalidReason: `event-id-count:${eventId}:${count}` });
    }
  }
  if (pointerSamples.length !== expectedCount) {
    invalidSamples.push({
      invalidReason: `pointer-sample-count:${pointerSamples.length}:expected-${expectedCount}`,
    });
  }

  const invalidByIdentity = new Set(
    invalidSamples.filter((sample) => sample.eventId).map((sample) => sample.eventId)
  );
  const validSamples = pointerSamples.filter(
    (sample) =>
      typeof sample?.eventId === 'string' &&
      !invalidByIdentity.has(sample.eventId) &&
      sample.invalidReason === null &&
      Number.isFinite(sample.nextFrameLatencyMs) &&
      sample.nextFrameLatencyMs >= 0
  );
  return {
    validSamples,
    invalidSamples,
    invalidReasonCounts: invalidReasonCounts(invalidSamples),
    negativeLatencyCount,
    orderingViolationCount,
    countMatches: pointerSamples.length === expectedCount,
  };
}

function workloadMetrics(inputRun, expectedCount) {
  const actual = inputRun?.actual ?? {};
  const failures = [];
  const firstScheduledAt = actual.firstScheduledAt;
  const lastScheduledAt = actual.lastScheduledAt;
  const lastEmittedAt = actual.lastEmittedAt;
  const scheduleWindowEndsAt = actual.scheduleWindowEndsAt;
  const scheduledSpanMs =
    Number.isFinite(firstScheduledAt) && Number.isFinite(lastScheduledAt)
      ? lastScheduledAt - firstScheduledAt
      : null;
  const actualSpanMs = actual.actualOpenLoopSpanMs;
  const requestedIntervalMs = 1_000 / inputRun?.requested?.eventsPerSecond;
  const expectedScheduledSpanMs =
    Number.isFinite(requestedIntervalMs) && expectedCount > 0
      ? (expectedCount - 1) * requestedIntervalMs
      : null;
  if (inputRun?.status !== 'completed')
    failures.push(`input run status is ${String(inputRun?.status)}`);
  if (inputRun?.workloadPrerequisiteFailed === true)
    failures.push('page marked workloadPrerequisiteFailed');
  if (actual.eventCount !== expectedCount) {
    failures.push(`formal event count is ${String(actual.eventCount)}, expected ${expectedCount}`);
  }
  if (actual.dispatched !== expectedCount) {
    failures.push(
      `dispatched event count is ${String(actual.dispatched)}, expected ${expectedCount}`
    );
  }
  if (!Number.isFinite(firstScheduledAt) || !Number.isFinite(lastScheduledAt)) {
    failures.push('open-loop schedule timestamps are missing');
  } else if (
    !Number.isFinite(expectedScheduledSpanMs) ||
    Math.abs(scheduledSpanMs - expectedScheduledSpanMs) > 0.001
  ) {
    failures.push('open-loop deadlines do not cover the requested 120 Hz schedule');
  }
  if (!Number.isFinite(lastEmittedAt) || !Number.isFinite(scheduleWindowEndsAt)) {
    failures.push('last emission or 10 second window end is missing');
  } else if (lastEmittedAt > scheduleWindowEndsAt) {
    failures.push('open-loop emission did not complete inside the 10 second contract window');
  }
  if (actual.settledWithinWindow !== true) {
    failures.push(
      'receipt/commit/next-frame did not settle before the bounded measurement deadline'
    );
  }
  return {
    status: failures.length === 0 ? 'VALID' : 'INVALID',
    expectedEventCount: expectedCount,
    dispatchedEventCount: actual.dispatched ?? null,
    formalEventCount: actual.eventCount ?? null,
    firstScheduledAt: firstScheduledAt ?? null,
    lastScheduledAt: lastScheduledAt ?? null,
    scheduledSpanMs,
    expectedScheduledSpanMs,
    actualOpenLoopSpanMs: Number.isFinite(actualSpanMs) ? actualSpanMs : null,
    callbackSpanMs: Number.isFinite(actual.callbackSpanMs) ? actual.callbackSpanMs : null,
    lastEmittedAt: lastEmittedAt ?? null,
    scheduleWindowEndsAt: scheduleWindowEndsAt ?? null,
    maxScheduleLatenessMs: actual.maxScheduleLatenessMs ?? null,
    maxBacklogAtCallback: actual.maxBacklogAtCallback ?? null,
    settlementCompletedAt: actual.settlementCompletedAt ?? null,
    settledWithinWindow: actual.settledWithinWindow === true,
    failures,
  };
}

function pointerMetrics(
  pointerSamples,
  expectedPointerSampleCount,
  enforcePerContextIdentity = true
) {
  const inspection = inspectPointerSamples(
    pointerSamples,
    expectedPointerSampleCount,
    enforcePerContextIdentity
  );
  const validCommitSamples = inspection.validSamples.filter(
    (sample) =>
      Number.isFinite(sample.commitAt) &&
      Number.isFinite(sample.commitLatencyMs) &&
      sample.commitAt >= sample.receivedAt &&
      sample.commitAt >= sample.emittedAt &&
      sample.commitLatencyMs >= 0
  );
  const invalidCommitSamples = inspection.validSamples.filter(
    (sample) => !validCommitSamples.includes(sample)
  );
  const eventToNextFrame = summary(
    inspection.validSamples.map((sample) => sample.nextFrameLatencyMs),
    inspection.invalidSamples
  );
  // Percentiles intentionally consume only valid samples, but this count still exposes every
  // observed negative raw latency instead of presenting an empty/zeroed failure signal.
  eventToNextFrame.negativeCount = inspection.negativeLatencyCount;
  return {
    eventToNextFrame,
    commit: summary(
      validCommitSamples.map((sample) => sample.commitLatencyMs),
      invalidCommitSamples
    ),
    validity: {
      status: inspection.invalidSamples.length === 0 ? 'VALID' : 'INVALID',
      validCount: inspection.validSamples.length,
      invalidCount: inspection.invalidSamples.length,
      invalidReasonCounts: inspection.invalidReasonCounts,
      negativeLatencyCount: inspection.negativeLatencyCount,
      orderingViolationCount: inspection.orderingViolationCount,
      countMatches: inspection.countMatches,
    },
  };
}

function validateSnapshot(snapshot) {
  const failures = [];
  if (snapshot?.mode !== 'enabled') failures.push('performance mode is not enabled');
  if (snapshot?.workload?.strokeCount !== 100_000)
    failures.push('workload strokeCount is not 100000');
  if (snapshot?.document?.strokeCount !== 100_000)
    failures.push('document strokeCount is not 100000');
  if (snapshot?.canvas?.ready !== true) failures.push('canvas is not ready');
  if (snapshot?.canvas?.frameStatus !== 'ready' || snapshot?.frame?.ready !== true)
    failures.push('frame is not ready');
  return { passed: failures.length === 0, failures };
}

function evaluateContracts({
  prerequisites,
  rebase,
  workload,
  metrics,
  longTaskStatus,
  correctness,
}) {
  const measurementValid = metrics.validity.status === 'VALID';
  const checks = {
    prerequisites: { passed: prerequisites.passed, details: prerequisites.failures },
    rebase: { passed: rebase.passed, details: rebase.failures },
    // correctness 现在由独立 runner-side oracle 判定 document 内容与输入方程，绝不再等于
    // prerequisites && rebase；缺字段 / 未验证项一律 fail closed。
    correctness: {
      passed: correctness?.passed === true,
      details: correctness?.failures ?? ['missing correctness oracle result'],
      missingFields: correctness?.missingFields ?? [],
      unverifiedChecks: correctness?.unverifiedChecks ?? [],
      requiredFields: correctness?.requiredFields ?? requiredCorrectnessFields(),
      pendingPageFields: correctness?.pendingPageFields ?? [...CORRECTNESS_PENDING_PAGE_FIELDS],
      checks: correctness?.checks ?? null,
      expected: correctness?.expected ?? null,
      limitations: correctness?.limitations ?? [],
    },
    workload: {
      passed: workload.status === 'VALID',
      status: workload.status,
      details: workload.failures,
      expectedEventCount: workload.expectedEventCount,
      dispatchedEventCount: workload.dispatchedEventCount,
      scheduledSpanMs: workload.scheduledSpanMs,
      actualOpenLoopSpanMs: workload.actualOpenLoopSpanMs,
      maxScheduleLatenessMs: workload.maxScheduleLatenessMs,
      maxBacklogAtCallback: workload.maxBacklogAtCallback,
    },
    eventToNextFrameP95: {
      thresholdMs: performanceContracts.eventToNextFrameP95Ms,
      actualMs: metrics.eventToNextFrame.p95Ms,
      measurementStatus: metrics.validity.status,
      validSampleCount: metrics.eventToNextFrame.count,
      invalidSampleCount: metrics.validity.invalidCount,
      invalidReasonCounts: metrics.validity.invalidReasonCounts,
      negativeSampleCount: metrics.validity.negativeLatencyCount,
      orderingViolationCount: metrics.validity.orderingViolationCount,
      passed:
        measurementValid &&
        metrics.eventToNextFrame.count > 0 &&
        metrics.eventToNextFrame.p95Ms <= performanceContracts.eventToNextFrameP95Ms,
    },
    commitP95: {
      thresholdMs: performanceContracts.commitP95Ms,
      actualMs: metrics.commit.p95Ms,
      sampleCount: metrics.commit.count,
      contractGap: metrics.commit.count !== metrics.expectedPointerSampleCount,
      passed:
        measurementValid &&
        metrics.commit.count === metrics.expectedPointerSampleCount &&
        metrics.commit.p95Ms <= performanceContracts.commitP95Ms,
    },
    rafIntervalP95: {
      thresholdMs: performanceContracts.rafIntervalP95Ms,
      actualMs: metrics.rafInterval.p95Ms,
      passed:
        metrics.rafInterval.count > 0 &&
        metrics.rafInterval.p95Ms <= performanceContracts.rafIntervalP95Ms,
    },
    longTask: {
      thresholdMs: performanceContracts.maximumLongTaskMs,
      status: longTaskStatus,
      count: metrics.longTask.count,
      maxMs: metrics.longTask.maxMs,
      passed:
        longTaskStatus === 'supported' &&
        (metrics.longTask.maxMs === null ||
          metrics.longTask.maxMs <= performanceContracts.maximumLongTaskMs),
    },
  };
  return { passed: Object.values(checks).every((check) => check.passed), checks };
}

async function startServer() {
  const child = spawn(process.execPath, [serverPath, '--root', distPath, '--port', '0'], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const listening = await new Promise((resolveListening, rejectListening) => {
    let stdout = '';
    const timeout = setTimeout(
      () => rejectListening(new Error(`Static server start timed out: ${stderr}`)),
      15_000
    );
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const line = stdout.split('\n').find((entry) => entry.includes('"event":"listening"'));
      if (!line) return;
      clearTimeout(timeout);
      try {
        resolveListening(JSON.parse(line));
      } catch (error) {
        rejectListening(error);
      }
    });
    child.once('error', rejectListening);
    child.once('exit', (code) =>
      rejectListening(new Error(`Static server exited (${code}): ${stderr}`))
    );
  });
  return { process: child, listening };
}

async function collectRound(browser, baseUrl, deviceScaleFactor, index) {
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();
  const result = {
    contextIndex: index + 1,
    deviceScaleFactor,
    startedAt: new Date().toISOString(),
    prerequisites: null,
    readinessSnapshot: null,
    correctnessSnapshot: null,
    correctness: null,
    diagnostics: null,
    wasm: null,
    rebaseProbe: null,
    inputRun: null,
    metrics: null,
    contract: null,
    failure: null,
  };
  try {
    const wasmResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/canvaskit.wasm',
      { timeout: 120_000 }
    );
    await page.goto(`${baseUrl}/?perf=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const snapshot = await page.waitForFunction(
      () => {
        const api = window.__hamsterEditorPerf;
        const diagnostics = document.querySelector(
          '[data-testid="editor-candidate-performance-diagnostics"]'
        );
        if (
          !api ||
          diagnostics?.getAttribute('data-workload-ready') !== 'true' ||
          diagnostics.getAttribute('data-workload-strokes') !== '100000' ||
          diagnostics.getAttribute('data-frame-ready') !== 'true'
        ) {
          return null;
        }
        const value = api.getSnapshot();
        return value?.mode === 'enabled' &&
          value?.document?.strokeCount === 100_000 &&
          value?.canvas?.ready &&
          value?.frame?.ready
          ? value
          : null;
      },
      undefined,
      { timeout: 180_000 }
    );
    const wasm = await wasmResponse;
    result.wasm = {
      url: wasm.url(),
      status: wasm.status(),
      contentType: wasm.headers()['content-type'] ?? null,
      sameOrigin: new URL(wasm.url()).origin === baseUrl,
    };
    result.readinessSnapshot = await snapshot.jsonValue();
    result.diagnostics = await page.evaluate(() => {
      const node = document.querySelector(
        '[data-testid="editor-candidate-performance-diagnostics"]'
      );
      return node
        ? {
            workloadReady: node.getAttribute('data-workload-ready'),
            workloadSeed: node.getAttribute('data-workload-seed'),
            workloadStrokes: node.getAttribute('data-workload-strokes'),
            frameReady: node.getAttribute('data-frame-ready'),
            visible: node.getAttribute('data-visible'),
            renderable: node.getAttribute('data-renderable'),
            resourceRevision: node.getAttribute('data-resource-revision'),
          }
        : null;
    });
    result.prerequisites = validateSnapshot(result.readinessSnapshot);
    if (wasm.status() !== 200)
      result.prerequisites.failures.push(`wasm response status is ${wasm.status()}`);
    if (!result.wasm.contentType.includes('application/wasm'))
      result.prerequisites.failures.push(`wasm content-type is ${String(result.wasm.contentType)}`);
    if (!result.wasm.sameOrigin) result.prerequisites.failures.push('wasm is not same-origin');
    result.prerequisites.passed = result.prerequisites.failures.length === 0;

    // 前提失败时保留可诊断状态，不运行输入，更不以重试伪造可通过的 context。
    if (!result.prerequisites.passed) return result;

    result.rebaseProbe = await page.evaluate(
      () => window.__hamsterEditorPerf?.runRebaseProbe() ?? null
    );
    const rebase = validateRebaseProbe(result.rebaseProbe);
    await page.evaluate(() => window.__hamsterEditorPerf?.resetMeasurements());
    result.inputRun = await page.evaluate(
      (options) => window.__hamsterEditorPerf?.runHighRatePenInput(options) ?? null,
      input
    );
    // runHighRatePenInput 已 resolve 且测量窗口已停止；此后单独读取一次 post-run 快照，
    // 交给独立 correctness oracle。该读取不在测量窗口内，不改变任何性能指标。
    result.correctnessSnapshot = await page.evaluate(() => {
      const api = window.__hamsterEditorPerf;
      if (!api) return null;
      const snapshot = api.getSnapshot();
      // 原始测量已由 metrics.raw 单独持久化，避免在报告中重复 1200 条记录。
      if (snapshot && typeof snapshot === 'object' && 'measurements' in snapshot) {
        delete snapshot.measurements;
      }
      return snapshot ?? null;
    });
    // The page stops rAF/longtask sampling before returning this single raw collection. The
    // correctness snapshot above is a separate, post-window read whose `measurements` has been
    // removed, so the input-run timing metadata stays without duplicating 1200 raw records.
    const measurements = result.inputRun?.measurements ?? {};
    // `metrics.raw` below is the sole persisted collection for this round. Keep input-run timing
    // metadata, but do not duplicate 1200 raw records in the report under a second object path.
    if (result.inputRun && typeof result.inputRun === 'object') delete result.inputRun.measurements;
    const pointerSamples = Array.isArray(measurements.pointerSamples)
      ? measurements.pointerSamples
      : [];
    const expectedPointerSampleCount = (input.eventsPerSecond * input.durationMs) / 1_000;
    const pointerSampleMetrics = pointerMetrics(pointerSamples, expectedPointerSampleCount);
    const workload = workloadMetrics(result.inputRun, expectedPointerSampleCount);
    const metrics = {
      ...pointerSampleMetrics,
      rafInterval: summary(
        Array.isArray(measurements.raf?.intervalsMs) ? measurements.raf.intervalsMs : []
      ),
      longTask: summary(
        Array.isArray(measurements.longTasks?.entries)
          ? measurements.longTasks.entries.map((entry) => entry?.duration)
          : []
      ),
      pointerSampleCount: pointerSamples.length,
      expectedPointerSampleCount,
      raw: {
        pointerSamples,
        rafIntervalsMs: Array.isArray(measurements.raf?.intervalsMs)
          ? measurements.raf.intervalsMs
          : [],
        longTaskEntries: Array.isArray(measurements.longTasks?.entries)
          ? measurements.longTasks.entries
          : [],
        rafStatus: measurements.raf?.status ?? null,
        longTaskStatus: measurements.longTasks?.status ?? null,
        measurementWindow: measurements.window ?? null,
      },
    };
    if (!metrics.validity.countMatches)
      result.prerequisites.failures.push(
        `pointer sample count is ${metrics.pointerSampleCount}, expected ${metrics.expectedPointerSampleCount}`
      );
    if (metrics.raw.rafStatus !== 'stopped')
      result.prerequisites.failures.push('rAF sampler was not stopped before raw result transfer');
    if (
      !Number.isFinite(metrics.raw.measurementWindow?.startedAt) ||
      !Number.isFinite(metrics.raw.measurementWindow?.stoppedAt)
    ) {
      result.prerequisites.failures.push('measurement window timestamps are incomplete');
    }
    result.prerequisites.passed = result.prerequisites.failures.length === 0;
    result.metrics = metrics;
    // run-start 冻结上下文来自 inputRun.correctnessContext（页面待接）；禁止用 post-run 当前值代替。
    result.correctness = validateCorrectness({
      inputRun: result.inputRun,
      correctnessSnapshot: result.correctnessSnapshot,
      input,
    });
    result.contract = evaluateContracts({
      prerequisites: result.prerequisites,
      rebase,
      workload,
      metrics,
      longTaskStatus: metrics.raw.longTaskStatus,
      correctness: result.correctness,
    });
  } catch (error) {
    result.failure =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) };
  } finally {
    result.finishedAt = new Date().toISOString();
    await context.close();
  }
  return result;
}

/**
 * 汇总各 round 的 correctness 实际缺失字段（oracle 语义：全部 PASS => []）。
 * 任一 round 缺少 correctness 结果时，保守回退为「实际并集 + 全部必需字段」，
 * 绝不把「未校验」误报成「无待接字段」。
 */
function aggregateCorrectnessPendingFields(rounds, requiredFields) {
  const correctnessRounds = rounds.map((round) => round.correctness).filter(Boolean);
  const actual = [
    ...new Set(correctnessRounds.flatMap((result) => result.pendingPageFields ?? [])),
  ];
  if (correctnessRounds.length !== rounds.length) {
    return [...new Set([...actual, ...requiredFields])];
  }
  return actual;
}

function aggregateScale(rounds) {
  const completed = rounds.filter((round) => round.metrics);
  const values = (key) => completed.flatMap((round) => round.metrics.raw[key]);
  const longTaskStatus = [...new Set(completed.map((round) => round.metrics.raw.longTaskStatus))];
  const pointerSamples = values('pointerSamples');
  const expectedPointerSampleCount =
    completed.length * ((input.eventsPerSecond * input.durationMs) / 1_000);
  // Each browser context correctly starts its own 1..1200 sequence. Aggregate evidence must not
  // mistake that independent namespace for duplicate dispatches.
  const aggregatePointerMetrics = pointerMetrics(pointerSamples, expectedPointerSampleCount, false);
  const metrics = {
    ...aggregatePointerMetrics,
    rafInterval: summary(values('rafIntervalsMs')),
    longTask: summary(values('longTaskEntries').map((entry) => entry?.duration)),
    expectedPointerSampleCount,
  };
  const prerequisites = {
    passed:
      rounds.length === contextsPerScale &&
      rounds.every((round) => round.prerequisites?.passed === true),
    failures: rounds.flatMap((round) =>
      round.prerequisites?.passed
        ? []
        : [
            `context ${round.contextIndex}: ${
              round.prerequisites?.failures?.join('; ') ?? 'missing prerequisites'
            }`,
          ]
    ),
  };
  const rebase = {
    passed: rounds.every((round) => round.contract?.checks.rebase.passed === true),
    failures: rounds.flatMap((round) =>
      round.contract?.checks.rebase.passed
        ? []
        : [`context ${round.contextIndex}: rebase did not pass`]
    ),
  };
  const correctness = {
    passed:
      rounds.length === contextsPerScale &&
      rounds.every((round) => round.correctness?.passed === true),
    failures: rounds.flatMap((round) =>
      round.correctness?.passed
        ? []
        : [
            `context ${round.contextIndex}: ${
              round.correctness?.failures?.join('; ') ?? 'missing correctness oracle result'
            }`,
          ]
    ),
    missingFields: [...new Set(rounds.flatMap((round) => round.correctness?.missingFields ?? []))],
    unverifiedChecks: [
      ...new Set(rounds.flatMap((round) => round.correctness?.unverifiedChecks ?? [])),
    ],
    requiredFields: requiredCorrectnessFields(),
    pendingPageFields: aggregateCorrectnessPendingFields(rounds, requiredCorrectnessFields()),
    checks: null,
    expected: null,
    limitations: rounds[0]?.correctness?.limitations ?? [],
  };
  const aggregateContract = evaluateContracts({
    prerequisites,
    rebase,
    correctness,
    workload: {
      status: rounds.every((round) => round.contract?.checks.workload.passed === true)
        ? 'VALID'
        : 'INVALID',
      failures: rounds.flatMap((round) =>
        round.contract?.checks.workload.passed
          ? []
          : [`context ${round.contextIndex}: workload failed`]
      ),
      expectedEventCount: expectedPointerSampleCount,
      dispatchedEventCount: pointerSamples.length,
      scheduledSpanMs: null,
      actualOpenLoopSpanMs: null,
      maxScheduleLatenessMs: null,
      maxBacklogAtCallback: null,
    },
    metrics,
    longTaskStatus: longTaskStatus.length === 1 ? longTaskStatus[0] : 'mixed-or-missing',
  });
  const allContextsPassed = rounds.every((round) => round.contract?.passed === true);
  return {
    contexts: rounds.length,
    completedContexts: completed.length,
    pointerSampleCount: pointerSamples.length,
    expectedPointerSampleCount,
    ...metrics,
    longTaskStatuses: longTaskStatus,
    perContextContracts: rounds.map((round) => round.contract?.passed ?? false),
    aggregateContract,
    passed: allContextsPassed && aggregateContract.passed,
  };
}

/**
 * 当前环境的可比指纹。基线只有在同机/同浏览器大版本下才允许对比。
 */
function currentEnvironmentFingerprint(browserVersion) {
  const cpuList = cpus();
  const nodeMajor = Number.parseInt(String(process.version).replace(/^v/, '').split('.')[0], 10);
  const chromiumMajor = browserVersion
    ? Number.parseInt(String(browserVersion).split('.')[0], 10)
    : null;
  return {
    platform: platform(),
    arch: arch(),
    cpuModel: cpuList[0]?.model ?? null,
    cpuCount: cpuList.length,
    nodeMajor: Number.isFinite(nodeMajor) ? nodeMajor : null,
    chromiumMajor,
  };
}

/**
 * 读取 compact 冻结基线引用的完整候选 artifact（fail-closed）：
 * 拒绝路径逃逸 / 符号链接 / 非普通文件 / 指向 live output 或基线自身，
 * 返回字节 sha256 供与基线钉死值比对。
 */
async function readArchivedCandidate(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return { ok: false, blockers: ['baseline archivedCandidate.path is missing'] };
  }
  const absolutePath = resolve(workspace, relativePath);
  const root = resolve(workspace);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    return {
      ok: false,
      blockers: [`baseline archivedCandidate.path escapes workspace: ${relativePath}`],
    };
  }
  if (absolutePath === outputPath || absolutePath === baselinePath) {
    return {
      ok: false,
      blockers: [
        'baseline archivedCandidate.path must not point at the live output or the baseline artifact',
      ],
    };
  }
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    return { ok: false, blockers: [`archived candidate artifact missing: ${relativePath}`] };
  }
  if (stat.isSymbolicLink()) {
    return {
      ok: false,
      blockers: [`refusing to read symlinked archived candidate: ${relativePath}`],
    };
  }
  if (!stat.isFile()) {
    return {
      ok: false,
      blockers: [`archived candidate path is not a regular file: ${relativePath}`],
    };
  }
  let bytes;
  try {
    bytes = await fs.readFile(absolutePath);
  } catch (error) {
    return {
      ok: false,
      blockers: [
        `archived candidate artifact unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
  let artifact;
  try {
    artifact = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return {
      ok: false,
      blockers: [
        `archived candidate artifact is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
  return {
    ok: true,
    artifact,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    relativePath,
  };
}

/**
 * 读取并校验显式冻结基线 artifact（fail-closed）。
 *
 * 与旧版的关键差异：compact JSON 不再自带可信 metrics / correctness。它必须引用一个
 * 被 sha256 钉死的完整候选 artifact；比较用的 metrics 只从该完整 artifact 的聚合
 * summary 派生。缺失 / 不可读 / hash 不匹配 / 完整 artifact 未通过 10 个 round 与
 * 绝对阈值 / 同机环境指纹或 harness 身份漂移 / 产品树资格未显式声明时，一律
 * unavailable，绝不就地建立或放行基线。
 */
async function validateFrozenBaseline({
  currentFingerprint,
  currentSourceIdentity,
  currentSourceTreeSha256,
}) {
  if (!existsSync(baselinePath)) {
    return {
      available: false,
      artifactPath: relative(workspace, baselinePath),
      blockers: [`frozen baseline artifact missing: ${relative(workspace, baselinePath)}`],
    };
  }
  let baseline;
  try {
    baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  } catch (error) {
    return {
      available: false,
      artifactPath: relative(workspace, baselinePath),
      blockers: [
        `frozen baseline artifact unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const blockers = [];
  const reference = baseline?.archivedCandidate;
  let archivedArtifact = null;
  let archivedSha256 = null;
  if (reference === null || typeof reference !== 'object') {
    blockers.push('baseline archivedCandidate reference is missing');
  } else {
    const read = await readArchivedCandidate(reference.path);
    if (!read.ok) {
      blockers.push(...read.blockers);
    } else {
      if (typeof reference.sha256 !== 'string' || reference.sha256.length === 0) {
        blockers.push('baseline archivedCandidate.sha256 is missing');
      } else if (reference.sha256 !== read.sha256) {
        blockers.push(
          'archived candidate sha256 does not match the sha256 pinned by the frozen baseline'
        );
      }
      archivedArtifact = read.artifact;
      archivedSha256 = read.sha256;
    }
  }

  const contractResult = validateFrozenBaselineContract({
    baseline,
    archivedArtifact,
    contracts: performanceContracts,
    currentFingerprint,
    currentSourceIdentity,
    currentSourceTreeSha256,
    deviceScaleFactors,
    contextsPerScale,
  });
  const allBlockers = [...new Set([...blockers, ...contractResult.blockers])];
  return {
    available: allBlockers.length === 0,
    artifactPath: relative(workspace, baselinePath),
    archivedCandidatePath: reference && typeof reference.path === 'string' ? reference.path : null,
    archivedCandidateSha256: archivedSha256,
    baselineGeneratedAt: contractResult.baselineGeneratedAt,
    metrics: contractResult.metrics,
    evaluation: contractResult.evaluation,
    blockers: allBlockers,
  };
}

/**
 * 覆写候选报告前，先把上一份完整 artifact 复制到 history 目录。
 * 复制失败时调用方必须 fail-closed（不覆写、NO-GO）。
 */
async function preservePriorArtifact(generatedAt) {
  if (!existsSync(outputPath)) {
    return { required: false, preserved: false, path: null, failure: null };
  }
  try {
    await fs.mkdir(historyDir, { recursive: true });
    const stamp = generatedAt.replace(/[:.]/g, '-');
    const target = resolve(historyDir, `${stamp}.json`);
    await fs.copyFile(outputPath, target);
    return { required: true, preserved: true, path: relative(workspace, target), failure: null };
  } catch (error) {
    return {
      required: true,
      preserved: false,
      path: null,
      failure: serializedError(error),
    };
  }
}

async function main() {
  const generatedAt = new Date().toISOString();
  const buildCommand =
    'pnpm run prepare:playground-artifacts && pnpm --filter @hamster-note/painting-playground build';
  const metadataBeforeBuild = {
    commit: tryCommand('git', ['rev-parse', 'HEAD']),
    dirty: tryCommand('git', ['status', '--porcelain=v1'], '').length > 0,
    gitStatus: tryCommand('git', ['status', '--porcelain=v1'], ''),
    gitPatchSha256: sha256(tryCommand('git', ['diff', '--binary', 'HEAD'], 'unavailable')),
    // git diff 不包含 untracked；未跟踪 source 文件的身份由 environment.sourceIdentity 单独覆盖。
    untrackedSourceIdentity: 'environment.sourceIdentity（sha256，范围见其 coverage）',
  };
  let priorMeasurement = null;
  let historicalNoGoArtifact = null;
  if (existsSync(outputPath)) {
    try {
      const prior = JSON.parse(await fs.readFile(outputPath, 'utf8'));
      // Preserve the original failed artifact, including raw observations, exactly once. A later
      // open-loop report must not overwrite or promote the self-paced clock-association failure.
      historicalNoGoArtifact = prior.historicalNoGoArtifact ?? prior;
      const originalClockAssociationLineage =
        historicalNoGoArtifact.runLineage?.classification ===
        'prior invalid measurement / clock association failure'
          ? historicalNoGoArtifact.runLineage
          : null;
      priorMeasurement = {
        artifact: relative(workspace, outputPath),
        generatedAt:
          originalClockAssociationLineage?.generatedAt ??
          historicalNoGoArtifact.generatedAt ??
          null,
        commit:
          originalClockAssociationLineage?.commit ??
          historicalNoGoArtifact.environment?.git?.commit ??
          null,
        status: originalClockAssociationLineage?.status ?? 'NO-GO',
        classification: 'prior invalid measurement / clock association failure',
        evidence: {
          eventToNextFrameNegativeCountsByDeviceScaleFactor:
            originalClockAssociationLineage?.evidence
              ?.eventToNextFrameNegativeCountsByDeviceScaleFactor ??
            Object.fromEntries(
              Object.entries(historicalNoGoArtifact.results ?? {}).map(([scale, result]) => [
                scale,
                result?.summary?.eventToNextFrame?.negativeCount ?? null,
              ])
            ),
          retainedRawArtifact: true,
        },
      };
    } catch {
      priorMeasurement = {
        artifact: relative(workspace, outputPath),
        classification: 'prior artifact unreadable; retained in worktree before overwrite',
      };
    }
  }

  // 使用 execFile 形式精确按合同顺序运行，不会接入 Metro 或既有 dev server。
  execFileSync('pnpm', ['run', 'prepare:playground-artifacts'], {
    cwd: workspace,
    stdio: 'inherit',
  });
  execFileSync('pnpm', ['--filter', '@hamster-note/painting-playground', 'build'], {
    cwd: workspace,
    stdio: 'inherit',
  });

  let sourceIdentity = null;
  let sourceIdentityFailure = null;
  try {
    sourceIdentity = await createSourceIdentityManifest({ workspace });
  } catch (error) {
    // 无法获取源码身份哈希是硬性 fail-closed：绝不 PASS。
    sourceIdentityFailure = serializedError(error);
  }
  const [sourceTreeSha256, productionExportSha256] = await Promise.all([
    treeHash([
      resolve(workspace, 'apps/playground'),
      resolve(workspace, 'packages/painting'),
      resolve(workspace, 'packages/painting-board'),
      resolve(workspace, 'package.json'),
      resolve(workspace, 'pnpm-lock.yaml'),
    ]),
    treeHash([distPath]),
  ]);
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.listening.port}`;
  let browser;
  let browserVersion = null;
  let runnerFailure = sourceIdentityFailure
    ? { stage: 'source-identity', ...sourceIdentityFailure }
    : null;
  const allRounds = [];
  try {
    if (!runnerFailure) {
      try {
        browser = await chromium.launch({ headless: true, args: browserArgs });
        browserVersion = browser.version();
      } catch (error) {
        // A browser that cannot start is a runner prerequisite failure, never a missing report.
        runnerFailure = { stage: 'chromium-launch', ...serializedError(error) };
      }
    }
    if (browser) {
      for (const deviceScaleFactor of deviceScaleFactors) {
        for (let index = 0; index < contextsPerScale; index += 1) {
          allRounds.push(await collectRound(browser, baseUrl, deviceScaleFactor, index));
        }
      }
    }
    const byScale = Object.fromEntries(
      deviceScaleFactors.map((deviceScaleFactor) => {
        const rounds = allRounds.filter((round) => round.deviceScaleFactor === deviceScaleFactor);
        return [String(deviceScaleFactor), { rounds, summary: aggregateScale(rounds) }];
      })
    );
    const workloadChecksums = [
      ...new Set(
        allRounds
          .map((round) => round.readinessSnapshot?.workload?.checksum)
          .filter((checksum) => typeof checksum === 'string')
      ),
    ];
    // 候选合同结果（不含基线）与冻结基线门禁分离，允许“候选 PASS 但顶层 NO-GO”。
    const candidatePassed =
      runnerFailure === null &&
      allRounds.length === deviceScaleFactors.length * contextsPerScale &&
      allRounds.every((round) => round.contract?.passed === true);
    // 覆写候选报告前先保全上一份完整 artifact；保全失败即视为不可安全覆写。
    const history = await preservePriorArtifact(generatedAt);
    const historyFailure = history.required && !history.preserved;
    if (historyFailure) {
      runnerFailure = { stage: 'history-preservation', ...history.failure };
    }
    const currentFingerprint = currentEnvironmentFingerprint(browserVersion);
    const frozenBaseline = await validateFrozenBaseline({
      currentFingerprint,
      currentSourceIdentity: sourceIdentity,
      currentSourceTreeSha256: sourceTreeSha256,
    });
    const baselineComparison = candidatePassed
      ? compareCandidateToBaseline({
          candidateByScale: byScale,
          baseline: frozenBaseline,
          degradationRatio: baselineDegradationRatio,
          deviceScaleFactors,
        })
      : {
          available: false,
          withinBudget: false,
          thresholdRatio: baselineDegradationRatio,
          blockers: [
            'candidate contracts did not pass; frozen baseline comparison is not available',
          ],
          degradations: [],
          scales: {},
        };
    const passed =
      candidatePassed &&
      historyFailure === false &&
      baselineComparison.available === true &&
      baselineComparison.withinBudget === true;
    const baselineBlockers = [
      ...new Set([
        ...(frozenBaseline.blockers ?? []),
        ...(baselineComparison.blockers ?? []),
        ...(historyFailure
          ? ['prior artifact could not be preserved; refusing to overwrite history']
          : []),
      ]),
    ];
    const result = {
      // schemaVersion 2 在不移除任何既有键的前提下，新增 environment.sourceIdentity、严格 canonical
      // correctness oracle 与「冻结基线 <=20%」顶层门禁（schemaVersion 1 的 correctness==prereq&&rebase
      // 与 establish-and-PASS 初始运行语义均已废弃）。冻结基线本身采用 v2「引用 + 复核」模型：
      // compact JSON 必须引用被 sha256 钉死的完整候选 artifact，runner 从该完整 artifact 派生比较
      // metrics，因此手工填 correctness/metrics 的紧凑 JSON 不再能伪造基线。
      schemaVersion: 2,
      spike: 'phase-10-editor-production-performance',
      generatedAt,
      verificationOwner: 'parent orchestrator',
      status: {
        passed,
        verdict: passed ? 'PASS' : 'NO-GO',
        gate: '顶层 PASS 必须同时满足：候选 10 个 context 全部通过合同 + 存在有效冻结基线（v2 引用清单指向被 sha256 钉死的完整候选 artifact，其 10 个 round 的 workload/rebase/correctness/contract 与聚合绝对阈值全部通过，且同机环境指纹、契约、harness 源码身份、产品树资格一致）+ 候选相对基线所有 metric 退化<=20%。没有可信冻结基线时绝不 establish-and-PASS，只能是候选状态 + NO-GO。',
        candidate: {
          status: candidatePassed ? 'CANDIDATE-PASS' : 'CANDIDATE-NO-GO',
          passed: candidatePassed,
          scope: '10 个 context（2 dSF × 5）合同结果，独立于冻结基线比较',
        },
        baseline: {
          artifactPath: relative(workspace, baselinePath),
          requiredSchemaVersion: BASELINE_SCHEMA_VERSION,
          archivedCandidatePath: frozenBaseline.archivedCandidatePath ?? null,
          archivedCandidateSha256: frozenBaseline.archivedCandidateSha256 ?? null,
          established: frozenBaseline.available === true,
          comparisonAvailable: baselineComparison.available === true,
          withinBudget: baselineComparison.withinBudget === true,
          degradationThresholdRatio: baselineDegradationRatio,
          baselineGeneratedAt: frozenBaseline.baselineGeneratedAt ?? null,
          comparison: baselineComparison,
          blockers: baselineBlockers,
          result: passed
            ? `PASS：候选相对冻结基线所有 metric 退化<=${baselineDegradationRatio * 100}%。`
            : baselineComparison.available
              ? `NO-GO：候选相对冻结基线退化超过 ${baselineDegradationRatio * 100}%（或存在不可比较 metric）。`
              : 'NO-GO：冻结基线缺失/无效（或候选合同未通过），本次不建立也不替换基线；<=20% 退化比较不可用。',
        },
      },
      baselineGate: {
        baselineArtifactPath: relative(workspace, baselinePath),
        historyDirectory: relative(workspace, historyDir),
        historyPreservation: history,
        evaluation: {
          candidateFingerprint: currentFingerprint,
          ...(frozenBaseline.evaluation ?? {}),
        },
        note: `冻结基线 v${BASELINE_SCHEMA_VERSION} 必须是人工在独立显式路径创建的「引用清单」：指向一个被 sha256 钉死的完整候选 artifact，runner 只读取并复核（10 个 round 的 workload/rebase/correctness/contract、聚合绝对阈值、同机环境指纹、契约与 harness 源码身份），绝不自动写入或覆写。产品源码树必须显式声明 comparisonEligibility.productTree（"${PRODUCT_TREE_ELIGIBILITY.SAME_CODE}" 或 "${PRODUCT_TREE_ELIGIBILITY.ALLOW_DRIFT}"）；缺省即 fail-closed，不会静默地只比较未跟踪聚合。任一不匹配即 comparisonAvailable=false（fail-closed NO-GO）。`,
      },
      command: buildCommand,
      method: {
        route: '/?perf=1',
        contextsPerDeviceScaleFactor: contextsPerScale,
        deviceScaleFactors,
        viewport,
        input,
        pointerEntry:
          'window.__hamsterEditorPerf.runHighRatePenInput -> production host.dispatchEvent(PointerEvent)',
        resetBeforeEachInput: true,
        rebaseProbe:
          'runRebaseProbe 要求正/负约 1e9 边界点在 scale 0.25/1/8 下命中精确数字 key（positive 55264/1/1，negative 98879/3/3，每点回传 performance-stroke-<key> id）。runner 独立校验 frameOrigin==边界 global 点（origin==global）、hit.point==(0,0)、tool=pen、记录顺序/version、visible/renderable>=1、unresolved=0，不信任页面自洽声明。',
        percentile:
          'sorted valid finite samples at floor(p * (n - 1)); invalid raw samples are retained but excluded from percentiles',
        eventAssociation:
          'Before dispatch one, the page registers all 1200 absolute 120 Hz deadlines. Each callback records scheduledAt, callbackAt, backlogAtCallback, unique eventId, monotonic sequence, emittedAt, pointer, and phase. Adapter receipt must match pending eventId, pointerId, phase, and sequence. nextFrameAt must be >= receivedAt >= emittedAt.',
        measurementWindow:
          'Starts immediately before formal dispatch one and ends only after event 1200 receipt, React commit, and associated next rAF settle or the bounded settlement deadline expires. rAF and longtask observers stop before the single raw result transfer.',
        correctnessOracle:
          'runHighRatePenInput resolve 且测量窗口停止后，runner 单独调用一次 getSnapshot 采集 post-run document。基线/runId/times/ruler/revision/history/penInput geometry 一律取 run-start 冻结的 inputRun.correctnessContext，禁止用 post-run 当前值代替；post-run runId 必须匹配、capturedAt 必须在 settlement 之后、frame.revision 必须等于 document.revision。独立纯 Node oracle 用严格 canonical（仅白名单 own keys、拒绝未知键、pressure 可选语义）重算全字段 SHA-256 前缀 digest，并严格校验 post-run strokeCount=100001、revision+1、clean context undo/redo=0、undo+1、redo=0、prefixDigest 前后一致且等于 Node 重算、prefixCoordinateSignal（100k FNV）单独比较、whole-document checksum（100001）独立重算后单独比较、lastStroke(tool/id/style/所有 points 含 down/move=0.5、up=0 的 pressure 与 x/y 去重语义)、强制 frame schema（含 revision）、强制 controller session schema。任一所需要字段缺失或 points 无法独立推导时 correctness.passed=false，绝不回退 prerequisites && rebase。',
        sourceIdentity:
          '必需身份文件共 9 个：runner/oracle/oracle.test/static-server/helper/helper.test/package.json/pnpm-workspace.yaml/pnpm-lock.yaml；任一缺失/不可读/为符号链接即 NO-GO（fail-closed）。声明根（apps/playground、packages/painting、packages/painting-board、scripts/perf）内全部未跟踪且未 ignore 的普通文件（含 .sh/.wasm/.ttf/.otf 等资产，不再使用扩展名白名单）参与哈希，仅显式排除生成物。manifest schemaVersion=3。',
        frozenBaseline:
          'editor-production-baseline-gate.mjs 负责纯 Node 复核：compact 基线 v2 必须引用被 sha256 钉死的完整候选 artifact；该 artifact 必须恰好 2×5 个 round 且每个 round 的 workload/rebase/correctness/contract 与聚合绝对阈值全部通过；同机指纹、契约、harness 源码身份（requiredFiles 摘要）三方一致；产品树按显式 comparisonEligibility.productTree（same-code/allow-drift）处理。任何缺失或不一致一律 fail-closed NO-GO，runner 绝不自动建立或覆写基线。',
      },
      correctnessPendingPageFields: aggregateCorrectnessPendingFields(
        allRounds,
        requiredCorrectnessFields()
      ),
      contracts: performanceContracts,
      environment: {
        os: {
          platform: platform(),
          release: release(),
          arch: arch(),
          totalMemoryBytes: totalmem(),
        },
        cpu: cpus(),
        node: process.version,
        chromium: browserVersion,
        browserArgs,
        git: metadataBeforeBuild,
        sourceTreeSha256,
        sourceIdentity,
        // 同机可比指纹：冻结基线必须与该 fingerprint 逐字段精确相等。
        fingerprint: currentFingerprint,
        productionExport: { path: 'apps/playground/dist', sha256: productionExportSha256 },
        staticServer: {
          implementation: 'scripts/perf/static-spa-server.mjs',
          root: 'apps/playground/dist',
          baseUrl,
          mimeTypes: server.listening.mimeTypes,
          fallback: '仅无扩展名路由返回 index.html；实际带扩展名资源缺失时返回 404。',
        },
      },
      workload: {
        expectedVersion: 1,
        seed: 0x5eed_cafe,
        expectedStrokeCount: 100_000,
        checksums: workloadChecksums,
      },
      runLineage: priorMeasurement,
      ...(historicalNoGoArtifact ? { historicalNoGoArtifact } : {}),
      ...(runnerFailure ? { runnerFailure } : {}),
      results: byScale,
      limitations: [
        'Chromium rAF 间隔是 Web 主线程回调节奏，不是 GPU 帧时间、像素绘制成本或真实硬件帧率。',
        'runHighRatePenInput 合成 PointerEvent 并走正式 host adapter；它不等同于笔、触控或鼠标硬件输入。',
        '结果仅覆盖 Web Chromium production export，不覆盖 iOS、Android、native Skia 或任何跨平台 SLA。',
        'longtask 依赖浏览器 PerformanceObserver 支持；不支持或缺失时合同明确不通过，而非静默略过。',
        '阈值是本冻结 Web-only 合同记录，不能外推为 GPU、真实硬件或 native 性能 SLA。',
        'correctness 由独立 runner-side oracle 判定：run-start 冻结 context（runId/times/clean revision/history/ruler/penInput）为基线，post-run 需提供 runId/capturedAt/prefixDigest/prefixCoordinateSignal/checksum/undoDepth/redoDepth/lastStroke/frame.revision/session；缺失或不可独立推导时严格 fail closed（NO-GO），绝不回退 prerequisites && rebase。',
        'correctness.pendingPageFields（以及顶层 correctnessPendingPageFields）是各 round oracle 实际缺失字段的并集：全部 PASS 时为 []。任一 round 缺少 correctness 结果时保守回退为「实际并集 + 全部必需字段」，绝不把未校验误报成无待接字段。',
        '前缀证明使用严格 canonical（仅白名单 own keys、拒绝未知键）全字段 SHA-256 prefixDigest；前两点 FNV 仅 prefixCoordinateSignal（proof=false），post-run 的 100001 全文档 checksum 单独独立重算，绝不与 100k 前缀信号混用。',
        'rebase probe 使用精确数字 key/id 与两个独立不变量（frameOrigin==边界 global 点、hit.point==(0,0)），只接受页面 future Surface 回传的 required id。',
        '顶层 PASS 由「候选合同 + 冻结基线 <=20% 退化」共同门禁；无冻结基线时只输出候选状态（CANDIDATE-PASS/NO-GO），绝不 establish-and-PASS。冻结基线 v2 必须是人工在独立显式路径创建的「引用清单」，指向被 sha256 钉死的完整候选 artifact；runner 只读不写，且从该完整 artifact 派生比较 metrics。',
        '冻结基线复核不信任 compact JSON 自带的 correctness/metrics：它要求被引用的完整候选 artifact 恰好包含 2×5 个 round，每个 round 的 workload/rebase/correctness/contract 全部通过，且聚合绝对阈值（event-to-next-frame/commit/rAF/long-task）逐项独立重算通过；环境指纹（platform/arch/cpuModel/cpuCount/nodeMajor/chromiumMajor）必须与当前同机精确相等；harness 源码身份（requiredFiles 摘要）必须 baseline==archive==current 三方一致。',
        '产品源码采用独立资格声明：冻结基线必须显式给出 comparisonEligibility.productTree（same-code 或 allow-drift），并记录 baseline/archive/current 的完整 sourceTreeSha256；缺省即 fail-closed，绝不静默地只比较未跟踪聚合。',
        'lastStroke.points 的独立公式含 pressure（down/move=0.5、up=0）与按 x/y 去重保留先前点语义；仍假设 run 期间 host 尺寸/viewport 稳定且尺子为 INITIAL_RULER_STATE。完整待接字段与限制见 round.correctness。',
        'environment.sourceIdentity（schemaVersion 3）覆盖 9 个必需身份文件（runner/oracle/oracle.test/static-server/helper/helper.test/package.json/pnpm-workspace.yaml/pnpm-lock.yaml）与声明根（apps/playground、packages/painting、packages/painting-board、scripts/perf）内全部未跟踪且未 ignore 的普通文件（含 .sh/.wasm/.ttf/.otf 等资产）；任一必需/未跟踪文件缺失、不可读或为符号链接即 NO-GO，不扫描 node_modules/.git/build 等显式生成物。',
      ],
    };
    if (historyFailure) {
      process.stderr.write(
        `editor production performance runner: refusing to overwrite ${relative(workspace, outputPath)} because the prior artifact could not be preserved to ${relative(workspace, historyDir)}\n`
      );
      process.exitCode = 1;
      return;
    }
    await fs.mkdir(dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(
      `Wrote ${relative(workspace, outputPath)}: ${result.status.passed ? 'PASS' : 'NO-GO'}\n`
    );
    process.exitCode = result.status.passed ? 0 : 1;
  } finally {
    await browser?.close();
    server.process.kill('SIGTERM');
  }
}

main().catch(async (error) => {
  const failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`editor production performance runner failed: ${failure}\n`);
  process.exitCode = 1;
});
