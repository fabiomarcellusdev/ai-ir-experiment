"""The judge of gate C0.6 (docs/contract.md, "How a result passes"): html5lib 1.1's parser only, as for C0.1.

    python -I -B experiments/c06/judge.py <job.json> <out.json>
job: {"edits": [{"id", "result", "expected"}], "answers": [{"id", "value", "expected"}]}
  - an edit's "result" and "expected" are paths of files; the judge compares their canonical DOMs;
  - an answer's "value" is the text after the last "ANSWER:", and "expected" the expected value.
out: {"edits": {id: bool}, "answers": {id: bool}, "modules": [...]}
"""
import html
import importlib.util
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the repository
_spec = importlib.util.spec_from_file_location(
    'c01_oracle', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'c01', 'oracle.py'))
c01 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(c01)

KEEP_WS = {'pre', 'textarea', 'script', 'style'}
WS = re.compile('[ \t\n\f\r]+')


def canonical(text):
    """The canonical DOM: the parser's tree (entities decoded), attributes sorted, and runs of ASCII whitespace as one
    space in text outside pre, textarea, script and style. A text node of whitespace only, outside those elements, is
    layout: it is left out (owner, 2026-11-12). A list of tokens (see c01's `tokens`)."""
    toks, _ = c01.tokens(c01.parse(text))
    out, keep = [], []  # keep: for each open element, whether it or an ancestor keeps its whitespace
    for t in toks:
        if t[0] == 'o':
            keep.append((keep[-1] if keep else False) or (t[1] == c01.HTML_NS and t[2] in KEEP_WS))
            out.append(t)
        elif t[0] == 'x':
            keep.pop()
            out.append(t)
        elif t[0] == 't' and not (keep and keep[-1]):
            v = WS.sub(' ', t[1])
            if v != ' ':
                out.append(['t', v])
        else:
            out.append(t)
    return out


def answer_ok(value, expected):
    """The answer after trimming and decoding entities equals the expected value."""
    return html.unescape(value.strip()) == expected


def main(job_path, out_path):
    with open(job_path, encoding='utf-8') as f:
        job = json.load(f)
    out = {'edits': {}, 'answers': {}}
    cache = {}
    for e in job.get('edits', []):
        try:
            with open(e['result'], encoding='utf-8') as f:
                result = f.read()
        except (OSError, UnicodeDecodeError):  # a missing or broken result fails the edit
            out['edits'][e['id']] = False
            continue
        if e['expected'] not in cache:
            with open(e['expected'], encoding='utf-8') as f:
                cache[e['expected']] = canonical(f.read())
        out['edits'][e['id']] = canonical(result) == cache[e['expected']]
    for a in job.get('answers', []):
        out['answers'][a['id']] = a['value'] is not None and answer_ok(a['value'], a['expected'])
    out['modules'] = c01.loaded_modules()
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.stderr.write(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
