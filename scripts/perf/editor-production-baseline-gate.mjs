#!/usr/bin/env node

/**
 * `editor-production-performance.mjs` 的冻结基线门禁（纯 Node helper，可单测）。
 *
 * 审查 P0-6/7 的核心诉求：旧版 `editor-production-performance-baseline.json` 是一个
 * 自包含的“紧凑 JSON”，只要手工填 `correctness.passed=true` 与一组极宽松的 metrics
 * （例如 1000ms）就能让顶层 PASS——这等于可以凭空伪造基线。
 *
 * 本 helper 采用“引用 + 复核”模型，堵死该伪造路径：
 *
 * 1. 冻结基线（compact JSON）**不再自带可信 metrics / correctness**，它只允许是
 *    一份“引用清单”：指向一个被 sha256 钉死的完整候选 artifact（full runner 输出）。
 * 2. 完整候选 artifact 必须自身满足：恰好 10 个 round（2 个 deviceScaleFactor ×
 *    5 个 context），每个 round 的 workload / rebase / correctness / contract 全部
 *    通过，且**聚合绝对阈值**（event-to-next-frame / commit / rAF / long-task）逐项
 *    独立复核通过。
 * 3. 环境指纹、契约、源码身份 provenance 必须一致，且要求“同机”指纹精确相等
 *    （platform / arch / cpuModel / cpuCount / nodeMajor / chromiumMajor）。
 * 4. 产品源码树（tracked + untracked 的完整 `sourceTreeSha256`）单独处理：冻结基线
 *    必须**显式声明** `comparisonEligibility.productTree`（`same-code` 或
 *    `allow-drift`）。缺省即 fail-closed，绝不静默地只比较“未跟踪聚合”。
 *
 * 本模块不做任何 IO：调用方负责读取/解析/hash 文件并把结果传入，因此全部函数可纯测。
 * 任何输入缺失、不一致或非有限数值一律 fail-closed（available=false / blockers 非空）。
 */
import { createHash } from 'node:crypto';

/** 冻结基线 compact artifact 的 artifactKind。 */
export const BASELINE_ARTIFACT_KIND = 'editor-production-performance-frozen-baseline';

/**
 * 冻结基线 schemaVersion。v1 的自包含 metrics/correctness 语义已被废弃：
 * v2 必须引用被钉死的完整候选 artifact，否则不可信。
 */
export const BASELINE_SCHEMA_VERSION = 2;

/** 完整候选 runner artifact 的 spike 标识与 schemaVersion。 */
export const CANDIDATE_ARTIFACT_SPIKE = 'phase-10-editor-production-performance';
export const CANDIDATE_SCHEMA_VERSION = 2;

/** 产品源码树对比资格：冻结基线必须显式二选一。 */
export const PRODUCT_TREE_ELIGIBILITY = Object.freeze({
  /** 基线/候选必须完全同一份代码（sourceTreeSha256 必须逐一相等）。 */
  SAME_CODE: 'same-code',
  /** 允许被测产品源码发生漂移（仅记录双方 hash，显式声明，不做相等断言）。 */
  ALLOW_DRIFT: 'allow-drift',
});

/** “同机”环境指纹字段：全部要求精确相等。 */
export const FINGERPRINT_FIELDS = Object.freeze([
  'platform',
  'arch',
  'cpuModel',
  'cpuCount',
  'nodeMajor',
  'chromiumMajor',
]);

/**
 * baseline/候选对比的 metric 读取路径；均读取聚合 summary 上的字段。
 * 基线侧的值一律来自被钉死的完整候选 artifact，而不是 compact JSON 自带的 metrics。
 */
export const BASELINE_METRIC_PATHS = Object.freeze([
  { key: 'eventToNextFrameP95Ms', read: (summary) => summary?.eventToNextFrame?.p95Ms },
  { key: 'commitP95Ms', read: (summary) => summary?.commit?.p95Ms },
  { key: 'rafIntervalP95Ms', read: (summary) => summary?.rafInterval?.p95Ms },
  { key: 'longTaskMaxMs', read: (summary) => summary?.longTask?.maxMs },
]);

