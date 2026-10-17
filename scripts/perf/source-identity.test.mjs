#!/usr/bin/env node

/**
 * `source-identity.mjs` 的纯 Node 单测。
 *
 * 运行：node --test scripts/perf/source-identity.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_IDENTITY_FILES,
  createSourceIdentityManifest,
  selectUntrackedSourceFiles,
} from './source-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '../..');

/** 在 temp 目录里写文件，自动创建父目录。 */
async function writeFile(root, relativePath, contents) {
  const absolutePath = resolve(root, relativePath);
  await fs.mkdir(dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents);
  return absolutePath;
}

/** 创建一个全新的临时 git 仓库，测试结束后清理。 */
async function createTempRepo(t) {
  const repoRoot = await fs.mkdtemp(resolve(tmpdir(), 'hamster-source-identity-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'pipe' });
  return repoRoot;
}

test('selectUntrackedSourceFiles：覆盖 .sh/.wasm/.ttf/.otf，显式排除生成物并排序', () => {
  const entries = [
    'apps/playground/src/b.tsx',
    'apps/playground/src/a.ts',
    'apps/playground/src/tool.sh',
    'apps/playground/src/asset.wasm',
    'apps/playground/public/font.ttf',
    'apps/playground/public/font.otf',
    'apps/playground/node_modules/dep.ts',
    'apps/playground/dist/gen.js',
    'apps/playground/build/gen.ts',
    'packages/painting/lib/gen.js',
    'apps/playground/console.log',
    'scripts/perf/tool.sh',
    'packages/other/src/other.ts',
    './apps/playground/src/dot-prefixed.ts',
  ];
  assert.deepEqual(selectUntrackedSourceFiles(entries), [
    'apps/playground/public/font.otf',
    'apps/playground/public/font.ttf',
    'apps/playground/src/a.ts',
    'apps/playground/src/asset.wasm',
    'apps/playground/src/b.tsx',
    'apps/playground/src/dot-prefixed.ts',
    'apps/playground/src/tool.sh',
    'scripts/perf/tool.sh',
  ]);
});

test('REQUIRED_IDENTITY_FILES：强制包含 helper 自身、helper 单测与 workspace 配置', () => {
  for (const required of [
    'scripts/perf/source-identity.mjs',
    'scripts/perf/source-identity.test.mjs',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'package.json',
  ]) {
    assert.ok(
      REQUIRED_IDENTITY_FILES.includes(required),
      `REQUIRED_IDENTITY_FILES 缺少 ${required}`
    );
  }
});

test('createSourceIdentityManifest：包含全部必需文件且 sha256 合法', async () => {
  const manifest = await createSourceIdentityManifest({ workspace });
  for (const requiredPath of REQUIRED_IDENTITY_FILES) {
    const entry = manifest.requiredFiles.find((item) => item.path === requiredPath);
    assert.ok(entry, `required file ${requiredPath} missing from manifest`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(manifest.requiredFiles.length, REQUIRED_IDENTITY_FILES.length);
  assert.match(manifest.aggregateSha256, /^[0-9a-f]{64}$/);
  assert.equal(typeof manifest.untrackedSourceCount, 'number');
  assert.doesNotThrow(() => JSON.stringify(manifest));
});

test('createSourceIdentityManifest：必需文件缺失时抛错（fail-closed）', async () => {
  await assert.rejects(
    () =>
      createSourceIdentityManifest({
        workspace,
        requiredFiles: ['scripts/perf/does-not-exist.mjs'],
      }),
    /required identity file missing/
  );
});

test('createSourceIdentityManifest：workspace 不存在时抛错（fail-closed）', async () => {
  const missing = resolve(tmpdir(), `hamster-missing-${Date.now()}`);
  await assert.rejects(() => createSourceIdentityManifest({ workspace: missing }));
  // 确保测试没有意外创建目录
  await assert.rejects(() => fs.stat(missing));
});

test('临时 git 仓库：未跟踪 .ts/.sh/.wasm/.ttf/.otf 全覆盖，忽略/生成物被排除', async (t) => {
  const repo = await createTempRepo(t);
  await writeFile(repo, '.gitignore', 'dist/\nnode_modules/\n');
  await writeFile(repo, 'package.json', '{"name":"fixture"}\n');
  // 期望纳入身份哈希的普通未跟踪源码资产。
  await writeFile(repo, 'apps/playground/src/a.ts', 'export const a = 1;\n');
  await writeFile(repo, 'apps/playground/src/tool.sh', 'echo hi\n');
  await writeFile(repo, 'apps/playground/src/asset.wasm', '\0asm');
  await writeFile(repo, 'apps/playground/public/font.ttf', 'TTF');
  await writeFile(repo, 'apps/playground/public/font.otf', 'OTF');
  // 被 git ignore 的生成目录：不应出现。
  await writeFile(repo, 'apps/playground/dist/ignored.ts', 'export const ignored = 1;\n');
  // 未被 ignore 但属于显式生成物段：仍应被排除。
  await writeFile(repo, 'apps/playground/build/generated.ts', 'export const generated = 1;\n');
  // node_modules 即使未被 ignore 也必须排除。
  await writeFile(repo, 'apps/playground/node_modules/dep/index.ts', 'export const dep = 1;\n');

  const manifest = await createSourceIdentityManifest({
    workspace: repo,
    requiredFiles: ['package.json'],
  });
  const paths = manifest.untrackedSourceFiles.map((entry) => entry.path);
  for (const expected of [
    'apps/playground/src/a.ts',
    'apps/playground/src/tool.sh',
    'apps/playground/src/asset.wasm',
    'apps/playground/public/font.ttf',
    'apps/playground/public/font.otf',
  ]) {
    assert.ok(paths.includes(expected), `缺少未跟踪资产 ${expected}`);
  }
  assert.ok(!paths.some((path) => path.includes('dist/')), 'dist 生成物不应纳入');
  assert.ok(!paths.some((path) => path.includes('build/')), 'build 生成物不应纳入');
  assert.ok(!paths.some((path) => path.includes('node_modules/')), 'node_modules 不应纳入');
  assert.match(manifest.aggregateSha256, /^[0-9a-f]{64}$/);
});

test('临时 git 仓库：修改未跟踪文件字节会改变 aggregateSha256', async (t) => {
  const repo = await createTempRepo(t);
  await writeFile(repo, 'package.json', '{"name":"fixture"}\n');
  await writeFile(repo, 'apps/playground/src/a.ts', 'export const a = 1;\n');

  const before = await createSourceIdentityManifest({
    workspace: repo,
    requiredFiles: ['package.json'],
  });
  await writeFile(repo, 'apps/playground/src/a.ts', 'export const a = 2;\n');
  const after = await createSourceIdentityManifest({
    workspace: repo,
    requiredFiles: ['package.json'],
  });
  assert.notEqual(before.aggregateSha256, after.aggregateSha256);
});

test('临时 git 仓库：指向 workspace 外的符号链接被拒绝（防 symlink escape）', async (t) => {
  const repo = await createTempRepo(t);
  await writeFile(repo, 'package.json', '{"name":"fixture"}\n');
  const outside = await fs.mkdtemp(resolve(tmpdir(), 'hamster-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const outsideFile = await writeFile(outside, 'secret.ts', 'export const secret = 1;\n');
  await fs.mkdir(resolve(repo, 'apps/playground/src'), { recursive: true });
  try {
    await fs.symlink(outsideFile, resolve(repo, 'apps/playground/src/escape.ts'));
  } catch (error) {
    t.skip(`symlink 不可用: ${error instanceof Error ? error.message : error}`);
    return;
  }
  await assert.rejects(
    () => createSourceIdentityManifest({ workspace: repo, requiredFiles: ['package.json'] }),
    /symlink/
  );
});
