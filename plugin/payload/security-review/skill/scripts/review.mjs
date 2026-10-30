import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const originalCatalogDigest = '98c8fe911b9edb403af8ee05d3ce8201ecac2659e313b053890a62847cdcf680';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const unique = values => new Set(values).size === values.length;
const has = (values, value) => Array.isArray(values) && values.includes(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const texts = value => Array.isArray(value) && value.every(nonempty);
const gateIds = ['0', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const canonical = value => JSON.stringify(value, (_, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const referenceCache = new Map();
const reportError = (errors, message, condition) => { if (!condition) errors.push(message); };

// CSV record parsing preserves quoted commas, newlines, escaped quotes and CRLF.
function parseCsv(text) {
  const records = []; let record = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      record.push(field); field = '';
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (record.some(Boolean)) records.push(record);
        record = [];
      }
    } else field += c;
  }
  if (quoted) throw new Error('unterminated CSV quote');
  if (field || record.length) records.push([...record, field]);
  const headers = records.shift();
  if (!headers) throw new Error('empty catalog CSV');
  return records.map(row => {
    if (row.length !== headers.length) throw new Error('CSV column mismatch');
    return Object.fromEntries(headers.map((key, i) => [key, row[i]]));
  });
}

async function fingerprint() {
  const entries = [];
  async function walk(path) {
    for (const name of (await readdir(path)).sort()) {
      const full = resolve(path, name), meta = await lstat(full);
      if (meta.isSymbolicLink()) throw new Error('skill contains a symbolic link');
      if (meta.isDirectory()) await walk(full);
      else if (meta.isFile()) entries.push([relative(skillRoot, full).split(sep).join('/'), hash(await readFile(full))]);
    }
  }
  await walk(skillRoot);
  return hash(JSON.stringify(entries));
}

async function localReference(ref, base = resolve(skillRoot, 'references')) {
  if (!nonempty(ref)) throw new Error('empty local reference');
  const [pathPart, fragment] = ref.split('#');
  const path = resolve(base, pathPart);
  if (!path.startsWith(skillRoot + sep)) throw new Error('reference escapes skill');
  const meta = await lstat(path);
  if (!meta.isFile() || meta.isSymbolicLink()) throw new Error('reference is not a regular file');
  if (!(await realpath(path)).startsWith((await realpath(skillRoot)) + sep)) throw new Error('reference resolves outside skill');
  if (!referenceCache.has(path)) referenceCache.set(path, { text: await readFile(path, 'utf8') });
  const cached = referenceCache.get(path), text = cached.text;
  if (fragment?.startsWith('/')) {
    cached.json ??= JSON.parse(text);
    let value = cached.json;
    for (const key of fragment.slice(1).split('/').map(x => x.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('missing JSON pointer');
      value = value[key];
    }
  } else if (fragment) {
    const anchors = text.split('\n').filter(x => /^#+ /.test(x)).map(x => x.replace(/^#+ /, '').toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replaceAll(' ', '-'));
    if (!anchors.includes(fragment)) throw new Error('missing Markdown anchor');
  }
  return path;
}

async function loadBundle(options = {}) {
  const catalogPath = options.catalog ?? resolve(skillRoot, 'references/catalog.json');
  const matrixPath = options.matrix ?? resolve(skillRoot, 'references/matrix.json');
  const [catalog, matrix, sources, evalIndex] = await Promise.all([
    readJson(catalogPath), readJson(matrixPath), readJson(resolve(skillRoot, 'references/sources.json')),
    readJson(resolve(skillRoot, 'references/eval-index.json')),
  ]);
  return { catalog, matrix, sources, evalIndex, identity: {
    skillFingerprint: await fingerprint(), catalogDigest: hash(await readFile(catalogPath)),
    matrixDigest: hash(await readFile(matrixPath)), sourcesDigest: hash(await readFile(resolve(skillRoot, 'references/sources.json'))),
  } };
}

async function validateBundle(bundle) {
  const errors = [], { catalog, matrix, sources, evalIndex } = bundle;
  reportError(errors, 'catalog schema/version', catalog.schema === 'bro.security-review.catalog/v1' && catalog.version === '5.0.0');
  reportError(errors, 'matrix schema', matrix.schema === 'bro.security-review.matrix/v1');
  reportError(errors, 'source registry schema', sources.schema === 'bro.security-review.sources/v1');
  reportError(errors, 'eval index schema', evalIndex.schema === 'bro.security-review.eval-index/v1');
  const csvPath = await localReference(catalog.source);
  const bytes = await readFile(csvPath);
  reportError(errors, 'original catalog hash mismatch', hash(bytes) === catalog.sourceSha256 && hash(bytes) === originalCatalogDigest);
  const methodDocuments = (await Promise.all(['wstg', 'cs'].map(name => readJson(resolve(skillRoot, 'references/sources/' + name + '.json'))))).flatMap(b => b.documents);
  const methodIds = new Set(methodDocuments.map(d => d.id));
  reportError(errors, 'duplicate method document IDs', methodIds.size === methodDocuments.length);
  const original = parseCsv(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const expected = new Map(original.map(row => ['v5.0.0-' + row.req_id.slice(1), row]));
  reportError(errors, 'original IDs duplicated', expected.size === original.length);
  for (const [label, rows] of [['catalog', catalog.requirements], ['matrix', matrix.requirements]]) {
    reportError(errors, label + ' records are not an array', Array.isArray(rows));
    if (!Array.isArray(rows)) continue;
    reportError(errors, label + ' ID set differs from original', rows.length === expected.size && unique(rows.map(r => r.id)) && rows.every(r => expected.has(r.id)));
    for (const row of rows) {
      const source = expected.get(row.id);
      if (!source) continue;
      reportError(errors, row.id + ' incorrect minimum level', row.minLevel === Number(source.L));
      if (label === 'catalog') {
        reportError(errors, row.id + ' original text or ID differs', row.text === source.req_description && row.originalId === source.req_id);
        reportError(errors, row.id + ' original chapter/section differs', row.chapter === source.chapter_id && row.section === source.section_id);
      } else {
        reportError(errors, row.id + ' missing/invalid method source IDs', Array.isArray(row.methodSourceIds) && row.methodSourceIds.length > 0 && unique(row.methodSourceIds) && row.methodSourceIds.every(id => methodIds.has(id)));
        reportError(errors, row.id + ' missing applicability/alternatives', nonempty(row.applicability) && nonempty(row.alternatives));
        reportError(errors, row.id + ' invalid coverage', ['covered', 'partial', 'gap'].includes(row.coverage?.status) && nonempty(row.coverage?.rationale));
        reportError(errors, row.id + ' missing obligations', Array.isArray(row.obligations) && row.obligations.length > 0);
        for (const o of row.obligations ?? []) {
          reportError(errors, row.id + ' obligation identifier', nonempty(o.id) && o.id.startsWith(row.id + ':'));
          reportError(errors, o.id + ' source quote not in original', nonempty(o.sourceQuote) && source.req_description.includes(o.sourceQuote));
          reportError(errors, o.id + ' invalid level bounds', Number.isInteger(o.minLevel) && o.minLevel >= row.minLevel && o.minLevel <= 3 && (o.maxLevel === undefined || (Number.isInteger(o.maxLevel) && o.maxLevel >= o.minLevel && o.maxLevel <= 3)));
          for (const field of ['condition', 'expectation', 'method', 'pass', 'fail', 'missing', 'procedureRef']) reportError(errors, o.id + ' missing ' + field, nonempty(o[field]));
          try { await localReference(o.procedureRef); } catch { errors.push(row.id + ' invalid procedure reference'); }
          const pointer = `matrix.json#/requirements/${matrix.requirements.indexOf(row)}/obligations/${row.obligations.indexOf(o)}`;
          reportError(errors, row.id + ' incorrect instruction pointer', o.instructionRef === pointer);
          try { await localReference(o.instructionRef); } catch { errors.push(row.id + ' invalid instruction reference'); }
          reportError(errors, o.id + ' no eval mapping', Array.isArray(o.evalIds) && o.evalIds.length > 0 && o.evalIds.every(id => evalIndex.cases.some(c => c.id === id && c.obligationIds.includes(o.id))));
        }
      }
    }
  }
  const allObligations = matrix.requirements.flatMap(r => r.obligations ?? []).map(o => o.id);
  reportError(errors, 'duplicate obligation IDs', unique(allObligations));
  reportError(errors, 'duplicate eval IDs', unique(evalIndex.cases.map(c => c.id)));
  for (const c of evalIndex.cases) reportError(errors, c.id + ' invalid eval obligation binding', nonempty(c.id) && Array.isArray(c.obligationIds) && c.obligationIds.length > 0 && c.obligationIds.every(id => allObligations.includes(id)));
  for (const source of sources.sources) {
    for (const field of ['id', 'version', 'revision', 'url', 'path', 'sha256', 'license', 'attribution', 'role']) reportError(errors, 'source missing ' + field, nonempty(source[field]));
    try { reportError(errors, source.id + ' source digest mismatch', hash(await readFile(await localReference(source.path))) === source.sha256); }
    catch { errors.push('invalid source reference'); }
  }
  return errors;
}

function expectedSelection(req, obligation, target) {
  if (obligation.minLevel > target.level) return 'above-target';
  return target.mode === 'full-assessment' || has(target.selectedRequirements, req.id) ? 'selected' : 'outside-scope';
}

function summarize(review) {
  const rows = review.rows;
  const count = (key, choices) => Object.fromEntries(choices.map(c => [c, rows.filter(r => r[key] === c).length]));
  const selected = rows.filter(r => r.selection === 'selected');
  const applicable = selected.filter(r => r.applicability === 'applicable');
  const pass = applicable.filter(r => r.result === 'pass').length;
  const fail = applicable.filter(r => r.result === 'fail').length;
  let conclusion;
  if (review.target.mode !== 'full-assessment' || review.target.confirmed !== true) conclusion = 'not-assessed';
  else if (fail) conclusion = 'not-satisfied';
  else if (!review.inventoryComplete || selected.some(r => r.applicability === 'unknown' || (r.applicability === 'applicable' && !['pass', 'fail'].includes(r.result)))) conclusion = 'incomplete';
  else conclusion = 'satisfied';
  return { conclusion, summary: {
    totalRows: rows.length, selection: count('selection', ['selected', 'outside-scope', 'above-target']),
    applicability: count('applicability', ['applicable', 'not-applicable', 'unknown']),
    results: count('result', ['pass', 'fail', 'unchecked', 'inconclusive']), selectedRows: selected.length,
    applicableRows: applicable.length, verifiedRows: pass + fail, passRows: pass,
    verificationFraction: { numerator: pass + fail, denominator: applicable.length },
    passFraction: { numerator: pass, denominator: applicable.length },
  } };
}

function validateTarget(target, matrix) {
  const errors = [];
  if (!target || typeof target !== 'object') return ['target missing'];
  for (const k of ['identity', 'revision', 'scope']) reportError(errors, 'target.' + k, nonempty(target[k]));
  reportError(errors, 'target mode/version/level/confirmation', ['scoped-review', 'full-assessment'].includes(target.mode) && target.version === '5.0.0' && [1, 2, 3].includes(target.level) && typeof target.confirmed === 'boolean');
  reportError(errors, 'target surfaces', Array.isArray(target.surfaces) && target.surfaces.length > 0 && target.surfaces.every(s => nonempty(s.id) && nonempty(s.description)) && unique(target.surfaces.map(s => s.id)));
  reportError(errors, 'target selection', Array.isArray(target.selectedRequirements) && unique(target.selectedRequirements) && target.selectedRequirements.every(id => matrix.requirements.some(r => r.id === id)));
  return errors;
}

function validateReview(review, bundle) {
  const errors = validateTarget(review.target, bundle.matrix);
  reportError(errors, 'review schema/id', review.schema === 'bro.security-review.record/v1' && nonempty(review.reviewId));
  for (const [k, v] of Object.entries(bundle.identity)) reportError(errors, k + ' mismatch; reassessment required', review[k] === v);
  reportError(errors, 'inventory completeness must be explicit', typeof review.inventoryComplete === 'boolean');
  for (const k of ['rows', 'evidence', 'findings', 'manualChecks', 'risks', 'supplemental', 'limitations', 'gateStatuses', 'openQuestions', 'checksReviewed', 'secretsObserved']) reportError(errors, k + ' must be an array', Array.isArray(review[k]));
  for (const k of ['reviewer', 'confidence', 'controlChanges']) reportError(errors, k + ' missing', nonempty(review[k]));
  reportError(errors, 'threat model missing', object(review.threatModel) && ['assets', 'actors', 'trustBoundaries', 'sensitiveData', 'flows', 'abuseCases'].every(k => texts(review.threatModel[k])));
  reportError(errors, 'capabilities missing', object(review.capabilities) && typeof review.capabilities.analysis === 'boolean' && typeof review.capabilities.localExecution === 'boolean' && texts(review.capabilities.constraints));
  reportError(errors, 'continuation missing', object(review.continuation) && Array.isArray(review.continuation.pending) && nonempty(review.continuation.nextAction));
  if (errors.length) return { errors };
  const evidence = new Map(review.evidence.map(e => [e.id, e]));
  reportError(errors, 'duplicate evidence IDs', evidence.size === review.evidence.length);
  for (const [eIndex, e] of review.evidence.entries()) {
    for (const k of ['id', 'kind', 'locator', 'targetRevision', 'observedAt', 'summary']) reportError(errors, 'evidence missing ' + k, nonempty(e[k]));
    reportError(errors, 'evidence ' + eIndex + ' bindings missing', Array.isArray(e.obligationIds) && Array.isArray(e.surfaceIds));
  }
  const expected = new Map();
  for (const req of bundle.matrix.requirements) for (const o of req.obligations) for (const s of review.target.surfaces) {
    expected.set(JSON.stringify([req.id, o.id, s.id]), expectedSelection(req, o, review.target));
  }
  const seen = new Set();
  for (const [rowIndex, r] of review.rows.entries()) {
    const key = JSON.stringify([r.requirementId, r.obligationId, r.surfaceId]);
    const label = ' at row ' + rowIndex;
    reportError(errors, 'unknown/duplicate assessment row' + label, expected.has(key) && !seen.has(key)); seen.add(key);
    reportError(errors, 'incorrect selection' + label, expected.get(key) === r.selection);
    reportError(errors, 'invalid applicability' + label, ['applicable', 'not-applicable', 'unknown'].includes(r.applicability));
    reportError(errors, 'invalid result' + label, ['pass', 'fail', 'unchecked', 'inconclusive'].includes(r.result));
    reportError(errors, 'missing rationale/evidence list' + label, nonempty(r.rationale) && Array.isArray(r.evidenceIds) && unique(r.evidenceIds));
    const decided = ['pass', 'fail'].includes(r.result);
    reportError(errors, 'positive/negative result without selected applicability' + label, !decided || (r.selection === 'selected' && r.applicability === 'applicable'));
    reportError(errors, 'nonselected or N/A result must be unchecked' + label, (r.selection === 'selected' && r.applicability !== 'not-applicable') || r.result === 'unchecked');
    reportError(errors, 'missing evidence for decided/N/A row' + label, !(decided || r.applicability === 'not-applicable') || (r.evidenceIds?.length ?? 0) > 0);
    for (const id of r.evidenceIds ?? []) {
      const e = evidence.get(id);
      reportError(errors, 'missing/stale/unbound evidence' + label, e && e.targetRevision === review.target.revision && has(e.obligationIds, r.obligationId) && has(e.surfaceIds, r.surfaceId));
    }
  }
  reportError(errors, 'assessment rows do not account for whole catalog and surfaces', seen.size === expected.size && [...expected.keys()].every(k => seen.has(k)));
  reportError(errors, 'gate set missing/duplicated', review.gateStatuses.length === gateIds.length && unique(review.gateStatuses.map(g => g.id)) && review.gateStatuses.every(g => gateIds.includes(g.id)));
  for (const g of review.gateStatuses) {
    reportError(errors, 'invalid gate status/rationale', ['pass', 'issues', 'not-applicable', 'not-checked'].includes(g.status) && nonempty(g.rationale) && Array.isArray(g.evidenceIds) && g.evidenceIds.every(id => evidence.has(id)));
    reportError(errors, 'gate conclusion lacks evidence', !['pass', 'issues', 'not-applicable'].includes(g.status) || g.evidenceIds.length > 0);
  }
  reportError(errors, 'duplicate finding IDs', unique(review.findings.map(f => f.id)));
  for (const f of review.findings) {
    for (const k of ['id', 'confidence', 'asset', 'location', 'attackPath', 'brokenControl', 'impact', 'recommendation', 'verification', 'owner', 'approvalGate', 'residualRisk']) reportError(errors, 'finding missing ' + k, nonempty(f[k]));
    reportError(errors, 'finding invalid severity', ['Critical', 'High', 'Medium', 'Low'].includes(f.severity));
    reportError(errors, 'finding missing/invalid references', Array.isArray(f.requirementIds) && f.requirementIds.length > 0 && f.requirementIds.every(id => bundle.matrix.requirements.some(r => r.id === id) || id.startsWith('BRO-SEC-')) && Array.isArray(f.evidenceIds) && f.evidenceIds.length > 0 && f.evidenceIds.every(id => evidence.has(id)));
  }
  for (const row of review.rows.filter(r => r.result === 'fail')) reportError(errors, 'failed row without finding', review.findings.some(f => has(f.requirementIds, row.requirementId) && f.evidenceIds?.some(id => has(row.evidenceIds, id))));
  for (const f of review.findings) {
    const selectedIds = (f.requirementIds ?? []).filter(id => review.rows.some(r => r.requirementId === id && r.selection === 'selected'));
    for (const id of selectedIds) reportError(errors, 'finding contradicts selected technical results', review.rows.some(r => r.requirementId === id && r.result === 'fail' && r.evidenceIds?.some(e => has(f.evidenceIds, e))));
  }
  const obligations = new Set(bundle.matrix.requirements.flatMap(r => r.obligations.map(o => o.id)));
  const surfaces = new Set(review.target.surfaces.map(s => s.id));
  for (const m of review.manualChecks) {
    for (const k of ['id', 'prerequisite', 'operator', 'target', 'limits', 'expectedPass', 'expectedFail', 'evidenceNeeded', 'cleanup']) reportError(errors, 'manual check missing ' + k, nonempty(m[k]));
    reportError(errors, 'manual check steps/bindings/status', texts(m.steps) && m.steps.length > 0 && Array.isArray(m.obligationIds) && m.obligationIds.length > 0 && m.obligationIds.every(id => obligations.has(id)) && Array.isArray(m.surfaceIds) && m.surfaceIds.length > 0 && m.surfaceIds.every(id => surfaces.has(id)) && ['pending', 'received', 'assessed'].includes(m.status));
  }
  for (const risk of review.risks) {
    for (const k of ['id', 'owner', 'rationale', 'scope', 'compensations', 'reviewCondition']) reportError(errors, 'risk missing ' + k, nonempty(risk[k]));
    reportError(errors, 'risk disposition/bindings', ['accepted', 'unaccepted', 'unknown', 'fixed'].includes(risk.disposition) && Array.isArray(risk.findingIds) && risk.findingIds.length > 0 && risk.findingIds.every(id => review.findings.some(f => f.id === id)));
  }
  for (const item of review.supplemental) {
    for (const k of ['id', 'scope', 'method', 'negativeScenario', 'rationale', 'nextAction']) reportError(errors, 'supplemental check missing ' + k, nonempty(item[k]));
    reportError(errors, 'supplemental check status/evidence', nonempty(item.id) && item.id.startsWith('BRO-SEC-') && ['applicable', 'not-applicable', 'unknown'].includes(item.applicability) && ['pass', 'fail', 'unchecked', 'inconclusive'].includes(item.result) && Array.isArray(item.evidenceIds) && item.evidenceIds.every(id => evidence.has(id)));
    reportError(errors, 'supplemental conclusion missing evidence or applicability', !['pass', 'fail'].includes(item.result) || (item.applicability === 'applicable' && item.evidenceIds.length > 0));
  }
  for (const c of review.checksReviewed) reportError(errors, 'reviewed check missing execution distinction', object(c) && nonempty(c.description) && typeof c.performed === 'boolean' && Array.isArray(c.evidenceIds) && c.evidenceIds.every(id => evidence.has(id)) && (!c.performed || c.evidenceIds.length > 0));
  reportError(errors, 'questions/secret locations/limitations must be text arrays', texts(review.openQuestions) && texts(review.secretsObserved) && texts(review.limitations));
  const computed = summarize(review);
  if (computed.conclusion === 'satisfied') reportError(errors, 'complete assessment missing reviewer or threat inventory', review.reviewer !== 'unknown' && review.confidence !== 'unverified' && review.threatModel.assets.length > 0 && review.threatModel.actors.length > 0 && review.threatModel.flows.length > 0);
  reportError(errors, 'incorrect aggregate conclusion', review.conclusion === computed.conclusion);
  reportError(errors, 'incorrect coverage counters', canonical(review.summary) === canonical(computed.summary));
  return errors.length ? { errors } : { errors, ...computed };
}

function newReview(request, bundle) {
  request.target.selectedRequirements ??= [];
  const errors = validateTarget(request.target, bundle.matrix);
  if (!nonempty(request.reviewId)) errors.push('reviewId missing');
  if (errors.length) throw new Error(errors.join('; '));
  const rows = bundle.matrix.requirements.flatMap(req => req.obligations.flatMap(o => request.target.surfaces.map(s => ({
    requirementId: req.id, obligationId: o.id, surfaceId: s.id,
    selection: expectedSelection(req, o, request.target), applicability: 'unknown', result: 'unchecked',
    evidenceIds: [], rationale: 'Not checked. Determine applicability and obtain the procedure evidence.',
  }))));
  const result = { schema: 'bro.security-review.record/v1', reviewId: request.reviewId, ...bundle.identity,
    target: request.target, inventoryComplete: false, rows, evidence: [], findings: [], manualChecks: [], risks: [],
    supplemental: [], reviewer: request.reviewer ?? 'unknown', confidence: 'unverified', controlChanges: 'Not inventoried',
    threatModel: { assets: [], actors: [], trustBoundaries: [], sensitiveData: [], flows: [], abuseCases: [] },
    capabilities: { analysis: true, localExecution: false, constraints: ['Execution isolation not yet established'] },
    gateStatuses: gateIds.map(id => ({ id, status: 'not-checked', evidenceIds: [], rationale: 'Determine trigger and obtain evidence' })),
    openQuestions: ['Inventory and applicability not established'], checksReviewed: [], secretsObserved: [], limitations: ['Unverified initial record'],
    continuation: { pending: rows.filter(r => r.selection === 'selected').map(r => [r.obligationId, r.surfaceId]), nextAction: 'Inventory and determine applicability' },
  };
  return { ...result, ...summarize(result) };
}

async function main(args) {
  const command = args.shift() ?? 'validate', options = {}, positional = [];
  while (args.length) {
    const value = args.shift();
    if (['--catalog', '--matrix', '--review'].includes(value)) {
      if (!args.length) throw new Error('missing option value');
      options[value.slice(2)] = resolve(args.shift());
    } else if (value.startsWith('--')) throw new Error('unknown option');
    else positional.push(value);
  }
  const bundle = await loadBundle(options), errors = await validateBundle(bundle);
  if (errors.length) return { output: { valid: false, errors }, code: 1 };
  if (command === 'validate') {
    const result = options.review ? validateReview(await readJson(options.review), bundle) : { errors: [] };
    return { output: { valid: result.errors.length === 0, ...result, ...bundle.identity }, code: result.errors.length ? 1 : 0 };
  }
  if (command === 'new') return { output: newReview(await readJson(positional[0]), bundle), code: 0 };
  if (command === 'catalog') return { output: { ...bundle.identity, version: bundle.catalog.version,
    requirements: bundle.catalog.requirements.map(r => ({ id: r.id, minLevel: r.minLevel, chapter: r.chapter, section: r.sectionName })),
    cumulative: Object.fromEntries([1, 2, 3].map(l => [l, bundle.catalog.requirements.filter(r => r.minLevel <= l).length])),
    coverage: Object.fromEntries(['covered', 'partial', 'gap'].map(s => [s, bundle.matrix.requirements.filter(r => r.coverage.status === s).length])),
  }, code: 0 };
  if (['requirement', 'chapter'].includes(command)) {
    const selected = bundle.catalog.requirements.filter(r => command === 'requirement' ? r.id === positional[0] : r.chapter === positional[0]);
    if (!selected.length) throw new Error('unknown requirement/chapter');
    return { output: selected.map(r => ({ original: r, procedure: bundle.matrix.requirements.find(m => m.id === r.id) })), code: 0 };
  }
  if (['documents', 'document'].includes(command)) {
    const docs = (await Promise.all(['wstg', 'cs'].map(s => readJson(resolve(skillRoot, 'references/sources/' + s + '.json'))))).flatMap(b => b.documents);
    if (command === 'document') {
      const doc = docs.find(d => d.id === positional.join(' '));
      if (!doc) throw new Error('unknown document ID');
      return { output: doc, code: 0 };
    }
    const query = positional.join(' ').toLowerCase();
    return { output: docs.filter(d => (d.id + '\n' + d.text).toLowerCase().includes(query)).map(({ text, ...meta }) => meta), code: 0 };
  }
  throw new Error('commands: catalog, requirement ID, chapter Vn, documents QUERY, document ID, new REQUEST, validate [--catalog PATH --matrix PATH --review PATH]');
}

try {
  const { output, code } = await main(process.argv.slice(2));
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exitCode = code;
} catch (error) {
  // Do not echo arbitrary input contents, paths or parser excerpts into reports.
  process.stdout.write(JSON.stringify({ valid: false, errors: [error instanceof SyntaxError ? 'invalid JSON input' : error.code ? 'input or referenced file unavailable' : error instanceof TypeError ? 'invalid input structure' : error.message] }) + '\n');
  process.exitCode = 1;
}
