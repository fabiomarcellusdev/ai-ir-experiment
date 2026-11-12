"""The independent oracle of gate C0.1 (docs/contract.md; decision 0006, "The oracle check for C0.1").

It uses html5lib 1.1's parser only (contract amendment of 2026-11-11, "the C0.1 marker and draw", 3). This file names
no serializer, sanitizer, filter or tree walker of html5lib; run-c01.mjs checks its text before each run. html5lib's
own package start loads its serializer and tree-walker modules; this file never calls them, and the run checks that
no filter or sanitizer module is loaded. The tree dump below is this file's own code.

Run it from the repository root, with the interpreter of .venv-oracle/, -I and -B:
    python -I -B experiments/c01/oracle.py check <job.json> <out.json>
    python -I -B experiments/c01/oracle.py treetests <folder of .dat files> <out.json>
"""
import hashlib
import json
import sys

from html5lib.html5parser import HTMLParser
from html5lib.treebuilders import getTreeBuilder

HTML_NS = 'http://www.w3.org/1999/xhtml'
MARK = 'data-oracle-mark'
VOID = {'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen',
        'link', 'meta', 'param', 'source', 'track', 'wbr'}
DOCTYPE = '<!DOCTYPE>'
ROOT = 'DOCUMENT_ROOT'


def parse(text, scripting=True):
    """The tree of a document. A leading BOM is not content, as in a browser."""
    if text.startswith('﻿'):
        text = text[1:]
    return HTMLParser(tree=getTreeBuilder('etree', fullTree=True)).parse(text, scripting=scripting)


def split_tag(tag):
    if tag.startswith('{'):
        ns, local = tag[1:].split('}', 1)
        return ns, local
    return '', tag


def is_comment(e):
    return not isinstance(e.tag, str)


def attrs_of(e):
    return sorted([*split_tag(k), v] for k, v in e.attrib.items())


def tokens(root):
    """The tree as a flat list of tokens, in document order. No recursion.

    ["d", name, public, system] a doctype; ["c", data] a comment; ["t", text] a text node;
    ["o", namespace, name, attributes] an element start; ["x"] an element end.
    Each item also records the element it belongs to, for the numbering (see `elements`).
    """
    out = []
    owners = []
    stack = [('kids', root)]
    while stack:
        kind, e = stack.pop()
        if kind == 'tail':
            if e:
                out.append(['t', e])
                owners.append(None)
            continue
        if kind == 'end':
            out.append(['x'])
            owners.append(None)
            continue
        if kind == 'kids':
            if e.text and e.tag != DOCTYPE and not is_comment(e) and e.tag != ROOT:
                out.append(['t', e.text])
                owners.append(None)
            for c in reversed(list(e)):
                stack.append(('tail', c.tail))
                stack.append(('node', c))
            continue
        # kind == 'node'
        if is_comment(e):
            out.append(['c', e.text or ''])
            owners.append(None)
        elif e.tag == DOCTYPE:
            out.append(['d', e.text or '', e.get('publicId') or '', e.get('systemId') or ''])
            owners.append(None)
        else:
            out.append(['o', *split_tag(e.tag), attrs_of(e)])
            owners.append(e)
            stack.append(('end', e))
            stack.append(('kids', e))
    return out, owners


def elements(toks, owners):
    """The elements in preorder, outside template content, as the server numbers its refs: (token index, element)."""
    els = []
    template_depth = []
    depth = 0
    for i, t in enumerate(toks):
        if t[0] == 'o':
            if not template_depth:
                els.append((i, owners[i]))
            if t[1] == HTML_NS and t[2] == 'template':
                template_depth.append(depth)
            depth += 1
        elif t[0] == 'x':
            depth -= 1
            if template_depth and template_depth[-1] == depth:
                template_depth.pop()
    return els


def end_of(toks, i):
    """The index after the ["x"] that closes the element that starts at token i."""
    depth = 0
    for j in range(i, len(toks)):
        if toks[j][0] == 'o':
            depth += 1
        elif toks[j][0] == 'x':
            depth -= 1
            if depth == 0:
                return j + 1
    raise ValueError('an element with no end token')


def balanced(seq):
    depth = 0
    for t in seq:
        if t[0] == 'o':
            depth += 1
        elif t[0] == 'x':
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def outside_kept(s_toks, a, b):
    """Whether a tree equals A + (some sibling nodes) + B, where A and B are the tokens before and after the marker.

    New text can merge with a text token at the end of A or at the start of B (decision 0006, "The edit").
    """
    n, m, L = len(a), len(b), len(s_toks)
    head_fixed = a[:-1] if n and a[-1][0] == 't' else a
    tail_fixed = b[1:] if m and b[0][0] == 't' else b
    if L < len(head_fixed) + len(tail_fixed):
        return False
    if s_toks[:len(head_fixed)] != head_fixed:
        return False
    if tail_fixed and s_toks[L - len(tail_fixed):] != tail_fixed:
        return False
    i = len(head_fixed)            # the first token after the fixed head
    j = L - len(tail_fixed)        # the first token of the fixed tail
    left = a[-1][1] if n and a[-1][0] == 't' else None
    right = b[0][1] if m and b[0][0] == 't' else None
    mid = s_toks[i:j]
    # One text token holds the end of the text before, the new text, and the start of the text after.
    if left is not None and right is not None and len(mid) == 1 and mid[0][0] == 't':
        v = mid[0][1]
        if len(v) >= len(left) + len(right) and v.startswith(left) and v.endswith(right):
            return True
    if left is not None:
        if not mid or mid[0][0] != 't' or not mid[0][1].startswith(left):
            return False
        mid = mid[1:]
    if right is not None:
        if not mid or mid[-1][0] != 't' or not mid[-1][1].endswith(right):
            return False
        mid = mid[:-1]
    return balanced(mid)


