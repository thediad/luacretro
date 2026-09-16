# luacretro

[![npm version](https://img.shields.io/npm/v/luacretro.svg)](https://www.npmjs.com/package/luacretro)

The shared Lua compiler front-end for the **gtlua** (GameTank / 6502),
**gbalua** (Game Boy Advance / ARM), **mdlua** (Sega Genesis / 68000),
**neslua** (NES / 6502), and **c64lua** (Commodore 64 / 6510) console SDKs.
A PICO-8-flavored, statically-typed Lua subset that is **ahead-of-time compiled
to C** (then to a native ROM by each SDK) - there is no Lua interpreter or VM on
the console, just native machine code. The static subset (no heap, no closures,
fixed-point numbers) is what makes that whole-program AOT compilation possible.

Each SDK depends on luacretro and calls `compile(source, file, opts)` with its
platform target and its builtin tables:

```js
import { compile } from "luacretro";
const { ok, c, diagnostics, callGraph, stubs } =
  compile(src, "main.lua", { target: "gametank", sdkName: "gtlua",
                             builtins, members, callbacks });
```

## Targets and capabilities

### Opt-in PICO API specials

SDK builtin descriptors enable these lowerings through `special`; the compiler
does not enable console APIs by their Lua names. SDKs own the runtime functions
and hardware restrictions.

- `clip`: zero arguments call `lc_clip_reset()`; four or five call
  `lc_clip(x, y, w, h, previous)`, with `previous` defaulting to zero.
- `cartdata`: one literal ID (1-64 lowercase ASCII letters, digits, underscores)
  becomes a 32-bit FNV-1a hash passed to `lc_cartdata`.
- `map`: passes `lcl___p8map`, width 128, and seven arguments to `lc_map`.
  Defaults are `0, 0, 0, 0, 128, 64, -1`; an explicit zero layer mask remains
  zero. **Runtime ABI change:** SDKs using this special must accept the ninth
  C argument, the layer mask, even if their runtime ignores it.
- `mget`: without `c`, preserves the legacy direct 128-wide array read.
  With `c: "lc_mget"` (or another runtime name), passes the map pointer, x, y
  to that helper. SDKs with mutable maps should opt into this helper so reads
  see runtime writes; hardware tilemap APIs need not share this ABI.
- `mset`: passes the map pointer, x, y, tile to `c` (default `lc_mset`).
- `fget` / `fset`: use `lc_fget(sprite, bit)` and
  `lc_fset(sprite, bit, value)`; bit -1 denotes the whole flag byte. A supplied
  bit is preserved, and the three-argument `fset` value is a boolean flag.

These calls use the SDK's normal prefix/finalRename rules. Bounds handling,
map storage, flag storage, persistence, and palette restrictions remain in the
SDK.

For a target-specific ABI, a builtin may supply `emit(call, { argAt, cName })`.
It runs after shared argument checks and returns a C expression. `argAt`
uses the shared conversions; `cName` applies the target prefix. The callback
may reject unsupported hardware operations by throwing an error. GameTank's
`palt` descriptor uses this hook to own its color-zero-only policy; there is
no GameTank palette restriction in the shared compiler.

A numeric builtin may also supply `constEval(values, { num8 })`. It receives
only finite, statically known numeric arguments after arity checks, and returns
a finite numeric value or `null` to decline folding. Hooks must be pure and
match the SDK runtime's rounding and range rules. Shadowed builtin names are
not folded. Calls in executable code still use the runtime; the hook serves
constant-expression contexts such as top-level initializers.

The emitter derives every per-platform behavior from a single capability table
(`CAPS` in `compiler/emit.js`) keyed by `opts.target`:

| target     | zpFastcall | banked | nativeDiv | colorBake | framebuffer | cName |
|------------|:----------:|:------:|:---------:|:---------:|:-----------:|-------|
| `gametank` |     ✓      |   ✓    |           |     ✓     |      ✓      | `gt_` |
| `gba`      |            |        |     ✓     |           |      ✓      | `gba_`|
| `md`       |            |        |     ✓     |           |      ✓      | `md_` |
| `nes`      |     ✓      |        |           |     ✓     |             | `nes_`|
| `c64`      |     ✓      |        |           |     ✓     |      ✓      | `c64_`|

- **zpFastcall** — the 6502 zero-page fastcall ABI (draw builtins stage args in
  `gt_a*`, user fns in `gt_p*`, fixed mul/div through `fa`/`fb`).
- **banked** — GameTank FLASH2M cross-bank far-call machinery.
- **nativeDiv** — hardware integer divide/modulo (else the runtime helpers).
- **colorBake** — bake a static P8 color literal 0-15 to a raw platform palette
  byte at compile time (needs `opts.p8Palette`).
- **framebuffer** — a full pixel surface (every draw verb lands); `nes` is a
  tile/sprite machine, so its SDK enables only the verbs it can honor.

Per-target static-allocation caps come from `opts.limits`
(`{arrayMax, poolMax}`); the defaults preserve the historical gtlua numbers.

The compiler is browser-safe (no node: / Buffer) so the web IDEs bundle it
unchanged. See `SPEC.md` for the language. The Python-family sibling is
[pycretro](https://github.com/monteslu/pycretro).