/** 对 Buffer/string/Uint8Array 计算 sha256 hex（纯函数，供测试与 runner 共用）。 */
export function computeSha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * 确定性序列化：递归按 key 字典序排序，避免对象字面量顺序影响相等判断。
 * 用于契约/指纹等结构化深比较。
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 比较两组环境指纹，返回全部不匹配项的说明（空数组表示逐字段精确相等）。
 * 采用中性措辞，调用方决定谁是 expected / actual。
 */
export function compareEnvironmentFingerprints(
  leftFingerprint,
  rightFingerprint,
  fields = FINGERPRINT_FIELDS
) {
  const mismatches = [];
  for (const field of fields) {
    const left = leftFingerprint?.[field] ?? null;
    const right = rightFingerprint?.[field] ?? null;
    if (left !== right) {
      mismatches.push(`${field}: left-${String(left)} vs right-${String(right)}`);
    }
  }
  return mismatches;
}

/**
 * 由 source identity manifest 的 requiredFiles 派生“harness 身份摘要”。
 * 只覆盖 runner/oracle/oracle.test/static-server/自身 helper/workspace 配置，
 * 因此 runner 工具链一旦变化即视为不可比（fail-closed）。
 * untracked source 与 tracked 产品代码不属于 harness，交由产品树资格单独处理。
 */
