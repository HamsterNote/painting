import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const directory = process.argv[2] ?? 'artifacts/research/lasso/membership-paired-v3';
const { builds } = JSON.parse(await readFile(`${directory}/environment.json`, 'utf8'));
const output = [];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const executable = (value) =>
  value.replace(/(?:\r?\n\/\/# (?:sourceMappingURL|debugId)=[^\r\n]*)+\r?\n?$/, '').trimEnd();
for (const build of builds) {
  const path = 'packages/painting/src/core/layeredEditorController.ts';
  const expected = execFileSync('git', ['show', `${build.sha}:${path}`], { encoding: 'utf8' });
  const contents = [];
  const mapRoot = `artifacts/research/lasso/membership-${build.name === 'baseline' ? 'before' : 'after'}-map-export/_expo/static/js/web`;
  const mapFiles = (await readdir(mapRoot)).filter((file) => file.endsWith('.map'));
  const supplementary = `${directory}/supplementary-maps/${build.name}`;
  await mkdir(supplementary, { recursive: true });
  const correspondence = [];
  for (const measured of Object.keys(build.bundleHashes).filter((file) => file.endsWith('.js'))) {
    const actual = await readFile(`${directory}/bundles/${build.name}/${measured}`, 'utf8');
    let matched = false;
    for (const file of mapFiles) {
      const generated = await readFile(`${mapRoot}/${file.slice(0, -4)}`, 'utf8');
      if (executable(actual) !== executable(generated)) continue;
      matched = true;
      const mapBytes = await readFile(`${mapRoot}/${file}`);
      const map = JSON.parse(mapBytes);
      map.sources.forEach((source, i) => {
        if (source.endsWith('/core/layeredEditorController.ts'))
          contents.push(map.sourcesContent[i]);
      });
      await copyFile(`${mapRoot}/${file}`, `${supplementary}/${file}`);
      await copyFile(`${mapRoot}/${file.slice(0, -4)}`, `${supplementary}/${file.slice(0, -4)}`);
      correspondence.push({
        measuredJS: measured,
        generatedJS: file.slice(0, -4),
        generatedMap: file,
        measuredSHA256: hash(actual),
        generatedSHA256: hash(generated),
        mapSHA256: hash(mapBytes),
        normalizedExecutableSHA256: hash(executable(actual)),
        executableByteEqual: true,
        normalization:
          'Remove only terminal sourceMappingURL/debugId comments and trailing whitespace; retain both original files for independent verification.',
      });
      break;
    }
    assert.ok(matched, `Rebuilt executable bytes differ from measured ${build.name}/${measured}`);
  }
  assert.ok(contents.length > 0, `Missing actual controller source in ${build.name} maps`);
  assert.ok(
    contents.every((source) => source === expected),
    `Controller source does not match ${build.sha}`
  );
  const linearMembership = expected.includes('const existing = ids.length');
  assert.equal(linearMembership, build.name === 'optimized');
  output.push({
    build: build.name,
    sha: build.sha,
    controllerSourceMatches: true,
    linearMembership,
    controllerSourceSHA256: createHash('sha256').update(expected).digest('hex'),
    supplementaryMaps: correspondence,
  });
}
await writeFile(`${directory}/source-integrity.json`, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
