#!/usr/bin/env node

/**
 * 源码身份 manifest（纯 Node helper，可单测）。
 *
 * 审查要求：
 * - 必须显式 hash runner + oracle + oracle.test + static server + 本 helper 自身
 *   + 本 helper 的单测 + workspace 配置（package.json / pnpm-workspace.yaml /
 *   pnpm-lock.yaml）；任一必需文件无法读取即抛错（由 runner 转为 NO-GO），绝不静默省略。
 * - 未跟踪 source 文件采用“声明根内全部普通文件 + 显式生成物排除”策略，不再依赖脆弱的
 *   扩展名白名单（此前漏掉 .sh/.wasm/.ttf/.otf 等二进制/脚本资产）。
 * - 路径处理保持确定性（正斜杠归一化、字典序排序）；拒绝缺失必需文件；
 *   读取失败 fail-closed；拒绝符号链接，杜绝 symlink escape 到 workspace 之外。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/** 必须存在且可读的源码身份文件（缺失/不可读 => fail-closed）。 */
export const REQUIRED_IDENTITY_FILES = Object.freeze([
  'scripts/perf/editor-production-performance.mjs',
  'scripts/perf/editor-production-performance-oracle.mjs',
  'scripts/perf/editor-production-performance-oracle.test.mjs',
  'scripts/perf/static-spa-server.mjs',
  // helper 自身与其单测也属于被测源码的一部分，必须参与身份哈希。
  'scripts/perf/source-identity.mjs',
  'scripts/perf/source-identity.test.mjs',
  // workspace 配置决定依赖与解析行为，必须参与身份哈希。
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
]);

/**
 * 声明为“源码”的根目录：这些根下所有未跟踪普通文件都会参与身份哈希，
 * 除非命中显式生成物排除规则。
 */
export const SOURCE_IDENTITY_ROOTS = Object.freeze([
  'apps/playground',
  'packages/painting',
  'packages/painting-board',
  'scripts/perf',
]);

/**
 * 显式排除的生成物路径段（任意一级目录/文件名命中即排除）。
 * 用具体生成物名称而非“扩展名白名单”，避免误删真实源码资产。
 */
export const SOURCE_IDENTITY_EXCLUDED_SEGMENTS = Object.freeze([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.expo',
  'coverage',
  'playwright-report',
  'test-results',
  '.omo',
  '.slim',
  '.turbo',
  '.next',
]);

/** 显式排除的生成物路径前缀（整棵子树）。 */
export const SOURCE_IDENTITY_EXCLUDED_PATH_PREFIXES = Object.freeze(['packages/painting/lib']);

/** 显式排除的生成物文件名后缀（如日志）。 */
export const SOURCE_IDENTITY_EXCLUDED_FILE_SUFFIXES = Object.freeze(['.log']);

/**
 * 归一化相对路径：统一正斜杠、去掉前导 `./`，保证跨平台确定性。
 * 返回 null 表示路径非法（绝对路径、含 `..` 或空段），调用方应过滤掉。
 */
export function normalizeRelativePath(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.length === 0 || normalized.startsWith('/')) {
    return null;
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '..' || segment === '.')) {
    return null;
  }
  return normalized;
}