def check(job_path, out_path):
    with open(job_path, encoding='utf-8') as f:
        job = json.load(f)
    files = {}
    file_out = {}
    for fid, spec in job['files'].items():
        toks, owners = tokens(parse(spec['text']))
        els = elements(toks, owners)
        files[fid] = (spec['text'], toks, els)
        p5 = spec.get('parse5')
        diff = None
        if p5 is not None and p5 != toks:
            diff = next((k for k in range(min(len(p5), len(toks))) if p5[k] != toks[k]), min(len(p5), len(toks)))
        # The result names the first differing token by its index and kind only: no text of the file.
        file_out[fid] = {
            'elements': len(els),
            'agree': p5 is None or diff is None,
            'firstDiff': None if diff is None else {
                'index': diff,
                'parse5': p5[diff][0] if diff < len(p5) else None,
                'html5lib': toks[diff][0] if diff < len(toks) else None,
            },
        }
    results = []
    for ed in job['edits']:
        r = {'id': ed['id']}
        try:
            r.update(verdict(files[ed['file']], ed))
        except Exception as ex:  # The verdict of this edit is "the oracle stopped", with the error's kind.
            r['error'] = type(ex).__name__
        results.append(r)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'files': file_out, 'edits': results, 'modules': loaded_modules()}, f)


PREFIX = {'http://www.w3.org/1999/xlink': 'xlink', 'http://www.w3.org/XML/1998/namespace': 'xml',
          'http://www.w3.org/2000/xmlns/': 'xmlns'}


def source_name(ns, name):
    """An attribute's name as source text: a foreign attribute keeps its prefix (xlink:href)."""
    if not ns or (ns == 'http://www.w3.org/2000/xmlns/' and name == 'xmlns'):
        return name
    return f'{PREFIX[ns]}:{name}'


def escape_value(v):
    return v.replace('&', '&amp;').replace('"', '&quot;')


