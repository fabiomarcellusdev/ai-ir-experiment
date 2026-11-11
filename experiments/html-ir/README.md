# HIR: a compact text form of HTML for AI agents (POC)

An experiment, on the branch `exp/html-ir-poc`. It asks whether a compact form of HTML cuts the tokens that an AI
agent reads, and whether an MCP server should serve that form.

**Result (proxy token counts, 5 public pages):** lossless HIR saves 3% to 6% against minified HTML, which is inside
the proxies' uncertainty. A lossy reading view saves 60% (median per page) with element references, or 66% without
them. Most of the saving comes from what the view removes, not from the syntax. The numbers, conditions and limits
are in
`docs/measurements/2026-11-10-html-ir-token-proxy.md`.

## The syntax

One node per line. One space of indent for each level of nesting. No closing tags.

```
tag#id{class list}(attr=value attr2="a b" bool) inline content
```

| Line | Meaning |
|---|---|
| `p{text-sm} Sync <strong>offline</strong>.` | An element. The content after the head is HTML, kept as is. |
| `{card}` or `#main` | A `div`: the tag is left out when a line starts with `{` or `#`. |
| `\| text` | A text node. |
| `// text` | A comment. |
| `!DOCTYPE html` | A doctype. |
| `script.` and deeper lines | Verbatim content (`script`, `style`, `pre`, `textarea`). |
| `@12 a(href=/x) Go` | Element number 12 of the full page. Reading views only: `decode` refuses it. |

## The forms, for one snippet

1. Minified HTML (the baseline):

   ```html
   <nav class="mx-auto flex items-center" aria-label="Main"><a href="/" class="flex gap-2 font-semibold" data-track="logo"><svg class="h-6 w-6" viewbox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10"></path></svg><span>Acme</span></a><p class="text-sm">Sync <strong>offline</strong>, every device.</p><script>track("nav")</script></nav>
   ```

2. HIR, lossless:

   ```
   nav{mx-auto flex items-center}(aria-label=Main)
    a{flex gap-2 font-semibold}(href=/ data-track=logo)
     svg{h-6 w-6}(viewbox="0 0 24 24")
      path(d="M4 16v1a3 3 0 003 3h10")
     span Acme
    p{text-sm} Sync <strong>offline</strong>, every device.
    script.
     track("nav")
   ```

3. Reading view, as HTML:

   ```html
   <nav aria-label="Main"><a href="/"><svg></svg><span>Acme</span></a><p>Sync <strong>offline</strong>, every device.</p></nav>
   ```

4. Reading view, as HIR, with references:

   ```
   @0 nav(aria-label=Main)
    @1 a(href=/)
     @2 svg
     @4 span Acme
    @5 p Sync <strong>offline</strong>, every device.
   ```

## What the reading view removes

- The elements `script`, `style`, `noscript`, `template`, `link` and `meta`.
- Comments.
- The content of each `svg` (the `svg` element stays).
- Every attribute except `id`, `href`, `src`, `alt`, `title`, `type`, `name`, `value`, `placeholder`, `for`, `role`,
  `aria-label`, `action`, `method`, `lang`, `checked`, `selected`, `disabled`, `required`, `colspan` and `rowspan`.
  So it removes `class`, `style`, `data-*`, the other `aria-*` attributes, `target`, `rel`, `srcset` and `datetime`.

Both forms also remove whitespace that does not change rendering (ASCII whitespace only; a no-break space stays),
and later copies of a repeated attribute (the DOM keeps the first).

## Run it

```
node --test experiments/html-ir/ir.test.mjs
node experiments/html-ir/bench.mjs experiments/html-ir/samples
```

To measure the public pages, fetch each line of `pages.txt` into `pages/<name>/page.html`, then name the `pages`
folder in the benchmark command. The `pages/` folder is git-ignored: its pages are other people's content.

## Limits

- The parser is a deliberately simple first pass. It does not apply HTML5's implied end tags (`</p>`, `</li>`), so
  some real pages get a different tree than in a browser. It writes attribute names in lower case (`viewbox`); a
  browser's HTML5 parser corrects the SVG names.
- Input over 20 million characters, or nested deeper than 512 levels, fails with a named error.
- HIR cannot hold an attribute name with `(`, `)`, `=` or a quote (Angular's `(click)`); `encode` fails with a named
  error.
- A text line without `| ` becomes an element: `Click here` is read as `<click>here</click>`, with no error.
- The reading view is not safe against a hostile page: page text can look like an element line with a ref, and text
  that CSS hides looks visible. An MCP needs a threat model first.
- The token counts are proxies, not Claude's tokenizer.

The open gaps are in `docs/follow-ups.md`.
