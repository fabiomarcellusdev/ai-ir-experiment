"""The oracle of C0.1 v2 (docs/contract.md, amendment "the gate text for the v2 tools", A): html5lib 1.1's parser
only, through experiments/c01/oracle.py (the tree tokens, the marker and the splice checks) and
experiments/c02/oracle_c02.py (the closed list of hidden content). Character references are decoded with Python's
html module, not with parse5.

    python -I -B experiments/c01/oracle_v2.py facts <job.json> <out.json>
    python -I -B experiments/c01/oracle_v2.py check <job.json> <out.json>

facts: {"files": {name: text}} -> for each file, each element (by the server's ref order) with its tag, namespace,
       parent ref, id, whether the outline shows it, its attributes by source name, and its token range; the visible
       text tokens; and the count of each id value (template content included).
check: {"files": {name: text}, "changes": [...]} -> for each change, C0.1's verdict on its splice and the check of
       its operation (accepted), or the confirmation of its refusal reason (refused).
"""
import html
import importlib.util
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the repository
_here = os.path.dirname(os.path.abspath(__file__))


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(_here, *rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


c01 = _load('c01_oracle', ['oracle.py'])
c02 = _load('c02_oracle', ['..', 'c02', 'oracle_c02.py'])

HTML_NS = c01.HTML_NS
NOT_VISIBLE = {'script', 'style', 'svg', 'template', 'noscript'}
DROP = {'script', 'style', 'noscript', 'template', 'link', 'meta'}
RAWTEXT = {'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'}
WS = re.compile('[ \t\n\f\r]+')
REF = re.compile(r'&(?:#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;?)')


def norm(s):
    return WS.sub(' ', s)


def facts_of(text):
    """The elements, visible text tokens and id counts of a document, from html5lib's tree."""
    root = c01.parse(text)
    toks, owners = c01.tokens(root)
    els = c01.elements(toks, owners)
    ref_of = {i: r for r, (i, _) in enumerate(els)}
    out = [None] * len(els)
    texts = []
    ids = {}
    stack = []  # [token index, ref, dark, shown, local name]
    for i, t in enumerate(toks):
        if t[0] == 'o':
            ns, local, attrs = t[1], t[2], t[3]
            top = stack[-1] if stack else None
            dark = (top[2] if top else False) or local in NOT_VISIBLE or c02.hidden(owners[i])
            # The outline shows an element when its parent is shown (or it is at the top), its parent is not an svg,
            # and it is not dropped or hidden (server/view.mjs, `load`; contract, C0.2).
            parent_ok = top is None or (top[3] and top[4] != 'svg')
            shown = parent_ok and local not in DROP and not c02.hidden(owners[i])
            idv = next((v for a_ns, a_name, v in attrs if a_ns == '' and a_name == 'id'), None)
            ref = ref_of.get(i)
            # A.5.3: an id counts once for each shown element and each element of template content that has it.
            if idv is not None and (shown or ref is None):
                ids[idv] = ids.get(idv, 0) + 1
            if ref is not None:
                parent = next((s[1] for s in reversed(stack) if s[1] is not None), None)
                out[ref] = {'tag': local, 'ns': ns, 'parent': parent, 'id': idv, 'shown': shown, 'start': i,
                            'attrs': [[c01.source_name(a_ns, a_name), v] for a_ns, a_name, v in attrs]}
            stack.append([i, ref, dark, shown, local])
        elif t[0] == 'x':
            s = stack.pop()
            if s[1] is not None:
                out[s[1]]['end'] = i + 1
        elif t[0] == 't':
            if not (stack and stack[-1][2]):
                texts.append([i, t[1], stack[-1][1] if stack else None])
    return {'elements': out, 'texts': texts, 'ids': ids}


def decode_ref(r):
    """One character reference as HTML decodes it. Python's html.unescape drops the control characters and the
    noncharacters of a numeric reference, which HTML keeps (review of the C0.1 v2 script, 12)."""
    m = re.fullmatch(r'&#([xX][0-9a-fA-F]+|[0-9]+);?', r)
    if not m:
        return html.unescape(r)
    num = m.group(1)
    cp = int(num[1:], 16) if num[0] in 'xX' else int(num)
    if cp in html._invalid_charrefs:  # 0x00, 0x0D and the C1 controls that HTML maps (windows-1252)
        return html._invalid_charrefs[cp]
    if cp > 0x10FFFF or 0xD800 <= cp <= 0xDFFF:
        return '�'
    return chr(cp)


def charmap(src):
    """The decoded text of a text node's source and the source range of each decoded character. A legacy reference
    with no ';' ends before the plain text after it ('&copy2024' is '&copy' and '2024')."""
    out, val = [], []
    i = 0
    while i < len(src):
        if src[i] == '&':
            m = REF.match(src, i)
            if m:
                r = m.group(0)
                d = decode_ref(r)
                if d != r:
                    k = 0
                    while k < len(d) - 1 and k < len(r) - 1 and d[-1 - k] == r[-1 - k]:
                        k += 1
                    n = len(r) - k
                    for ch in d[:len(d) - k]:
                        out.append((i, i + n))
                        val.append(ch)
                    i += n
                    continue
        if src[i] == '\r':
            n = 2 if src[i + 1:i + 2] == '\n' else 1
            out.append((i, i + n))
            val.append('\n')
            i += n
            continue
        out.append((i, i + 1))
        val.append(src[i])
        i += 1
    return ''.join(val), out


def locate_old(value, old):
    """The raw bounds [a, b) in `value` of the one part whose normalized text equals normalized `old`, or None."""
    want = norm(old)
    if not want.strip():
        return None
    n, pos = [], []
    for i, ch in enumerate(value):
        ws = ch in ' \t\n\f\r'
        if ws and i > 0 and value[i - 1] in ' \t\n\f\r':
            pos[-1][1] = i + 1
            continue
        n.append(' ' if ws else ch)
        pos.append([i, i + 1])
    s = ''.join(n)
    k = s.find(want)
    if k < 0 or s.find(want, k + 1) >= 0:
        return None
    return pos[k][0], pos[k + len(want) - 1][1]


def related(o_val, r_val, old, new):
    """Whether r_val is o_val with one part, whose normalized text is normalized `old`, replaced by `new`."""
    starts = range(len(r_val) + 1) if new == '' else [m.start() for m in re.finditer(re.escape(new), r_val)]
    for k in starts:
        p, s = r_val[:k], r_val[k + len(new):]
        if len(p) + len(s) <= len(o_val) and o_val.startswith(p) and o_val.endswith(s):
            if norm(o_val[len(p):len(o_val) - len(s)]) == norm(old):
                return True
    return False


def op_ok(o, r, i, j, ch, visible):
    """The check of an accepted operation on html5lib's trees: o of the original, r of the result. `visible` is the
    set of the original's visible text token indexes: replace_text may change only one of them (review, 1)."""
    op, a = ch['op'], ch['args']
    if op == 'insert_after':
        return r[i:j] == o[i:j] and c01.outside_kept(r, o[:j], o[j:])
    if op == 'set_attribute':
        name, value = a['attribute'], a['value']
        attrs = [list(x) for x in o[i][3]]
        hit = [x for x in attrs if c01.source_name(x[0], x[1]).lower() == name.lower()]
        if hit:
            hit[0][2] = value
        else:
            attrs.append(['', name.lower() if o[i][1] == HTML_NS else name, value])
        want = o[:i] + [['o', o[i][1], o[i][2], sorted(attrs)]] + o[i + 1:]
        return r == want
    if op == 'replace_text':
        old, new = a['old'], a['new']
        if r == o:
            # A change of a part to the same text changes nothing (C0.1 v2 development run, 2).
            return any(k in visible and related(o[k][1], o[k][1], old, new) for k in range(i + 1, j))
        if len(r) == len(o):
            diff = [k for k in range(len(o)) if o[k] != r[k]]
            return (len(diff) == 1 and i < diff[0] < j and diff[0] in visible and r[diff[0]][0] == 't'
                    and related(o[diff[0]][1], r[diff[0]][1], old, new))
        if len(r) == len(o) - 1 and new == '':
            # The whole text node was the part: its text equals old exactly, with no whitespace around it (review, 10).
            for k in range(i + 1, j):
                if k in visible and norm(o[k][1]) == norm(old) and o[:k] + o[k + 1:] == r:
                    return True
        return False
    return None  # remove and replace: C0.1's rule, the splice's verdict


def depth_of(toks):
    d = best = 0
    for t in toks:
        if t[0] == 'o':
            d += 1
            best = max(best, d)
        elif t[0] == 'x':
            d -= 1
    return best


def text_node(toks, i, j, visible, old, candidates):
    """The visible text token of the target that holds `old`, found in html5lib's tree (review, 8): its value, its
    parent's tag, whether it is the parent's first child, and its source, taken from the bytes (the first candidate
    source text node of the target with the same value)."""
    want = norm(old)
    stack = []
    for k in range(i, j):
        t = toks[k]
        if t[0] == 'o':
            stack.append((k, t[2]))
        elif t[0] == 'x':
            stack.pop()
        elif t[0] == 't' and k in visible and want in norm(t[1]):
            parent_start, parent_tag = stack[-1]
            src = next((c['src'] for c in candidates if c['value'] == t[1]), None)
            return {'value': t[1], 'parentTag': parent_tag, 'first': k == parent_start + 1, 'src': src}
    return None


def confirm(ch, v, toks, i, j, visible):
    """Whether the oracle confirms a refusal's reason (the closed list of the contract's A.7)."""
    reason = ch.get('reason')
    # No reason on the closed list (an element with no clean range, a locator's refusal): nothing to confirm. Such an
    # entry may have no arguments (C0.1 v2 development run, 3).
    if reason is None:
        return False
    if reason == 'outside':
        return v.get('kept') is False
    if reason == 'depth':
        text = ch['text']
        s_toks, _ = c01.tokens(c01.parse(text[:ch['s']] + ch['html'] + text[ch['e']:]))
        return depth_of(s_toks) > 512
    node = text_node(toks, i, j, visible, (ch.get('args') or {}).get('old', ''), ch.get('candidates') or [])
    if node is None:
        return False
    if reason == 'rawtext':
        return node['parentTag'] in RAWTEXT
    if node['src'] is None:
        return False
    if reason == 'nomap':
        return charmap(node['src'])[0] != node['value']
    if reason in ('refbound', 'linebreak'):
        val, cm = charmap(node['src'])
        if val != node['value']:
            return False
        b = locate_old(val, ch['args']['old'])
        if b is None:
            return False
        a, e = b
        if reason == 'refbound':
            return (a > 0 and cm[a - 1] == cm[a]) or (e < len(cm) and cm[e] == cm[e - 1])
        return (node.get('first') and node.get('parentTag') in ('pre', 'textarea', 'listing') and a == 0
                and (ch['args']['new'] + val[e:])[:1] in ('\n', '\r'))
    return False


def check(job):
    files, visible, out = {}, {}, []
    for name, text in job['files'].items():
        toks, owners = c01.tokens(c01.parse(text))
        files[name] = (text, toks, c01.elements(toks, owners))
        visible[name] = {t[0] for t in facts_of(text)['texts']}
    for ch in job['changes']:
        res = {'id': ch['id']}
        try:
            text, toks, els = files[ch['file']]
            v = c01.verdict(files[ch['file']], ch)
            res.update(v)
            i, _ = els[ch['ref']]
            j = c01.end_of(toks, i)
            if ch.get('result') is not None:
                r_toks, _ = c01.tokens(c01.parse(ch['result']))
                res['opOk'] = op_ok(toks, r_toks, i, j, ch, visible[ch['file']])
            else:
                res['confirmed'] = confirm({**ch, 'text': text}, v, toks, i, j, visible[ch['file']])
        except Exception as ex:  # The verdict of this change is "the oracle stopped", with the error's kind.
            res['error'] = type(ex).__name__
        out.append(res)
    return out


def main(cmd, job_path, out_path):
    with open(job_path, encoding='utf-8') as f:
        job = json.load(f)
    if cmd == 'facts':
        result = {name: facts_of(text) for name, text in job['files'].items()}
    else:
        result = {'changes': check(job)}
    result_all = {'result': result, 'modules': c01.loaded_modules()}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result_all, f)


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] not in ('facts', 'check'):
        sys.stderr.write(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