def token_hash(toks):
    """The SHA-256 of the tokens as compact JSON, as run-c01.mjs computes it for parse5's tokens."""
    return hashlib.sha256(json.dumps(toks, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()


def verdict(file, ed):
    """The checks of one edit (decision 0006, "The oracle check for C0.1"): the tag, the marker, the tree outside."""
    text, toks, els = file
    ref = ed['ref']
    if ref >= len(els):
        return {'tagOk': False, 'oracleTag': None, 'markerOk': False, 'kept': None}
    i, _ = els[ref]
    ns, name = toks[i][1], toks[i][2]
    r = {'oracleTag': [ns, name], 'tagOk': ns == ed['ns'] and name == ed['tag']}
    if ed['s'] is None:  # An element with no source position: there is no range to check.
        return r
    s, e = ed['s'], ed['e']
    attrs = toks[i][3]
    # An empty copy of the element, with its attributes: some decide where the parser puts it (C0.1 review, 2).
    shown = ' '.join(f'{source_name(ans, an)}="{escape_value(v)}"' for ans, an, v in attrs + [['', MARK, '1']])
    open_only = ns == HTML_NS and (name in VOID or name == 'plaintext')
    mark = f'<{name} {shown}>' + ('' if open_only else f'</{name}>')
    j = end_of(toks, i)
    a, b = toks[:i], toks[j:]
    expected = a + [['o', ns, name, sorted(attrs + [['', MARK, '1']])], ['x']] + b
    marked, _ = tokens(parse(text[:s] + mark + text[e:]))
    r['markerOk'] = marked == expected
    r['markerAgree'] = token_hash(marked) == ed['parse5Marked']
    spliced, _ = tokens(parse(text[:s] + ed['html'] + text[e:]))
    r['kept'] = outside_kept(spliced, a, b)
    r['spliceAgree'] = token_hash(spliced) == ed['parse5Spliced']
    return r


def loaded_modules():
    return sorted(k for k in sys.modules if k == 'html5lib' or k.startswith('html5lib.'))


# --- The html5lib tree-construction tests ---------------------------------------------------------------------------

def read_dat(path):
    """The tests of one .dat file: a list of dicts with the keys of its sections."""
    with open(path, encoding='utf-8', newline='') as f:
        lines = f.read().split('\n')
    tests, cur, key = [], None, None
    for line in lines:
        if line == '#data' and (cur is None or key == 'document'):
            if cur is not None:
                tests.append(cur)
            cur, key = {'data': []}, 'data'
            continue
        if line.startswith('#') and cur is not None and line[1:] in (
                'errors', 'new-errors', 'document-fragment', 'script-on', 'script-off', 'document'):
            key = line[1:]
            cur.setdefault(key, [])
            continue
        if cur is not None:
            cur[key].append(line)
    if cur is not None:
        tests.append(cur)
    for t in tests:
        doc = t.get('document', [])
        while doc and doc[-1] == '':
            doc.pop()
        t['data'] = '\n'.join(t['data'])
    return tests


NS_PREFIX = {'http://www.w3.org/2000/svg': 'svg ', 'http://www.w3.org/1998/Math/MathML': 'math '}
ATTR_PREFIX = {'http://www.w3.org/1999/xlink': 'xlink ', 'http://www.w3.org/XML/1998/namespace': 'xml ',
               'http://www.w3.org/2000/xmlns/': 'xmlns '}


def dump(root):
    """The tree in the test format of html5lib-tests ("| " lines). Template children print under "content"."""
    out = []
    stack = [('kids', root, 0)]
    while stack:
        kind, e, d = stack.pop()
        pad = '| ' + '  ' * d
        if kind == 'text':
            out.append(f'{pad}"{e}"')
            continue
        if kind == 'kids':
            first = [] if e.tag == ROOT or is_comment(e) or e.tag == DOCTYPE else ([('text', e.text, d)] if e.text else [])
            items = []
            for c in e:
                items.append(('node', c, d))
                if c.tail:
                    items.append(('text', c.tail, d))
            for it in reversed(first + items):
                stack.append(it)
            continue
        if is_comment(e):
            out.append(f'{pad}<!-- {e.text} -->')
        elif e.tag == DOCTYPE:
            pub, sys_ = e.get('publicId'), e.get('systemId')
            if pub or sys_:
                out.append(f'{pad}<!DOCTYPE {e.text or ""} "{pub or ""}" "{sys_ or ""}">')
            else:
                out.append(f'{pad}<!DOCTYPE {e.text or ""}>')
        else:
            ns, local = split_tag(e.tag)
            out.append(f'{pad}<{NS_PREFIX.get(ns, "")}{local}>')
            attrs = sorted((ATTR_PREFIX.get(ans, '') + aname, v) for ans, aname, v in attrs_of(e))
            for k, v in attrs:
                out.append(f'{pad}  {k}="{v}"')
            if ns == HTML_NS and local == 'template':
                out.append(f'{pad}  content')
                stack.append(('kids', e, d + 2))
            else:
                stack.append(('kids', e, d + 1))
    return out


class _Root:
    """A document root for a fragment's children, so `dump` can print them."""

    def __init__(self, kids):
        self.tag, self.text, self.tail, self._kids = ROOT, None, None, kids

    def __iter__(self):
        return iter(self._kids)


def treetests(folder, out_path):
    import glob
    import os
    results = {'files': 0, 'tests': 0, 'runs': 0, 'passed': 0, 'skipped': [], 'failed': []}
    for path in sorted(glob.glob(os.path.join(folder, '*.dat'))):
        results['files'] += 1
        name = os.path.basename(path)
        for k, t in enumerate(read_dat(path)):
            results['tests'] += 1
            modes = [True, False]
            if 'script-on' in t:
                modes = [True]
            elif 'script-off' in t:
                modes = [False]
            for scripting in modes:
                results['runs'] += 1
                tid = f'{name}#{k + 1}' + ('' if len(modes) == 1 else (' script-on' if scripting else ' script-off'))
                try:
                    if 'document-fragment' in t:
                        ctx = t['document-fragment'][0]
                        if ' ' in ctx:
                            # html5lib 1.1 takes an HTML context element only. Not a use of this gate: it parses
                            # whole documents.
                            results['skipped'].append({'id': tid, 'reason': 'a fragment in a foreign context'})
                            continue
                        p = HTMLParser(tree=getTreeBuilder('etree'))
                        frag = p.parseFragment(t['data'], container=ctx, scripting=scripting)
                        kids = list(frag)
                        got = ([f'| "{frag.text}"'] if frag.text else []) + dump(_Root(kids))
                    else:
                        got = dump(parse(t['data'], scripting=scripting))
                except Exception as ex:  # A crash is a failure of the test, recorded with its kind.
                    results['failed'].append({'id': tid, 'error': type(ex).__name__})
                    continue
                # A text node with a line break spans several lines of the expected tree, so compare whole texts.
                if '\n'.join(got) == '\n'.join(t.get('document', [])):
                    results['passed'] += 1
                else:
                    results['failed'].append({'id': tid, 'data': t['data'][:200]})
    results['modules'] = loaded_modules()
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=1)


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] not in ('check', 'treetests'):
        sys.stderr.write(__doc__)
        sys.exit(2)
    (check if sys.argv[1] == 'check' else treetests)(sys.argv[2], sys.argv[3])
