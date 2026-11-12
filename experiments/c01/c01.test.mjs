// Tests of the C0.1 gate script and its oracle. The oracle tests need the Python oracle (.venv-oracle/); without it
// they skip, with the reason (for example in CI, which installs no Python package).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  forbiddenNames, copiesOf, codePoints, reasons, randomEdits, drawableRefs, noRangeRefs, entry, editOf, runOracle,
  oracleReady, GOOD, MUTANTS, REFUSED, LISTED, NEW_HTML, filterModules,
} from './run-c01.mjs';
import { generator } from '../c05/draw-files.mjs';
import { tokens } from './tree.mjs';
import { parseDoc } from '../../server/view.mjs';

const ORACLE = readFileSync(new URL('./oracle.py', import.meta.url), 'utf8');
const noOracle = oracleReady() ? false : 'the Python oracle is not installed (.venv-oracle/)';

test('the parser-only check passes the oracle, and finds each forbidden use (negative controls)', () => {
  assert.deepEqual(forbiddenNames(ORACLE), []);
  for (const line of ['from html5lib.serializer import serialize', 'import html5lib.filters.sanitizer',
    'from html5lib import treewalkers', 'x = html5lib.serialize(doc)', 'from html5lib.filters import whitespace']) {
    assert.notDeepEqual(forbiddenNames(ORACLE + '\n' + line + '\n'), [], line);
  }
  // A comment counts too, so that a "#" in a string cannot hide a line (C0.1 review, 5).
  assert.notDeepEqual(forbiddenNames(ORACLE + "\nx = '#'; import html5lib.serializer\n"), []);
  assert.notDeepEqual(forbiddenNames(ORACLE + '\n# the serializer\n'), []);
});

test('the run-time parser-only check finds a loaded filter or sanitizer module', () => {
  assert.deepEqual(filterModules(['html5lib', 'html5lib.serializer', 'html5lib.html5parser']), []);
  assert.deepEqual(filterModules(['html5lib.filters', 'html5lib.filters.sanitizer']), ['html5lib.filters', 'html5lib.filters.sanitizer']);
});

test('the copies: CRLF everywhere, one leading BOM, and U+1F600 before each "</"', () => {
  const c = copiesOf('<p>a</p>\n<p>b</p>\r\n');
  assert.equal(c.crlf, '<p>a</p>\r\n<p>b</p>\r\n');
  assert.equal(c.bom, '﻿<p>a</p>\n<p>b</p>\r\n');
  assert.equal(c.nonbmp, '<p>a\u{1F600}</p>\n<p>b\u{1F600}</p>\r\n');
});

test('code points: a surrogate pair counts once', () => {
  assert.equal(codePoints('a\u{1F600}b', 0), 0);
  assert.equal(codePoints('a\u{1F600}b', 3), 2);
  assert.equal(codePoints('a\u{1F600}b', 4), 3);
});

test('the random draw: the same seed gives the same edits; no html, head or body; no element without a clean range', () => {
  const files = [entry('a.html', Buffer.from('<p>x<b>y</b></p><table><tr><td>1</td></tr></table>')), entry('b.html', Buffer.from('<div><i>z</i></div>'))];
  const one = randomEdits(files, generator(1), 200);
  const two = randomEdits(files, generator(1), 200);
  assert.deepEqual(one, two);
  for (const e of one) {
    assert.ok(!['html', 'head', 'body', 'tbody'].includes(e.tag), e.tag);
    assert.ok(NEW_HTML.includes(e.html));
  }
  assert.deepEqual(noRangeRefs(files[0].m).map((r) => files[0].m.els[r].tagName), ['tbody']);
  assert.equal(drawableRefs(files[0].m).length, files[0].m.els.length - 4);
});

test('each negative control breaks the one line it names in server/edit.mjs', () => {
  for (const [name, [file, from, to]] of Object.entries(MUTANTS)) {
    const src = readFileSync(new URL(`../../server/${file}`, import.meta.url), 'utf8');
    assert.equal(src.split(from).length, 2, name);
    assert.notEqual(from, to, name);
  }
  assert.equal(MUTANTS['moves the node by 1 byte'][1], GOOD);
});

test('the verdict of one edit (contract amendments of 2026-11-11)', () => {
  const v = { tagOk: true, markerOk: true, kept: true };
  const ok = { accepted: true, bytesOk: true, hashOk: true, unchanged: false };
  const refused = { accepted: false, text: REFUSED, unchanged: true };
  const ed = { kind: 'random', html: '<p>x</p>' };
  assert.deepEqual(reasons(ed, ok, v), []);
  assert.deepEqual(reasons(ed, refused, { ...v, kept: false }), []);
  assert.match(reasons(ed, { ...ok, bytesOk: false }, v).join(), /bytes/);
  assert.match(reasons(ed, { ...ok, hashOk: false }, v).join(), /hash/);
  assert.match(reasons(ed, ok, { ...v, kept: false }).join(), /tree outside/);
  assert.match(reasons(ed, ok, { ...v, markerOk: false }).join(), /exactly/);
  assert.match(reasons(ed, ok, { ...v, tagOk: false }).join(), /another element/);
  assert.match(reasons(ed, refused, v).join(), /refused, but/);
  assert.match(reasons(ed, { ...refused, unchanged: false }, { ...v, kept: false }).join(), /file changed/);
  assert.match(reasons(ed, { ...refused, text: 'html_edit: the call took longer than 1.5 s' }, { ...v, kept: false }).join(), /another error/);
  assert.match(reasons(ed, ok, { error: 'IndexError' }).join(), /oracle stopped/);
  // A listed fragment passes when the oracle confirms the tree outside (owner, 2026-11-11).
  for (const html of LISTED) assert.deepEqual(reasons({ ...ed, html }, ok, v), []);
  // A task edit must give the expected file.
  assert.match(reasons({ ...ed, kind: 'task', expectedSha256: 'x' }, { ...ok, expectedOk: false }, v).join(), /expected file/);
  // An element with no clean range: a named error, the file unchanged, and the oracle finds the range not exact.
  const nr = { kind: 'no-range', s: 0 };
  const nrRefused = { accepted: false, text: 'html_edit: @7 has no clean range in the file', unchanged: true };
  assert.deepEqual(reasons(nr, nrRefused, { ...v, markerOk: false }), []);
  assert.deepEqual(reasons({ ...nr, s: null }, { ...nrRefused, text: 'html_edit: @7 has no source bytes; the parser created it' }, { tagOk: true }), []);
  assert.match(reasons(nr, nrRefused, v).join(), /range exact/);
  assert.match(reasons(nr, ok, { ...v, markerOk: false }).join(), /accepted an element/);
  assert.match(reasons(nr, { ...nrRefused, text: REFUSED }, { ...v, markerOk: false }).join(), /another error/);
});

