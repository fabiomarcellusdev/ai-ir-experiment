# HIR POC: token proxies on 5 public pages and 3 samples

**Partial result: proxy token counts only.** No Claude tokenizer count, and no test of how well an agent reads or
writes HIR.

## The question

Does a compact text form of HTML (HIR) cut the tokens that an AI agent reads, enough to justify a new format? Two
forms are compared: lossless HIR (the full page) and a lossy reading view. No gate in `docs/contract.md` covers this
POC. The owner asked for a quick go or no-go signal.

## The conditions

- Date: 2026-11-10. Code: the commit on `exp/html-ir-poc` that adds this file. Node v24.22.1. NOT timed.
- Command, from the repository root:
  `node experiments/html-ir/bench.mjs experiments/html-ir/pages/<each page> experiments/html-ir/samples --json <file>`.
- Inputs:
  - 5 public pages, fetched on 2026-11-10 with curl (`experiments/html-ir/pages.txt`). The copies are not committed,
    because they are other people's content. The first 16 hex digits of each SHA-256: github `9cf6186b48973e9b`,
    hackernews `801e5611d7588237`, mdn `e702ae7a3dab2120`, tailwind `3fdec0c50632f516`, wikipedia `496e2e690b293f65`.
  - 3 synthetic samples, written by the lead (`experiments/html-ir/samples/`).
- Token counts: two **proxies**, neither of them Claude's tokenizer. Each counts the chunks of a pre-tokenizer
  regex. Proxy A uses a GPT-2-style split; proxy B uses the cl100k-style split. A real BPE count can be higher or
  lower than either: BPE splits long chunks (for example a long run of indent spaces), and its rules differ by model.
- Baseline: minified HTML (the canonical tree, serialized with no layout whitespace). A raw page has more tokens.
- The forms:
  - **HIR:** lossless. The round trip keeps the canonical DOM; attribute order can change.
  - **View HTML / view HIR:** the reading view. It removes `script`, `style`, `noscript`, `template`, `link`,
    `meta`, comments, the content of each `svg`, and every attribute outside a short list (`KEEP_ATTR` in
    `experiments/html-ir/ir.mjs`).
  - **View HIR+refs:** the view with an `@n` reference on each element line, as an MCP would need for edits.

## The numbers

Proxy A tokens; the percentage is the change against minified HTML. Raw results, with proxy B for each page:
`2026-11-10-html-ir-token-proxy.json`.

| Page | Minified HTML | HIR | View HTML | View HIR | View HIR+refs |
|---|---|---|---|---|---|
| github (repository page) | 205,175 | 199,833 (−2.6%) | 38,918 (−81.0%) | 38,964 (−81.0%) | 48,648 (−76.3%) |
| hackernews (front page) | 11,203 | 10,564 (−5.7%) | 8,864 (−20.9%) | 8,907 (−20.5%) | 10,401 (−7.2%) |
| mdn (element reference) | 50,528 | 50,075 (−0.9%) | 17,681 (−65.0%) | 17,168 (−66.0%) | 20,199 (−60.0%) |
| tailwind (landing page) | 348,022 | 343,930 (−1.2%) | 11,989 (−96.6%) | 10,871 (−96.9%) | 14,275 (−95.9%) |
| wikipedia (article "HTML") | 248,909 | 233,905 (−6.0%) | 136,464 (−45.2%) | 130,080 (−47.7%) | 150,973 (−39.3%) |
| sample: admin form | 1,457 | 1,280 (−12.1%) | 640 (−56.1%) | 560 (−61.6%) | 718 (−50.7%) |
| sample: docs article | 957 | 875 (−8.6%) | 908 (−5.1%) | 832 (−13.1%) | 984 (+2.8%) |
| sample: Tailwind landing | 2,666 | 2,517 (−5.6%) | 633 (−76.3%) | 568 (−78.7%) | 714 (−73.2%) |

The 5 public pages together, with both proxies:

| Measure | HIR | View HTML | View HIR | View HIR+refs |
|---|---|---|---|---|
| Total change, proxy A | −3.0% | −75.2% | −76.2% | −71.7% |
| Total change, proxy B | −6.0% | −77.1% | −79.3% | −74.5% |
| Median change per page, proxy A | −2.6% | −65.0% | −66.0% | −60.0% |
| Median change per page, proxy B | −5.7% | −65.6% | −68.2% | −60.7% |

The text that teaches HIR to an agent (`PRIMER` in `bench.mjs`) costs 112 tokens (proxy A) or 109 (proxy B), once
per session.

What each part of the view removes alone, as a share of the page's HIR tokens (proxy A). The parts overlap: SVG
attributes count in "SVG content" and in "other attributes".

| Page | `script`, `style`, `link`, `meta` and others | SVG content | `class` | Other attributes | Comments |
|---|---|---|---|---|---|
| github | 36.4% | 26.4% | 8.1% | 37.8% | 0.0% |
| hackernews | 1.1% | 0.0% | 7.5% | 7.1% | 0.0% |
| mdn | 44.6% | 9.2% | 2.5% | 21.6% | 4.6% |
| tailwind | 52.7% | 28.7% | 11.1% | 32.9% | 0.0% |
| wikipedia | 16.0% | 0.0% | 9.7% | 28.7% | 0.2% |

Round trip (HTML → HIR → HTML, canonical DOM compared) and idempotency (a second encode gives the same HIR): PASS on
all 8 pages. Two bugs found on the real pages were fixed first (a period as inline content, and a line break in an
attribute value). The reviews found more input classes that broke the round trip; they are fixed and tested
(`experiments/html-ir/ir.test.mjs`).

## What the numbers do not show

- **Claude's real token counts.** The two proxies differ by 3 points for lossless HIR, and indentation is a further
  unknown: on github a line has 27 spaces of indent on average. So the saving of lossless HIR (−3% to −6%) is inside
  the proxies' uncertainty; its sign is not certain. The saving of the view (−60% median or more) is far outside it.
- **Whether an agent reads or writes HIR correctly,** and how often it makes errors. No model ran.
- **Browser fidelity.** The round trip uses the POC's own parser, which does not apply HTML5's implied end tags. A
  tree can be self-consistent and still differ from a browser's DOM. The refs number the POC's tree, not the DOM.
- **What the view loses for a task.** It removes classes and `data-*` attributes, which a styling or scripting task
  needs. It shows text that CSS hides.
- **Typical pages.** 5 pages is a small set, and one page (tailwind) is 40.3% of the total. The pages change over
  time; the hashes above identify this run's copies.
