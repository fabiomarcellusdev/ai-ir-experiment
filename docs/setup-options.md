# Setup options

Opt-in sections for `AGENTS.md`. Each section holds rules for one paradigm, one ecosystem or one kind of project, so
it fits some projects and not others. The template is for a project in any programming language, so these rules do
not load by default.

Sessions load `AGENTS.md` every time, and they do not load this file. A section that stays here costs no tokens. A
section copied into `AGENTS.md` costs tokens in every session, so copy only the sections that apply.

## How to use this file

1. At setup (`SETUP.md`, section 2), the owner describes the project: its languages, frameworks and package managers.
2. The lead reads this file and lists each section whose trigger matches, with the reason.
3. The owner says yes or no to each section.
4. The lead copies each approved section into `AGENTS.md`, under "Rules", as a `###` heading.
5. At each phase gate, the `gate-check` skill checks the triggers again. It offers each section that now matches, and
   the removal of each copied section whose trigger no longer holds.

A copied section keeps its rules short and its checks real. Adapt each check to the project's tools before the first
task that depends on it.

## Sections

| Section | Trigger |
|---|---|
| [Object-oriented design](#object-oriented-design) | The project's main code uses classes and inheritance (for example Java, C#, Kotlin, C++, Swift, PHP, Ruby, or Python and TypeScript written with classes) |
| [User interfaces](#user-interfaces) | The project has a graphical user interface: a web page, a desktop app or a mobile app |
| [Packages: pnpm](#packages-pnpm) | The project has JavaScript or TypeScript packages |
| [Packages: uv or pip](#packages-uv-or-pip) | The project has Python packages |
| [Packages: cargo](#packages-cargo) | The project has Rust crates |
| [Packages: Go modules](#packages-go-modules) | The project has Go modules |
| [Packages: NuGet](#packages-nuget) | The project has .NET packages |

Each "Packages" section applies the general rules of `AGENTS.md`, "Packages", to one ecosystem. Copy "Audit tools in
CI" (at the end) with any of them except pnpm. For an ecosystem with
no section here, write one from the same headings before the first install, and check each fact in the manager's
documentation. The facts below were checked on 2026-11-09; check them again at setup, because these settings change
quickly.

---

## Object-oriented design

For code built from classes, interfaces and inheritance. Each rule names a check that can fail.

- **One reason to change** (single responsibility). Each class has one purpose, stated in one sentence without "and".
  The reviewer reports a class whose purpose needs two sentences.
- **Extend with a new type, not a type switch** (open/closed). A switch or an `if` chain on an object's type, in more
  than one place, is a finding. The reviewer reports it. An exhaustive switch on a sealed or closed type (a sealed
  class, an enum) is allowed, because the compiler finds a missing case.
- **A subtype keeps its base type's promises** (Liskov substitution). One contract test suite runs against every
  implementation of a base type or interface. The suite finds the implementations by itself, or a test fails when an
  implementation is missing from its list. A new implementation that fails the suite does not merge.
- **Small interfaces** (interface segregation). An implementation that throws "not supported" for a method of its own
  interface is a finding. The reviewer reports it, and the interface is split.
- **Core code depends on interfaces it owns** (dependency inversion). Files, network, the database and the clock sit
  behind interfaces, and tests replace them with fakes. The boundary tool fails the build when a core module imports
  an infrastructure module.
- **Composition before inheritance.** The inheritance depth of the project's own classes is at most 4: a class has
  at most 4 levels of project classes above it. Library and framework base classes do not count. When you copy this
  section, name the tool that fails the build above 4, with its setting. Check the tool's documentation: some tools
  count library ancestors too, or count from 1, or are off by default. Where no tool fits, the reviewer counts the
  depth of each new or changed class.

Conflict with "Build only what the current task needs": an interface needs a second implementation or a test fake.
Without one, the interface waits.

---

## User interfaces

For a project with a graphical user interface. Each rule names its source and a check that can fail. WCAG 2.2 level
AA is the floor; a rule that is stricter says so. The `visual-direction` skill applies these rules while the owner
chooses the look; this section holds them for the build. When you copy this section, name the tool for each check
(for example axe, Lighthouse or a lint rule) and where it runs. Remove the part for a platform that the project does
not have. The sources were checked on 2026-11-10.

### Every platform

- **Contrast.** Text has 4.5:1. Large text (24 px, or about 18.5 px bold) has 3:1. The parts of a control, its
  states, and the parts of a graphic that a user needs have 3:1 against their neighbours (WCAG 1.4.3 and 1.4.11, AA).
  Check every pair of colour tokens with `node tools/contrast.mjs <foreground> <background> [text | large | non-text]`,
  which exits 1 on a failure. Never round: 4.499:1 fails.
- **Colour is never the only signal** (WCAG 1.4.1, A). An error, a state or a chart series also has text, a shape or
  a pattern. The reviewer reports a meaning that only colour carries.
- **Touch targets.** WCAG 2.5.8 (AA) asks for 24 × 24 CSS px, or enough space around a smaller target. This section
  is stricter: 44 × 44 CSS px on the web (WCAG 2.5.5, AAA) and 44 × 44 pt on iOS (Apple's design tips). On Android,
  the template chooses 48 × 48 dp, from Android's advice to "consider" at least 48dp (Android accessibility help). A
  user interface test measures each control.
- **Focus stays visible** (WCAG 2.4.7, AA), and no sticky header or banner hides it completely (WCAG 2.4.11, AA). A
  lint rule refuses `outline: none` or `outline: 0` without a `:focus-visible` style that replaces it. A keyboard
  test moves through each screen.
- **Every input has a visible label** (WCAG 3.3.2 and 4.1.2, A). A placeholder alone is a weak name and is not
  recommended (axe rule `label`): it disappears when the user types. Axe checks only that each input has a name, and
  a placeholder gives one, so axe alone does not fail this case. A test fails for each input that has no `<label>`
  and no `aria-labelledby` that points to visible text. Run axe, or the platform's accessibility scanner, too.
- **Motion can be turned off** (WCAG 2.3.3, AAA, so stricter than AA). Motion that an interaction starts stops when
  the user's system asks for reduced motion (`prefers-reduced-motion: reduce` on the web). A test runs with that
  setting on.
- **Feedback in time.** A press gives visible feedback within 0.1 s, the limit at which a response feels instant. A
  wait longer than 1 s shows progress, because 1 s is the limit for the user's flow of thought. A wait longer than
  10 s, the limit for the user's attention, also has a way to cancel; the cancel is the template's rule. (Nielsen,
  "Response Times: The 3 Important Limits", 1993.) On the web, 0.1 s is stricter than INP's 200 ms. A user interface
  test presses each control and measures the time to the first visible change.
- **Components use design tokens only.** This is the template's rule, not a standard. Colour, space and type values
  come from the token file of the visual decision record. A lint rule refuses a colour value (hex, `rgb()`, `hsl()`)
  outside the token file.

### Web

- **Never block zoom** (WCAG 1.4.4, AA). The viewport tag has no `user-scalable=no` and no `maximum-scale` below 2
  (axe rule `meta-viewport`). A `maximum-scale` of 5 or more, or none, is better (axe rule `meta-viewport-large`). A
  test reads the tag.
- **Text spacing can change** (WCAG 1.4.12, AA). Content stays readable when the user sets line height to 1.5 times
  the font size, paragraph spacing to 2 times, letter spacing to 0.12 times and word spacing to 0.16 times. A browser
  test applies these styles and finds no cut or overlapping text.
- **Core Web Vitals** (web.dev): layout shift (CLS) 0.1 or less, and the response to input (INP) 200 ms or less, at
  the 75th percentile of page loads. Reserve space for images and late content. The 75th percentile needs field data
  from real users. Before the product has users, a lab run checks each pull request. A page load measures CLS. A
  scripted interaction in a browser trace measures the delay of each main control, against 200 ms.
- **Animate `transform` and `opacity` only.** Other properties, such as `top` and `left`, make the browser recompute
  layout or paint (web.dev, "How to create high-performance CSS animations"). The reviewer reports an animation of
  another property.
- **Body text is 16 px by default.** This is the template's default, not a standard. iOS Safari is reported to zoom
  into a form field whose text is smaller than 16 px; no Apple source was found. Never fix that zoom with
  `maximum-scale=1`, which blocks zoom. A browser test reads the computed size.

### Mobile apps

- **A bottom navigation bar holds 3 to 5 destinations** of equal importance (Android, "Navigation bar"). The
  reviewer counts them. For iOS, read Apple's guidance for tab bars before you design one; it was not checked here.
- **The platform's accessibility scanner runs in the user interface tests,** with the rules above as its settings
  where it has them.

Conflict with dense screens: a data table or a tool used only with a mouse may need targets smaller than 44 px. The
owner may choose the WCAG AA minimum of 24 px for such a screen, in a decision record with the reason.

Sources: [WCAG 2.2 Understanding](https://www.w3.org/WAI/WCAG22/Understanding/),
[relative luminance](https://www.w3.org/TR/WCAG22/relative-luminance.html),
[Apple design tips](https://developer.apple.com/design/tips/),
[Android touch targets](https://support.google.com/accessibility/android/answer/7101858),
[Android navigation bar](https://developer.android.com/develop/ui/compose/components/navigation-bar),
[axe rules](https://dequeuniversity.com/rules/axe/4.10/), [web.dev Core Web Vitals](https://web.dev/articles/vitals),
[web.dev animations](https://web.dev/articles/animations-guide),
[Nielsen response times](https://www.nngroup.com/articles/response-times-3-important-limits/).

---

## Packages: pnpm

For JavaScript and TypeScript packages. The template's guards and checks already enforce this section.

- **pnpm only.** Never run npm installs, npx, Yarn or Bun. npm may run read-only commands (`npm view`) outside a
  project folder; inside one, npm refuses to run (`devEngines`). `package-guard.mjs` refuses the others. `deno
  install` in a folder with a `package.json` also installs npm packages: the guard asks, and the answer is no.
- **Pins:** `package.json` pins pnpm by version and SHA-512 hash. `pnpm-lock.yaml` is committed. Every direct
  dependency has an exact version (`saveExact`). Install with `pnpm install --frozen-lockfile --ignore-scripts`.
- **Age:** `minimumReleaseAge: 86400` (minutes) in `pnpm-workspace.yaml`. A security exception goes in
  `minimumReleaseAgeExclude` with a removal date; `check.mjs` fails after that date.
- **Audit:** `node tools/osv-check.mjs pnpm-lock.yaml` (in `check.mjs full`) and `pnpm audit`.
- **Scripts:** `ignoreScripts`, `strictDepBuilds` and an empty `allowBuilds` refuse every install script.
- **Vetting:** `node tools/vet-package.mjs <name> <version>`.
- **Folders:** list each folder with its own `package.json` in `tools/check.config.json` (`pnpmProjects`).

## Packages: uv or pip

For Python packages. Choose uv or pip, and write the choice here.

- **Pins:** uv commits `uv.lock`, and every sync uses `uv sync --locked`, which fails when the lock file is out of
  date. pip uses a `requirements.txt` with exact versions (`==`) and hashes, and installs with `--require-hashes`.
- **Age:** uv: `exclude-newer = "60 days"` under `[tool.uv]`. Durations need a recent uv; check its changelog for the
  pinned version. pip 26.1 or later: `--uploaded-prior-to P60D` (pip 26.0 takes a date only). Both need upload dates
  from the package index.
- **Audit:** `pip-audit -r requirements.txt`. pip-audit does not read `uv.lock`: export it first
  (`uv export --format requirements-txt`), or use OSV-Scanner, which reads `uv.lock`.
- **Scripts:** uv `no-build = true`, or pip `--only-binary :all:`, installs wheels only, so no package's build code
  runs. uv still builds the project's own workspace packages.
- **Runs:** `uv run --with x` and a script with inline dependencies (PEP 723) resolve packages that the lock file
  does not pin. The guard holds `--with`; it cannot see inline dependencies, so vet them before the first run.
- **Guard:** `package-guard.mjs` holds the common install commands of pip, uv, uvx, pipx, poetry and conda, also
  through `python -m`.

## Packages: cargo

For Rust crates.

- **Pins:** commit `Cargo.lock`, also for a library. Build with `--locked`, also locally, so that a build after a
  manifest edit fails instead of resolving new versions. `rust-toolchain.toml` pins the toolchain.
- **Toolchain:** rustup installs a missing toolchain on a plain `cargo build`. Turn that off with
  `RUSTUP_AUTO_INSTALL=0` (check the rustup documentation for the pinned rustup version).
- **Age:** a `min-publish-age` setting for cargo is reported for Rust 1.100 (due 2026-11-12), not confirmed by an
  official source on 2026-11-09. Check the release notes. Until it exists, the vetting step checks the publish date
  on crates.io. Cargo keeps versions that are already in `Cargo.lock`.
- **Audit:** `cargo audit` or `cargo deny check advisories`, or OSV-Scanner.
- **Scripts:** a crate's `build.rs` and its procedural macros run at build time, and cargo cannot refuse them. The
  vetting step reads them.
- **Guard:** `package-guard.mjs` holds the common install commands of cargo and rustup. It does not hold
  `cargo build`, which resolves new versions without `--locked`.

## Packages: Go modules

For Go modules.

- **Pins:** commit `go.mod` and `go.sum`. Since Go 1.16, builds use `-mod=readonly` and do not change `go.mod`.
  Set `GOTOOLCHAIN=local` so that the go command never downloads a newer toolchain.
- **Age:** the go command has no age setting (proposal golang/go#76485 is on hold). The vetting step reads `Time`
  from the module proxy's `/@v/<version>.info`. That time is the commit time, which an author can set to any date,
  and the proxy may leave it out. It is a weak signal: also check the first release date of the repository tag.
- **Audit:** `govulncheck ./...`, or OSV-Scanner.
- **Scripts:** Go runs no package code at install or build time. `go generate` runs commands only when called.
- **Guard:** `package-guard.mjs` holds `go get`, `go install`, the `go mod` commands that fetch, and `go run` of a
  remote module (`pkg@version`).

## Packages: NuGet

For .NET packages.

- **Pins:** an exact version is written `[1.2.3]`. Set `RestorePackagesWithLockFile` and `RestoreLockedMode` to
  `true` in the project, not only in CI, and commit `packages.lock.json`. Pin the SDK in `global.json` with
  roll-forward off, because a new SDK can change implicit package versions.
- **Age:** no stable setting was confirmed on 2026-11-09. NuGet merged a "package update cooldown" spec in 2026-09;
  check the release notes. Until then, the vetting step checks the publish date on nuget.org.
- **Audit:** NuGetAudit runs in every restore (NuGet 6.8, .NET 8 SDK and later). Set `NuGetAuditMode` to `all` and
  `NuGetAuditLevel` to `low`. Add `NU1900;NU1902;NU1903;NU1904;NU1905` to `WarningsAsErrors`. Then moderate and
  higher fail the build, a restore without vulnerability data fails too, and a low one (NU1901) stays a warning for
  the owner.
- **Scripts:** a package's `build` folder adds `.props` and `.targets` files to the project's build, and they run.
  The vetting step reads them.
- **Guard:** `package-guard.mjs` holds the common install commands of `dotnet`, `nuget` and `dnx`. It does not hold
  `dotnet build` or `dotnet run`, which restore without the owner.

## Audit tools in CI

`check.mjs` runs only `tools/osv-check.mjs` on `pnpm-lock.yaml` (`docs/follow-ups.md`). For each other ecosystem, add
its audit to CI. CI has no package guard, so the CI step follows the rules for every install: an exact version or a
hash, 60 days old or more, never `@latest`. Each tool is also an install on the owner's machine that needs the
owner's yes.
