"""The oracle of the second rescope's task rules (docs/contract.md, "Phase 0, second rescope", inputs 4 and 6, and C0.8):
html5lib 1.1's parser only, through experiments/c01/oracle.py.

    python -I -B experiments/c07/oracle_c07.py <job.json> <out.json>
job: {"files": {name: {"text", "parse5"}}, "edits": [C0.1's edit form], "children": [{"id", "file", "ref"}]}
out: {"files": {name: {"agree"}}, "edits": [C0.1's verdicts], "children": {id: [[namespace, name, ref], ...]},
      "modules": [...]}
"""
import importlib.util
import json
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the repository
_spec = importlib.util.spec_from_file_location(
    'c01_oracle', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'c01', 'oracle.py'))
c01 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(c01)


def children(toks, els, ref):
    """The child elements of the element at `ref`, in order: [namespace, name, ref]. None when the ref does not exist."""
    if ref >= len(els):
        return None
    index_to_ref = {i: r for r, (i, _) in enumerate(els)}
    i, _ = els[ref]
    end = c01.end_of(toks, i)
    out = []
    depth = 0
    for j in range(i + 1, end - 1):
        t = toks[j]
        if t[0] == 'o':
            if depth == 0:
                out.append([t[1], t[2], index_to_ref.get(j)])
            depth += 1
        elif t[0] == 'x':
            depth -= 1
    return out


def main(job_path, out_path):
    with open(job_path, encoding='utf-8') as f:
        job = json.load(f)
    files = {}
    file_out = {}
    for fid, spec in job['files'].items():
        toks, owners = c01.tokens(c01.parse(spec['text']))
        files[fid] = (spec['text'], toks, c01.elements(toks, owners))
        file_out[fid] = {'agree': spec.get('parse5') is None or spec['parse5'] == toks}
    edits = []
    for ed in job.get('edits', []):
        r = {'id': ed['id']}
        try:
            r.update(c01.verdict(files[ed['file']], ed))
        except Exception as ex:  # The verdict of this edit is "the oracle stopped", with the error's kind.
            r['error'] = type(ex).__name__
        edits.append(r)
    kids = {}
    for q in job.get('children', []):
        _, toks, els = files[q['file']]
        kids[q['id']] = children(toks, els, q['ref'])
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'files': file_out, 'edits': edits, 'children': kids, 'modules': c01.loaded_modules()}, f)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