function isExcluded(relativePath, excludedSegments, excludedPathPrefixes, excludedFileSuffixes) {
  const segments = relativePath.split('/');
  if (segments.some((segment) => excludedSegments.includes(segment))) {
    return true;
  }
  if (
    excludedPathPrefixes.some(
      (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`)
    )
  ) {
    return true;
  }
  if (excludedFileSuffixes.some((suffix) => relativePath.endsWith(suffix))) {
    return true;
  }
  return false;
}

/**
 * 只保留：位于声明根下、路径合法、非显式生成物的普通未跟踪文件。
 * 不使用扩展名白名单，因此 .sh/.wasm/.ttf/.otf 等资产同样被覆盖。
 * 返回相对路径（已归一化）并做字典序排序，保证确定性。
 */
export function selectUntrackedSourceFiles(
  entries,
  {
    roots = SOURCE_IDENTITY_ROOTS,
    excludedSegments = SOURCE_IDENTITY_EXCLUDED_SEGMENTS,
    excludedPathPrefixes = SOURCE_IDENTITY_EXCLUDED_PATH_PREFIXES,
    excludedFileSuffixes = SOURCE_IDENTITY_EXCLUDED_FILE_SUFFIXES,
  } = {}
) {
  return [...entries]
    .map((entry) => normalizeRelativePath(entry))
    .filter((relativePath) => relativePath !== null)
    .filter((relativePath) =>
      roots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))
    )
    .filter(
      (relativePath) =>
        !isExcluded(relativePath, excludedSegments, excludedPathPrefixes, excludedFileSuffixes)
    )
    .sort();
}

async function hashFile(path) {
  return createHash('sha256')
    .update(await fs.readFile(path))
    .digest('hex');
}

/**
 * 将相对路径安全解析到 workspace 内，拒绝绝对路径 / `..` 越界。
 */
function resolveWithinWorkspace(workspace, relativePath) {
  const absolutePath = resolve(workspace, relativePath);
  const root = resolve(workspace);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes workspace: ${relativePath}`);
  }
  return absolutePath;
}

/**
 * 读取并 hash 一个普通文件，fail-closed：
 * - 缺失/不可读 => 抛错
 * - 符号链接 => 抛错（防 symlink escape）
 * - 真实路径逃逸 workspace => 抛错
 * - 非普通文件 => 抛错
 */
export async function hashRegularFile({ workspace, relativePath, missingMessage }) {
  const absolutePath = resolveWithinWorkspace(workspace, relativePath);
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    throw new Error(missingMessage ?? `identity file missing: ${relativePath}`);
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`refusing to hash symlink (symlink escape guard): ${relativePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`identity path is not a regular file: ${relativePath}`);
  }
  const [realWorkspace, realFile] = await Promise.all([
    fs.realpath(resolve(workspace)),
    fs.realpath(absolutePath),
  ]);
  if (realFile !== realWorkspace && !realFile.startsWith(`${realWorkspace}${sep}`)) {
    throw new Error(`real path escapes workspace: ${relativePath}`);
  }
  return hashFile(absolutePath);
}

function git(workspace, args) {
  try {
    return execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (error) {
    throw new Error(
      `git ${args.join(' ')} failed: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * 构造源码身份 manifest。任何必需文件缺失/不可读都会抛错（fail-closed）。
 */
export async function createSourceIdentityManifest({
  workspace,
  requiredFiles = REQUIRED_IDENTITY_FILES,
  roots = SOURCE_IDENTITY_ROOTS,
  excludedSegments = SOURCE_IDENTITY_EXCLUDED_SEGMENTS,
  excludedPathPrefixes = SOURCE_IDENTITY_EXCLUDED_PATH_PREFIXES,
  excludedFileSuffixes = SOURCE_IDENTITY_EXCLUDED_FILE_SUFFIXES,
} = {}) {
  const required = [];
  for (const relativePath of requiredFiles) {
    required.push({
      path: relativePath,
      sha256: await hashRegularFile({
        workspace,
        relativePath,
        missingMessage: `required identity file missing: ${relativePath}`,
      }),
    });
  }

  const tracked = new Set(git(workspace, ['ls-files']).split('\n').filter(Boolean));
  const untrackedCandidates = git(workspace, ['ls-files', '--others', '--exclude-standard']).split(
    '\n'
  );
  const untracked = selectUntrackedSourceFiles(untrackedCandidates, {
    roots,
    excludedSegments,
    excludedPathPrefixes,
    excludedFileSuffixes,
  });

  const untrackedSourceFiles = [];
  for (const relativePath of untracked) {
    untrackedSourceFiles.push({
      path: relativePath,
      tracked: tracked.has(relativePath),
      sha256: await hashRegularFile({
        workspace,
        relativePath,
        missingMessage: `untracked source file missing: ${relativePath}`,
      }),
    });
  }

  const aggregate = createHash('sha256');
  for (const entry of required) {
    aggregate.update(`required\0${entry.path}\0${entry.sha256}\0`);
  }
  for (const entry of untrackedSourceFiles) {
    aggregate.update(`untracked\0${entry.path}\0${entry.sha256}\0`);
  }

  return {
    schemaVersion: 3,
    algorithm: 'sha256',
    requiredFiles: required,
    untrackedSourceFiles,
    untrackedSourceCount: untrackedSourceFiles.length,
    aggregateSha256: aggregate.digest('hex'),
    coverage: {
      requiredFiles,
      roots,
      excludedPathSegments: excludedSegments,
      excludedPathPrefixes,
      excludedFileSuffixes,
      source:
        'required files（runner/oracle/oracle.test/static server/helper/helper.test/package.json/pnpm-workspace.yaml/pnpm-lock.yaml）+ git ls-files --others --exclude-standard（声明根内全部未跟踪且未被 ignore 的普通文件）',
      note: '不再使用扩展名白名单，故 .sh/.wasm/.ttf/.otf 等资产同样参与哈希；仅显式排除生成物（node_modules/dist/build/coverage/playwright-report/test-results/lib/*.log 等）。required 或未跟踪文件缺失/不可读/为符号链接即抛错（fail-closed）；git diff 不含 untracked，由本 manifest 显式覆盖。',
    },
  };
}