export function computeHarnessIdentityDigest(sourceIdentity) {
  const required = sourceIdentity?.requiredFiles;
  if (!Array.isArray(required) || required.length === 0) {
    return null;
  }
  const sorted = [...required]
    .map((entry) => ({ path: String(entry?.path ?? ''), sha256: String(entry?.sha256 ?? '') }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const entry of sorted) {
    hash.update(`required\0${entry.path}\0${entry.sha256}\0`);
  }
  return hash.digest('hex');
}

/**
 * 独立复核单个 round 的绝对阈值，不信任 summary/contract 的布尔结论：
 * 从 round.contract.checks 的 actualMs/thresholdMs 逐项重算比较。
 */
export function validateRoundAbsolutes(round, contracts) {
  const blockers = [];
  const checks = round?.contract?.checks;
  if (!isPlainObject(checks)) {
    return ['contract.checks is missing'];
  }
  const requirePassed = (name) => {
    if (checks?.[name]?.passed !== true) blockers.push(`checks.${name}.passed is not true`);
  };
  requirePassed('prerequisites');
  requirePassed('rebase');
  requirePassed('correctness');
  requirePassed('workload');

  const recompute = (
    name,
    threshold,
    { nullable = false, read = (check) => check.actualMs } = {}
  ) => {
    const check = checks?.[name];
    if (!isPlainObject(check)) {
      blockers.push(`checks.${name} is missing`);
      return;
    }
    const actual = read(check);
    if (actual === null && nullable) {
      if (check.passed !== true) blockers.push(`checks.${name} null actual must still pass`);
      return;
    }
    if (!Number.isFinite(actual)) {
      blockers.push(`checks.${name} actual is not finite: ${String(actual)}`);
      return;
    }
    if (!Number.isFinite(check.thresholdMs) || check.thresholdMs !== threshold) {
      blockers.push(`checks.${name}.thresholdMs is not the frozen contract threshold`);
    }
    if (actual > threshold) {
      blockers.push(`checks.${name} actual ${actual} exceeds threshold ${threshold}`);
    }
  };

  recompute('eventToNextFrameP95', contracts.eventToNextFrameP95Ms);
  recompute('commitP95', contracts.commitP95Ms);
  recompute('rafIntervalP95', contracts.rafIntervalP95Ms);
  // longTask check 使用 maxMs（而非 actualMs），且允许 null（无 long task）。
  recompute('longTask', contracts.maximumLongTaskMs, {
    nullable: true,
    read: (check) => check.maxMs,
  });
  return blockers;
}

/**
 * 独立复核聚合 summary 的绝对阈值（从 summary 的数值重新判断，而不是只看布尔）。
 * longTaskMaxMs 允许 null（合同在 round 级已覆盖 longtask）。
 */
export function validateAggregateThresholds(summary, contracts) {
  const blockers = [];
  const check = (label, value, threshold, { nullable = false } = {}) => {
    if (value === null && nullable) return;
    if (!Number.isFinite(value)) {
      blockers.push(`${label} is not finite/null: ${String(value)}`);
      return;
    }
    if (value > threshold) {
      blockers.push(`${label} ${value} exceeds absolute threshold ${threshold}`);
    }
  };
  check(
    'eventToNextFrame.p95Ms',
    summary?.eventToNextFrame?.p95Ms,
    contracts.eventToNextFrameP95Ms
  );
  check('commit.p95Ms', summary?.commit?.p95Ms, contracts.commitP95Ms);
  check('rafInterval.p95Ms', summary?.rafInterval?.p95Ms, contracts.rafIntervalP95Ms);
  check('longTask.maxMs', summary?.longTask?.maxMs, contracts.maximumLongTaskMs, {
    nullable: true,
  });
  return blockers;
}

/**
 * 校验被冻结基线引用的“完整候选 artifact”。只有 10 个 round 全部通过
 * workload/rebase/correctness/contract，且聚合绝对阈值独立复核通过，才视为有效。
 *
 * @returns {{ valid: boolean, blockers: string[], metrics: Record<string, object>, roundCount: number }}
 */
export function validateArchivedCandidateArtifact({
  artifact,
  contracts,
  deviceScaleFactors,
  contextsPerScale,
}) {
  if (!isPlainObject(artifact)) {
    return {
      valid: false,
      blockers: ['archived candidate artifact is not an object'],
      metrics: {},
      roundCount: 0,
    };
  }
  const blockers = [];
  if (artifact.spike !== CANDIDATE_ARTIFACT_SPIKE) {
    blockers.push(
      `archived candidate spike is ${String(artifact.spike)} (expected ${CANDIDATE_ARTIFACT_SPIKE})`
    );
  }
  if (artifact.schemaVersion !== CANDIDATE_SCHEMA_VERSION) {
    blockers.push(
      `archived candidate schemaVersion is ${String(artifact.schemaVersion)} (expected ${CANDIDATE_SCHEMA_VERSION})`
    );
  }
  if (!isPlainObject(contracts)) {
    blockers.push('current frozen contracts are missing');
  } else if (stableStringify(artifact.contracts) !== stableStringify(contracts)) {
    blockers.push('archived candidate contracts do not match current frozen contracts');
  }
  const results = artifact.results;
  if (!isPlainObject(results)) {
    return {
      valid: false,
      blockers: [...blockers, 'archived candidate results are missing'],
      metrics: {},
      roundCount: 0,
    };
  }

  const metrics = {};
  let roundCount = 0;
  for (const deviceScaleFactor of deviceScaleFactors) {
    const scaleKey = String(deviceScaleFactor);
    const scale = results[scaleKey];
    if (!isPlainObject(scale)) {
      blockers.push(`archived candidate results["${scaleKey}"] is missing`);
      continue;
    }
    const rounds = Array.isArray(scale.rounds) ? scale.rounds : [];
    roundCount += rounds.length;
    if (rounds.length !== contextsPerScale) {
      blockers.push(
        `archived candidate results["${scaleKey}"].rounds has ${rounds.length} entries (expected ${contextsPerScale})`
      );
    }
    rounds.forEach((round, index) => {
      const label = `results["${scaleKey}"].rounds[${index}]`;
      if (round?.deviceScaleFactor !== deviceScaleFactor) {
        blockers.push(`${label}.deviceScaleFactor does not match ${deviceScaleFactor}`);
      }
      if (round?.failure != null) {
        blockers.push(`${label}.failure is set`);
      }
      if (round?.contract?.passed !== true) {
        blockers.push(`${label}.contract.passed is not true`);
      }
      if (round?.contract?.checks?.workload?.passed !== true) {
        blockers.push(`${label} workload did not pass`);
      }
      if (round?.contract?.checks?.rebase?.passed !== true) {
        blockers.push(`${label} rebase did not pass`);
      }
      if (round?.contract?.checks?.correctness?.passed !== true) {
        blockers.push(`${label} correctness check did not pass`);
      }
      if (round?.correctness?.passed !== true) {
        blockers.push(`${label} correctness oracle did not pass`);
      }
      for (const absoluteBlocker of validateRoundAbsolutes(round, contracts)) {
        blockers.push(`${label} ${absoluteBlocker}`);
      }
    });

    const summary = scale.summary;
    if (!isPlainObject(summary)) {
      blockers.push(`archived candidate results["${scaleKey}"].summary is missing`);
      continue;
    }
    if (summary.passed !== true) blockers.push(`results["${scaleKey}"].summary.passed is not true`);
    if (summary.aggregateContract?.passed !== true) {
      blockers.push(`results["${scaleKey}"].summary.aggregateContract.passed is not true`);
    }
    if (summary.validity?.status !== 'VALID') {
      blockers.push(
        `results["${scaleKey}"].summary.validity.status is ${String(summary.validity?.status)}`
      );
    }
    if (summary.contexts !== contextsPerScale) {
      blockers.push(
        `results["${scaleKey}"].summary.contexts is ${String(summary.contexts)} (expected ${contextsPerScale})`
      );
    }
    if (summary.completedContexts !== contextsPerScale) {
      blockers.push(
        `results["${scaleKey}"].summary.completedContexts is ${String(summary.completedContexts)} (expected ${contextsPerScale})`
      );
    }
    for (const aggregateBlocker of validateAggregateThresholds(summary, contracts)) {
      blockers.push(`results["${scaleKey}"].summary ${aggregateBlocker}`);
    }
    metrics[scaleKey] = {
      eventToNextFrameP95Ms: summary.eventToNextFrame?.p95Ms ?? null,
      commitP95Ms: summary.commit?.p95Ms ?? null,
      rafIntervalP95Ms: summary.rafInterval?.p95Ms ?? null,
      longTaskMaxMs: summary.longTask?.maxMs ?? null,
    };
  }

  const expectedRoundCount = deviceScaleFactors.length * contextsPerScale;
  if (roundCount !== expectedRoundCount) {
    blockers.push(`archived candidate has ${roundCount} rounds (expected ${expectedRoundCount})`);
  }
  return { valid: blockers.length === 0, blockers, metrics, roundCount };
}

/**
 * 校验 compact 冻结基线 + 其引用的完整候选 artifact。任何失败都返回 available=false。
 *
 * 关键点：
 * - 比较用的 metrics 一律来自完整候选 artifact 的聚合 summary，compact JSON 即便
 *   写了 `metrics` / `correctness` 也完全不被采信。
 * - harness 身份（requiredFiles 摘要）要求 baseline == archive == current 三者相等。
 * - 产品源码树按显式 `comparisonEligibility.productTree` 处理，缺省 fail-closed。
 *
 * @returns {{
 *   available: boolean,
 *   blockers: string[],
 *   metrics: Record<string, object>,
 *   baselineGeneratedAt: string|null,
 *   evaluation: object,
 * }}
 */
export function validateFrozenBaseline({
  baseline,
  archivedArtifact,
  contracts,
  currentFingerprint,
  currentSourceIdentity,
  currentSourceTreeSha256,
  deviceScaleFactors,
  contextsPerScale,
}) {
  if (!isPlainObject(baseline)) {
    return {
      available: false,
      blockers: ['frozen baseline is not an object'],
      metrics: {},
      baselineGeneratedAt: null,
      evaluation: {},
    };
  }
  const blockers = [];

  if (baseline.artifactKind !== BASELINE_ARTIFACT_KIND) {
    blockers.push(
      `baseline artifactKind is ${String(baseline.artifactKind)} (expected ${BASELINE_ARTIFACT_KIND})`
    );
  }
  if (baseline.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    blockers.push(
      `baseline schemaVersion is ${String(baseline.schemaVersion)} (expected ${BASELINE_SCHEMA_VERSION}); v1 self-contained metrics/correctness is not trusted`
    );
  }

  // 1) 复核被引用的完整候选 artifact。
  const archiveValidation = validateArchivedCandidateArtifact({
    artifact: archivedArtifact,
    contracts,
    deviceScaleFactors,
    contextsPerScale,
  });
  for (const blocker of archiveValidation.blockers) {
    blockers.push(`archived candidate: ${blocker}`);
  }

  // 2) compact 基线自报契约必须与当前冻结契约一致。
  if (stableStringify(baseline.contracts) !== stableStringify(contracts)) {
    blockers.push('baseline contracts do not match current frozen contracts');
  }

  // 3) 同机环境指纹：baseline == archive == current。
  const baselineFingerprint = baseline.environment?.fingerprint;
  const archiveFingerprint =
    archivedArtifact?.environment?.fingerprint ??
    archivedArtifact?.baselineGate?.evaluation?.candidateFingerprint ??
    null;
  for (const mismatch of compareEnvironmentFingerprints(baselineFingerprint, currentFingerprint)) {
    blockers.push(`baseline environment drift: ${mismatch}`);
  }
  for (const mismatch of compareEnvironmentFingerprints(archiveFingerprint, currentFingerprint)) {
    blockers.push(`archived candidate environment drift: ${mismatch}`);
  }
  if (isPlainObject(baselineFingerprint) && isPlainObject(archiveFingerprint)) {
    for (const mismatch of compareEnvironmentFingerprints(
      baselineFingerprint,
      archiveFingerprint
    )) {
      blockers.push(`baseline/archived fingerprint mismatch: ${mismatch}`);
    }
  }

  // 4) 源码身份 provenance。
  const baselineHarness = baseline.sourceIdentity?.harnessSha256 ?? null;
  const baselineTree = baseline.sourceIdentity?.sourceTreeSha256 ?? null;
  const currentHarness = computeHarnessIdentityDigest(currentSourceIdentity);
  const archiveHarness = computeHarnessIdentityDigest(
    archivedArtifact?.environment?.sourceIdentity
  );
  const archiveTree = archivedArtifact?.environment?.sourceTreeSha256 ?? null;

  if (typeof baselineHarness !== 'string' || baselineHarness.length === 0) {
    blockers.push('baseline sourceIdentity.harnessSha256 is missing');
  }
  if (typeof baselineTree !== 'string' || baselineTree.length === 0) {
    blockers.push('baseline sourceIdentity.sourceTreeSha256 is missing');
  }
  if (archiveHarness === null) {
    blockers.push('archived candidate source identity harness digest is unavailable');
  } else if (typeof baselineHarness === 'string' && baselineHarness !== archiveHarness) {
    blockers.push('baseline harness identity differs from archived candidate harness identity');
  }
  if (currentHarness === null) {
    blockers.push('current source identity is unavailable; cannot validate baseline harness');
  } else if (typeof baselineHarness === 'string' && baselineHarness !== currentHarness) {
    blockers.push('baseline harness identity differs from current harness identity');
  }
  if (typeof archiveTree !== 'string' || archiveTree.length === 0) {
    blockers.push('archived candidate sourceTreeSha256 is missing');
  }

  // 5) 产品源码树资格：必须显式声明，绝不默认放行，也绝不静默只比较未跟踪聚合。
  const productTreeEligibility = baseline.comparisonEligibility?.productTree ?? null;
  if (productTreeEligibility === PRODUCT_TREE_ELIGIBILITY.SAME_CODE) {
    if (
      typeof baselineTree === 'string' &&
      typeof archiveTree === 'string' &&
      baselineTree !== archiveTree
    ) {
      blockers.push(
        'baseline product source tree differs from archived candidate product source tree'
      );
    }
    if (typeof currentSourceTreeSha256 !== 'string' || currentSourceTreeSha256.length === 0) {
      blockers.push('current product source tree hash is unavailable; cannot assert same-code');
    } else if (typeof baselineTree === 'string' && baselineTree !== currentSourceTreeSha256) {
      blockers.push('baseline product source tree differs from current product source tree');
    }
  } else if (productTreeEligibility === PRODUCT_TREE_ELIGIBILITY.ALLOW_DRIFT) {
    // 显式允许漂移：仍要求已记录双方 hash（上面已校验），但不做相等断言。
  } else {
    blockers.push(
      `baseline comparisonEligibility.productTree must be explicitly "${PRODUCT_TREE_ELIGIBILITY.SAME_CODE}" or "${PRODUCT_TREE_ELIGIBILITY.ALLOW_DRIFT}"; got ${String(productTreeEligibility)}`
    );
  }

  return {
    available: blockers.length === 0,
    blockers,
    metrics: archiveValidation.metrics,
    baselineGeneratedAt: typeof baseline.frozenAt === 'string' ? baseline.frozenAt : null,
    evaluation: {
      archivedRoundCount: archiveValidation.roundCount,
      productTreeEligibility,
      baselineHarnessSha256: baselineHarness,
      currentHarnessSha256: currentHarness,
      baselineSourceTreeSha256: baselineTree,
      archivedSourceTreeSha256: archiveTree,
      currentSourceTreeSha256: currentSourceTreeSha256 ?? null,
    },
  };
}

/**
 * 候选 vs 冻结基线：逐 scale、逐 metric 要求退化不超过给定比例。
 * 任一 metric 无法比较（候选或基线缺失/非有限）即视为不可比较，fail-closed。
 * baseline.metrics 必须来自被钉死的完整候选 artifact 的聚合 summary。
 */
export function compareCandidateToBaseline({
  candidateByScale,
  baseline,
  degradationRatio,
  deviceScaleFactors,
  metricPaths = BASELINE_METRIC_PATHS,
}) {
  if (!baseline?.available) {
    return {
      available: false,
      withinBudget: false,
      thresholdRatio: degradationRatio,
      blockers: baseline?.blockers ?? ['frozen baseline is unavailable'],
      degradations: [],
      scales: {},
    };
  }
  const blockers = [];
  const degradations = [];
  const scales = {};
  for (const deviceScaleFactor of deviceScaleFactors) {
    const scaleKey = String(deviceScaleFactor);
    const candidateMetrics = candidateByScale?.[scaleKey]?.summary;
    const baselineMetrics = baseline.metrics?.[scaleKey];
    const perScale = {};
    for (const { key, read } of metricPaths) {
      const baselineValue = baselineMetrics?.[key];
      const candidateValue = read(candidateMetrics ?? {});
      if (!Number.isFinite(baselineValue) || !Number.isFinite(candidateValue)) {
        // longTaskMaxMs 允许 null；null/null 视为不可比较但不额外阻断（合同自身已覆盖 longtask）。
        if (key === 'longTaskMaxMs' && baselineValue === null && candidateValue === null) {
          perScale[key] = { baseline: null, candidate: null, comparable: false, note: 'both-null' };
          continue;
        }
        perScale[key] = {
          baseline: Number.isFinite(baselineValue) ? baselineValue : null,
          candidate: Number.isFinite(candidateValue) ? candidateValue : null,
          comparable: false,
        };
        blockers.push(
          `metric ${key}@${scaleKey} is not comparable (baseline=${String(baselineValue)}, candidate=${String(candidateValue)})`
        );
        continue;
      }
      const ratio = baselineValue === 0 ? null : candidateValue / baselineValue;
      const within =
        baselineValue === 0
          ? candidateValue <= 0
          : candidateValue <= baselineValue * (1 + degradationRatio);
      perScale[key] = {
        baseline: baselineValue,
        candidate: candidateValue,
        ratio,
        withinBudget: within,
      };
      if (!within) {
        degradations.push({
          scale: deviceScaleFactor,
          metric: key,
          baseline: baselineValue,
          candidate: candidateValue,
          ratio,
        });
      }
    }
    scales[scaleKey] = perScale;
  }
  return {
    available: blockers.length === 0,
    withinBudget: blockers.length === 0 && degradations.length === 0,
    thresholdRatio: degradationRatio,
    blockers,
    degradations,
    scales,
  };
}