/** Runs the oracle on one small file and returns the verdict of each edit, by id. */
function oracleOn(text, edits) {
  const f = entry('t.html', Buffer.from(text));
  const work = mkdtempSync(path.join(tmpdir(), 'hir-c01-test-'));
  try {
    const out = runOracle([f], edits(f), work);
    return { file: out.files['t.html'], v: Object.fromEntries(out.edits.map((x) => [x.id, x])), modules: out.modules };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test('the oracle: the marker check finds an exact range, and fails a range 1 character off (negative control)', { skip: noOracle }, () => {
  const text = '<!DOCTYPE html><div>a <b>bold</b> c</div><table><tr><td>1</td></tr></table>';
  const { file, v } = oracleOn(text, (f) => {
    const b = f.m.els.find((e) => e.tagName === 'b').ref;
    const exact = editOf('exact', f, b, '');
    return [exact, { ...exact, id: 'long', e: exact.e + 1 }, { ...exact, id: 'short', s: exact.s + 1 }, { ...exact, id: 'tag', tag: 'i' }];
  });
  assert.deepEqual(file, { elements: 9, agree: true, firstDiff: null });
  assert.equal(v.exact.markerOk, true);
  assert.equal(v.exact.tagOk, true);
  assert.equal(v.long.markerOk, false);
  assert.equal(v.short.markerOk, false);
  assert.equal(v.tag.tagOk, false);
});

test('the oracle: the tree outside is kept for a balanced fragment and for merged text, and changed otherwise', { skip: noOracle }, () => {
  const text = '<div>a <b>bold</b> c</div><p>after</p>';
  const cases = { '': true, 'x': true, '<i>x</i>': true, '<p>x</p>': true, '</div><div>': false, '<!--': false, '<script>': false, '<i>x': false };
  const { v } = oracleOn(text, (f) => {
    const b = f.m.els.find((e) => e.tagName === 'b').ref;
    return Object.keys(cases).map((html, i) => editOf(`e${i}`, f, b, html));
  });
  Object.values(cases).forEach((want, i) => {
    assert.equal(v[`e${i}`].kept, want, Object.keys(cases)[i]);
    assert.equal(v[`e${i}`].spliceAgree, true, Object.keys(cases)[i]);
    assert.equal(v[`e${i}`].markerAgree, true);
  });
});

test('the oracle: fostered text makes a table range not exact; the element moved out of a table is exact', { skip: noOracle }, () => {
  const text = '<div>Q<table><tr><td>a</td>X</tr></table><table><i>f</i><tr><td>c</td></tr></table></div>';
  const { v } = oracleOn(text, (f) => ['tr', 'td', 'i'].map((t) => editOf(t, f, f.m.els.find((e) => e.tagName === t).ref, '')));
  assert.equal(v.tr.markerOk, false);
  assert.equal(v.td.markerOk, true);
  assert.equal(v.i.markerOk, true);
});

test('the oracle: the marker keeps the attributes that place an element (C0.1 review, 2)', { skip: noOracle }, () => {
  // A hidden input stays in a table; a font with a color leaves SVG; plaintext has no end tag.
  const text = '<div>Q<table><input type="hidden" name="h"><tr><td>a</td>X</tr></table></div>' +
    '<svg><font color="red">f</font></svg><p>end</p><plaintext>rest';
  const { v } = oracleOn(text, (f) => ['input', 'font', 'plaintext'].map((t) => editOf(t, f, f.m.els.find((e) => e.tagName === t).ref, '')));
  for (const t of ['input', 'font', 'plaintext']) {
    assert.equal(v[t].markerOk, true, t);
    assert.equal(v[t].markerAgree, true, t);
  }
});

test('the oracle loads no html5lib filter or sanitizer module', { skip: noOracle }, () => {
  const { modules } = oracleOn('<p>a</p>', () => []);
  assert.ok(modules.includes('html5lib.html5parser'));
  assert.deepEqual(modules.filter((m) => /filters|sanitizer/.test(m)), []);
});

test("parse5's tokens match the oracle's on odd input: foreign content, template, doctype, comments, CR", { skip: noOracle }, () => {
  const text = '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN"><!--c--><svg viewBox="0 0 1 1"><linearGradient xlink:href="#a"/></svg>' +
    '<template><p>t</p></template><math><mi>x</mi></math>a\r\nb<table><tr><td>1</td></tr></table>';
  const { file } = oracleOn(text, () => []);
  assert.deepEqual(file, { elements: tokens(parseDoc(text)).filter((t) => t[0] === 'o').length - 1, agree: true, firstDiff: null });
});
