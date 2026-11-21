// docs/TEST_CASES.md 와 실제 Jest 결과(.jest-results.json)를 대조한다.
// 행 수 = 실행된 테스트 수, 모든 행이 실제 통과한 테스트 하나와 1:1, 종류 열이 파일 종류와 일치.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const resultsPath = process.argv[2] ?? '.jest-results.json';
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
const doc = readFileSync('docs/TEST_CASES.md', 'utf8');

const actual = new Map(); // "파일::제목" -> status
for (const file of results.testResults) {
  const rel = relative(process.cwd(), file.name);
  for (const t of file.assertionResults) {
    const key = `${rel}::${t.title}`;
    if (actual.has(key)) fail(`테스트 제목이 한 파일 안에서 중복: ${key}`);
    actual.set(key, t.status);
  }
}

const rows = doc
  .split('\n')
  .filter((l) => /^\| [A-Z0-9]+-\d{3} \|/.test(l))
  .map((l) => l.split(' | ').map((c) => c.replace(/^\| /, '').replace(/ \|$/, '').trim()));

const problems = [];
const ids = new Set();
const mapped = new Set();
const kindOf = (f) => (f.endsWith('.e2e-spec.ts') ? 'e2e' : f.endsWith('.int-spec.ts') ? 'integration' : 'unit');
const perKind = { unit: 0, integration: 0, e2e: 0 };

for (const cells of rows) {
  if (cells.length !== 7) {
    problems.push(`열 수가 7 이 아님: ${cells[0]}`);
    continue;
  }
  const [id, , , , , ref, kind] = cells;
  if (ids.has(id)) problems.push(`ID 중복: ${id}`);
  ids.add(id);
  const key = ref.replace(/^`|`$/g, '');
  if (!actual.has(key)) problems.push(`${id}: 실제 테스트 없음 -> ${key}`);
  else if (actual.get(key) !== 'passed') problems.push(`${id}: 통과하지 않음(${actual.get(key)}) -> ${key}`);
  if (mapped.has(key)) problems.push(`${id}: 같은 테스트가 두 행에 매핑됨 -> ${key}`);
  mapped.add(key);
  const file = key.split('::')[0];
  if (kindOf(file) !== kind) problems.push(`${id}: 종류가 ${kind} 인데 파일은 ${kindOf(file)}`);
  perKind[kindOf(file)]++;
}
for (const key of actual.keys()) if (!mapped.has(key)) problems.push(`문서에 없는 테스트: ${key}`);

if (rows.length !== actual.size) problems.push(`문서 행 ${rows.length} != 실행된 테스트 ${actual.size}`);
const total = Number(/\*\*합계\*\* \| \*\*(\d+)\*\*/.exec(doc)?.[1]);
if (total !== actual.size) problems.push(`요약 표의 합계 ${total} != 실행된 테스트 ${actual.size}`);
for (const [label, key] of [['unit', 'unit'], ['integration', 'integration'], ['e2e', 'e2e']]) {
  const m = new RegExp(`\\| ${label} [^|]*\\| (\\d+) \\|`).exec(doc);
  if (!m || Number(m[1]) !== perKind[key]) problems.push(`요약 표의 ${label} 개수 ${m?.[1]} != ${perKind[key]}`);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (problems.length) {
  console.error(`테스트 케이스 문서 대조 실패 (${problems.length}건)`);
  for (const p of problems.slice(0, 30)) console.error(' - ' + p);
  process.exit(1);
}
console.log(`테스트 케이스 문서 대조 통과: 문서 ${rows.length}행 = 실행 ${actual.size}건 (unit ${perKind.unit}, integration ${perKind.integration}, e2e ${perKind.e2e})`);
