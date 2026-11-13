"""The oracle of gate C0.2 (docs/contract.md, C0.2): html5lib 1.1's parser only, as for C0.1.

For each file it gives the elements in the server's ref order, and for each search text the count of matches as the
contract defines html_find. The parse and the element order come from experiments/c01/oracle.py.

    python -I experiments/c02/oracle_c02.py <job.json> <out.json>
job: {"files": {name: text}, "finds": [[name, text], ...]}
"""
import importlib.util
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the repository (C0.2 review, 8)
_spec = importlib.util.spec_from_file_location(
    'c01_oracle', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'c01', 'oracle.py'))
c01 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(c01)

HTML_NS = c01.HTML_NS
NOT_VISIBLE = {'script', 'style', 'svg', 'template'}  # the contract's list (html_find, "visible text")
WS = re.compile('[ \t\n\f\r]+')


def css_plain(css):
    """An inline style as the browser reads it: comments removed, escapes decoded."""
    out, i = [], 0
    while True:
        j = css.find('/*', i)
        if j == -1:
            out.append(css[i:])
            break
        out.append(css[i:j])
        k = css.find('*/', j + 2)
        if k == -1:
            break
        i = k + 2

    def dec(m):
        if m.group(2) is not None:
            return m.group(2)
        cp = int(m.group(1), 16)
        return '�' if cp == 0 or cp > 0x10FFFF or 0xD800 <= cp <= 0xDFFF else chr(cp)
    return re.sub(r'\\(?:([0-9a-fA-F]{1,6})[ \t\n\f\r]?|([^\n\r\f0-9a-fA-F]))', dec, ''.join(out))


def hidden(e):
    """The closed list of hidden content in the contract (C0.2)."""
    ns, local = c01.split_tag(e.tag)
    attrs = {c01.split_tag(k)[1]: v for k, v in e.attrib.items() if not c01.split_tag(k)[0]}
    if 'hidden' in attrs:
        return True
    if attrs.get('aria-hidden', '').lower() == 'true':
        return True
    if re.search(r'display\s*:\s*none|visibility\s*:\s*hidden', css_plain(attrs.get('style', '')), re.I):
        return True
    if ns == HTML_NS and local == 'input' and attrs.get('type', '').lower() == 'hidden':
        return True
    return ns == HTML_NS and local == 'template'


def visible_texts(root):
    """Each element with the visible text of its subtree, normalized; in preorder. No recursion."""
    order = []          # (element, depth) in preorder
    parts = {}          # id(element) -> list of visible text pieces, in order
    stack = [(root, False)]
    while stack:
        e, dark = stack.pop()
        if e is not root:
            order.append(e)
        ns, local = c01.split_tag(e.tag) if isinstance(e.tag, str) else ('', '')
        here_dark = dark or (e is not root and (hidden(e) or local in NOT_VISIBLE))
        parts[id(e)] = (here_dark, e)
        for c in reversed([c for c in e if isinstance(c.tag, str) and c.tag != c01.DOCTYPE]):
            stack.append((c, here_dark))
    # The text of an element: its own text pieces and those of its descendants, in document order.
    texts = {}
    for e in reversed(order):
        dark, _ = parts[id(e)]
        pieces = []
        if not dark and e.text:
            pieces.append(e.text)
        for c in e:
            if isinstance(c.tag, str) and c.tag != c01.DOCTYPE:
                pieces.append(texts[id(c)])
            if not dark and c.tail:
                pieces.append(c.tail)
        texts[id(e)] = ''.join(pieces)
    return order, {k: WS.sub(' ', v) for k, v in texts.items()}


def count(root, text):
    """The matches of html_find: the deepest elements whose visible text contains `text`."""
    order, vis = visible_texts(root)
    n = 0
    for e in order:
        if text in vis[id(e)] and not any(isinstance(c.tag, str) and text in vis.get(id(c), '') for c in e):
            n += 1
    return n


def hidden_refs(root, els):
    """The refs of the hidden elements and of every element inside one (the closed list of C0.2)."""
    parent = {}
    for p in root.iter():
        for c in p:
            parent[id(c)] = p
    refs = []
    for ref, (_, e) in enumerate(els):
        n = e
        while n is not None and n is not root:
            if isinstance(n.tag, str) and n.tag != c01.DOCTYPE and hidden(n):
                refs.append(ref)
                break
            n = parent.get(id(n))
    return refs


def main(job_path, out_path):
    with open(job_path, encoding='utf-8') as f:
        job = json.load(f)
    trees, out = {}, {'elements': {}, 'hidden': {}, 'finds': []}
    for name, text in job['files'].items():
        root = c01.parse(text)
        trees[name] = root
        toks, owners = c01.tokens(root)
        els = c01.elements(toks, owners)
        out['elements'][name] = [toks[i][2] for i, _ in els]
        out['hidden'][name] = hidden_refs(root, els)
    for name, text in job['finds']:
        out['finds'].append([name, text, count(trees[name], text)])
    out['modules'] = c01.loaded_modules()
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.stderr.write(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
