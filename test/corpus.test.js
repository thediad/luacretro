import { test } from "node:test";
import assert from "node:assert";
import { compile } from "../compiler/index.js";

// Minimal per-target builtin tables (enough to exercise the shared paths
// without vendoring the whole SDK tables). Real byte-identity is gated in each
// SDK's own suite via test/golden-c; this proves the front-end compiles for
// every target and the target seams fire correctly.
const CORE = {
  map: { params: [["int", true], ["int", true], ["coord", true], ["coord", true], ["int", true], ["int", true], ["int", true]], ret: "void", special: "map" },
  mget: { params: [["int", false], ["int", false]], ret: "int", special: "mget", c: "lc_mget" },
  mset: { params: [["int", false], ["int", false], ["int", false]], ret: "void", special: "mset" },
  fget: { params: [["int", false], ["int", true]], ret: "int", special: "fget" },
  fset: { params: [["int", false], ["int", false], ["flip", true]], ret: "void", special: "fset" },
  cartdata: { params: [["str", false]], ret: "bool", special: "cartdata" },
  clip: { params: [["coord", true], ["coord", true], ["coord", true], ["coord", true], ["flip", true]], ret: "void", special: "clip" },
  cls:      { params: [["color", true]], ret: "void", c: "lc_cls" },
  rectfill: { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "lc_rectfill" },
  circfill: { params: [["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "lc_circfill" },
  print:    { params: [["str", false], ["coord", true], ["coord", true], ["color", true]], ret: "void", c: "lc_print" },
  btn:      { params: [["int", false]], ret: "bool", c: "lc_btn" },
  min:      { params: [["num", false], ["num", false]], ret: "same", special: "min" },
  flr:      { params: [["num", false]], ret: "int", special: "flr" },
};
const CALLBACKS = ["_init", "_update", "_update60", "_draw"];
const P8_PALETTE = [0,169,90,219,51,3,6,7,91,62,31,254,190,140,94,47];

// Test target DESCRIPTORS. luacretro holds no console table - the SDK supplies
// { caps, harness }. These minimal descriptors mirror the five real SDKs enough
// to exercise every seam (real byte-identity is gated in each SDK's golden-c).
function desc({ prefix, caps, harness }) {
  return {
    caps: {
      zpFastcall: false, zpUserFn: true, fixedZp: false, banked: false,
      nativeDiv: false, colorBake: false, framebuffer: true, finalRename: false,
      prefix, ...caps,
    },
    harness: {
      signature: "void main(void)", init: [`${prefix || "gt"}_init`],
      onAudio: null, onMusic: null, onFps30: null,
      loopTop: [`${prefix || "gt"}_vsync`], frameEnd: `${prefix || "gt"}_endframe`,
      fps30Style: "runtime", returns: false, includes: [`${prefix || "gt"}_api.h`],
      ...harness,
    },
  };
}
const TARGETS = {
  gametank: desc({ prefix: "gt", caps: { zpFastcall: true, zpUserFn: true, fixedZp: true, banked: true, colorBake: true, finalRename: true },
                   harness: { init: ["gt_init"], loopTop: ["gt_update_inputs"], frameEnd: "gt_endframe", includes: ["gt_api.h"] } }),
  gba:      desc({ prefix: "gba", caps: { nativeDiv: true }, harness: { signature: "int main(void)", returns: true } }),
  md:       desc({ prefix: "md", caps: { zpUserFn: false, nativeDiv: true, finalRename: true },
                   harness: { signature: "int main(bool hard)", voidArg: "(void)hard;", returns: true,
                              fps30Style: "oddCounter", oddVar: "_md_odd", includes: ["md_api.h", "md_math.h"] } }),
  nes:      desc({ prefix: "nes", caps: { zpFastcall: true, zpUserFn: true, fixedZp: true, colorBake: true, framebuffer: false, finalRename: true },
                   harness: { init: ["nes_init"], loopTop: ["nes_update_inputs", "nes_oam_clear"],
                              fps30Style: "oddCounter", oddVar: "_nes_odd", oddDeclFirst: true, includes: ["nes_api.h", "nes_math.h"] } }),
  c64:      desc({ prefix: "c64", caps: { zpUserFn: false, colorBake: true, finalRename: true },
                   harness: { init: ["c64_init"], loopTop: ["c64_update_inputs"], includes: ["c64_api.h"] } }),
};

const CORPUS = {
  hello: `function _draw() cls(1) print("hi",4,4,7) circfill(64,64,10,10) end`,
  fixedmath: `local x=0.0\nfunction _update() x+=0.5 x=x/3 x%=2 end\nfunction _draw() end`,
  fornum: `function _update() for i=0,10 do end for j=1,20,2 do end end\nfunction _draw() end`,
  cond: `local n=0\nfunction _update() if btn(0) then n+=1 end end\nfunction _draw() if n > 5 then cls(8) else cls(1) end end`,
  func: `function add(a,b) return a+b end\nfunction _update() local z=add(1,2) end\nfunction _draw() end`,
  color: `function _draw() cls(1) rectfill(0,0,10,10,8) end`,
};

// All five targets compile the corpus. The 6502 targets (gametank/nes/c64) and
// the framebuffer targets (gba/md) share the front-end; the seams differ.
for (const tname of ["gametank", "gba", "md", "nes", "c64"]) {
  const opts = { target: TARGETS[tname], sdkName: "luacretro", builtins: CORE, callbacks: CALLBACKS, p8Palette: P8_PALETTE };
  for (const [name, src] of Object.entries(CORPUS)) {
    test(`${name} compiles for ${tname}`, () => {
      const r = compile(src, `${name}.lua`, opts);
      assert.ok(r.ok, "compile failed:\n" + (r.diagnostics || []).map(d => d.message).join("\n"));
      assert.ok(r.c.includes("main("), "should emit a main()");
    });
  }
}

// The 6502 targets bake color like gametank; nes/c64 rename to their own schema.
test("nes bakes color + renames to nes_ schema", () => {
  const r = compile(`function _draw() cls(1) rectfill(0,0,10,10,8) end`, "t.lua",
    { target: TARGETS.nes, sdkName: "neslua", builtins: CORE, callbacks: CALLBACKS, p8Palette: P8_PALETTE });
  assert.ok(r.ok, (r.diagnostics || []).map(d => d.message).join("\n"));
  assert.match(r.c, /nes_cls\(169\)/);      // P8 index 1 -> baked byte, nes_ prefix
  assert.match(r.c, /#include "nes_api.h"/);
  assert.doesNotMatch(r.c, /\bgt_/);         // no gt_ symbols leak through
});

test("c64 bakes color + renames to c64_ schema + native div", () => {
  const r = compile(`local a=0\nfunction _update() a=a\\3 end\nfunction _draw() cls(1) end`, "t.lua",
    { target: TARGETS.c64, sdkName: "c64lua", builtins: CORE, callbacks: CALLBACKS, p8Palette: P8_PALETTE });
  assert.ok(r.ok, (r.diagnostics || []).map(d => d.message).join("\n"));
  assert.match(r.c, /#include "c64_api.h"/);
  assert.doesNotMatch(r.c, /\bgt_/);
});

// per-target static-allocation limits (opts.limits) tighten diagnostics only.
test("opts.limits tightens array/pool caps", () => {
  const src = `local a=array(200)\nfunction _update() end\nfunction _draw() end`;
  const wide = compile(src, "t.lua", { target: TARGETS.nes, builtins: CORE, callbacks: CALLBACKS });
  assert.ok(wide.ok);
  const tight = compile(src, "t.lua", { target: TARGETS.nes, builtins: CORE, callbacks: CALLBACKS, limits: { arrayMax: 128 } });
  assert.ok(!tight.ok);
  assert.match(tight.diagnostics.map(d => d.message).join("\n"), /between 1 and 128/);
});

// Target seams fire distinctly.
test("gametank bakes color; gba/md pass raw", () => {
  const src = `function _draw() cls(1) end`;
  const gt = compile(src, "t.lua", { target: TARGETS.gametank, builtins: CORE, callbacks: CALLBACKS, p8Palette: P8_PALETTE });
  const gba = compile(src, "t.lua", { target: TARGETS.gba, builtins: CORE, callbacks: CALLBACKS });
  assert.match(gt.c, /gt_cls\(169\)/);   // P8 index 1 -> CAPTURE 169
  assert.match(gba.c, /gba_cls\(1\)/);       // raw index
});

test("md harness is main(bool hard) + md_ includes", () => {
  const r = compile(`function _draw() cls(1) end`, "t.lua", { target: TARGETS.md, builtins: CORE, callbacks: CALLBACKS });
  assert.match(r.c, /int main\(bool hard\)/);
  assert.match(r.c, /#include "md_api.h"/);
  assert.match(r.c, /md_cls/);
});

test("clip special lowers reset, rectangle, and previous through target rename", () => {
  for (const name of ["clip", "viewport"]) {
    const r = compile(`function _draw() ${name}() ${name}(1,2,3,4) ${name}(5,6,7,8,true) end`, "clip.lua",
      { target: TARGETS.md, builtins: { [name]: CORE.clip }, callbacks: CALLBACKS });
    assert.ok(r.ok, JSON.stringify(r.diagnostics));
    assert.match(r.c, /md_clip_reset\(\)/);
    assert.match(r.c, /md_clip\(1, 2, 3, 4, 0\)/);
    assert.match(r.c, /md_clip\(5, 6, 7, 8, \(\(1\) \? 1 : 0\)\)/);
  }
});

test("clip validation follows the descriptor and rejects partial rectangles", () => {
  for (const name of ["clip", "viewport"]) {
    for (const args of ["1", "1,2", "1,2,3", "1,2,3,4,true,6"]) {
      const r = compile(`function _draw() ${name}(${args}) end`, "clip.lua",
        { target: TARGETS.md, builtins: { [name]: CORE.clip }, callbacks: CALLBACKS });
      assert.ok(!r.ok);
      assert.match(r.diagnostics.map(d => d.message).join("\n"), /takes .*argument/);
    }
  }
  const r = compile(`function _draw() clip(1) end`, "clip.lua",
    { target: TARGETS.md, builtins: { clip: { params: [["int", false]], ret: "void", c: "lc_custom_clip" } }, callbacks: CALLBACKS });
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.match(r.c, /md_custom_clip\(1\)/);
});

test("cartdata special hashes literal IDs and renames the runtime call", () => {
  for (const name of ["cartdata", "save_id"]) {
    const r = compile(`function _draw() ${name}("a") ${name}("foobar") end`, "save.lua",
      { target: TARGETS.md, builtins: { [name]: CORE.cartdata }, callbacks: CALLBACKS });
    assert.ok(r.ok, JSON.stringify(r.diagnostics));
    assert.match(r.c, /md_cartdata\(0xe40c292cUL\)/);
    assert.match(r.c, /md_cartdata\(0xbf9cf968UL\)/);
    const boundary = compile(`function _draw() ${name}("${"a".repeat(64)}") end`, "save.lua",
      { target: TARGETS.md, builtins: { [name]: CORE.cartdata }, callbacks: CALLBACKS });
    assert.ok(boundary.ok, JSON.stringify(boundary.diagnostics));
  }
});

test("cartdata descriptor rejects invalid IDs, nonliterals, and wrong arity", () => {
  for (const name of ["cartdata", "save_id"]) {
    for (const value of ["", "A", "a-b", "a b", "é", "a".repeat(65)]) {
      const r = compile(`function _draw() ${name}("${value}") end`, "save.lua",
        { target: TARGETS.md, builtins: { [name]: CORE.cartdata }, callbacks: CALLBACKS });
      assert.ok(!r.ok);
      assert.match(r.diagnostics.map(d => d.message).join("\n"), /ID must be 1-64/);
    }
    for (const args of ["", "123", '"a","b"', '"a".."b"']) {
      const r = compile(`function _draw() ${name}(${args}) end`, "save.lua",
        { target: TARGETS.md, builtins: { [name]: CORE.cartdata }, callbacks: CALLBACKS });
      assert.ok(!r.ok);
    }
  }
  const r = compile(`function _draw() cartdata("ANY-ID") end`, "save.lua",
    { target: TARGETS.md, builtins: { cartdata: { params: [["str", false]], ret: "void", c: "lc_save" } }, callbacks: CALLBACKS });
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.doesNotMatch(r.c, /md_cartdata\(/);
});

test("PICO map special preserves defaults and explicit layer masks", () => {
  const r = compile(`local __p8map=hexdata("0102")
    function _draw() map() map(1,2,3,4,5,6) map(1,2,3,4,5,6,0) map(1,2,3,4,5,6,3) end`, "map.lua",
    { target: TARGETS.md, builtins: CORE, callbacks: CALLBACKS });
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  for (const args of ["0, 0, 0, 0, 128, 64, -1", "1, 2, 3, 4, 5, 6, -1", "1, 2, 3, 4, 5, 6, 0", "1, 2, 3, 4, 5, 6, 3"]) {
    assert.ok(r.c.includes(`md_map(lcl___p8map, 128, ${args})`));
  }
});

test("PICO map access opts into runtime helpers without changing legacy reads", () => {
  const source = `local __p8map=hexdata("0102") function _draw() local n=mget(1,2) mset(3,4,5) end`;
  const opts = { target: TARGETS.md, builtins: CORE, callbacks: CALLBACKS };
  const r = compile(source, "map.lua", opts);
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.match(r.c, /md_mget\(lcl___p8map, 1, 2\)/);
  assert.match(r.c, /md_mset\(lcl___p8map, 3, 4, 5\)/);
  const legacy = compile(source, "map.lua", { ...opts, builtins: { ...CORE, mget: { ...CORE.mget, c: undefined } } });
  assert.ok(legacy.ok, JSON.stringify(legacy.diagnostics));
  assert.ok(legacy.c.includes("lcl___p8map[(2) * 128 + (1)]"));
  const custom = compile(source, "map.lua", { ...opts, builtins: { ...CORE, mget: { ...CORE.mget, c: "lc_p8_read" }, mset: { ...CORE.mset, c: "lc_p8_write" } } });
  assert.ok(custom.ok, JSON.stringify(custom.diagnostics));
  assert.match(custom.c, /md_p8_read\(lcl___p8map, 1, 2\)/);
  assert.match(custom.c, /md_p8_write\(lcl___p8map, 3, 4, 5\)/);
});

test("PICO flag specials distinguish whole bytes from bit access", () => {
  const r = compile(`function _draw() local a=fget(7) local b=fget(7,0)
    fset(7,255) fset(7,0,true) fset(7,1,false) end`, "flags.lua",
    { target: TARGETS.md, builtins: CORE, callbacks: CALLBACKS });
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  for (const call of ["md_fget(7, -1)", "md_fget(7, 0)", "md_fset(7, -1, 255)",
    "md_fset(7, 0, ((1) ? 1 : 0))", "md_fset(7, 1, ((0) ? 1 : 0))"]) assert.ok(r.c.includes(call), call);
});

test("banked blob readers retain their XL bank and renamed far-call stubs", () => {
  for (let bank = 6; bank <= 13; bank++) {
    const r = compile(`local data=hexdata("0102") local n=0
      function readbyte(i) return data[i] end
      function _update60() n=readbyte(1) end function _draw() end`, "bank.lua",
      { target: TARGETS.gametank, builtins: CORE, callbacks: CALLBACKS, banked: true,
        placement: { readbyte: `b${bank}`, _update60: "b0", _draw: "b1" } });
    assert.ok(r.ok, JSON.stringify(r.diagnostics));
    assert.ok(r.c.includes(`"B${bank}RODATA"`));
    assert.ok(r.c.includes(`"B${bank}CODE"`));
    assert.match(r.c, /gt_p0 = 1, stub_lcl_readbyte\(\)/);
    assert.match(r.stubs, /jsr gt_bank_raw/);
    assert.match(r.stubs, /lda gt_cur_bank/);
    assert.doesNotMatch(r.stubs, /\blc_/);
    assert.ok(r.stubs.includes(`lda #${bank}`));
  }
});

test("SDK emission hooks own API lowering and retain shared argument checks", () => {
  let emitted = 0;
  const paint = {
    params: [["int", false], ["flip", true]], ret: "void",
    emit(call, { argAt, cName }) {
      emitted++;
      return `${cName("lc_paint")}(${argAt(call, 0, "int", "0")}, ${argAt(call, 1, "flip", "1")})`;
    },
  };
  const opts = { target: TARGETS.md, builtins: { paint }, callbacks: CALLBACKS };
  const r = compile("function _draw() paint(3) paint(4,false) end", "hook.lua", opts);
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.match(r.c, /md_paint\(3, 1\)/);
  assert.match(r.c, /md_paint\(4, \(\(0\) \? 1 : 0\)\)/);
  assert.equal(emitted, 2);
  for (const args of ["", "1,true,3", "true"]) {
    assert.ok(!compile(`function _draw() paint(${args}) end`, "hook.lua", opts).ok);
  }
  assert.equal(emitted, 2, "invalid calls must not reach the SDK emitter");
});

test("SDK constant hooks fold only static numeric calls with valid arity", () => {
  const scale = { params: [["num", false]], ret: "fixed", c: "lc_scale",
    constEval: ([value], { num8 }) => value < 0 ? null : value / (num8 ? 4 : 2) };
  const opts = { target: TARGETS.md, builtins: { scale }, callbacks: CALLBACKS };
  for (const num8 of [false, true]) {
    const r = compile("local n=scale(3) function _draw() local v=scale(3) end", "fold.lua", { ...opts, num8 });
    assert.ok(r.ok, JSON.stringify(r.diagnostics));
    assert.ok(r.c.includes(num8 ? "int lcl_n = 192" : "long lcl_n = 98304L"));
    assert.match(r.c, /md_scale\(/, "runtime calls keep the SDK implementation");
  }
  for (const args of ["", "1,2", "true", "-1", "scale(-1)"]) {
    assert.ok(!compile(`local n=scale(${args}) function _draw() end`, "fold.lua", opts).ok);
  }
  for (const result of [NaN, Infinity, undefined, "1"]) {
    assert.ok(!compile("local n=scale(1) function _draw() end", "fold.lua",
      { ...opts, builtins: { scale: { ...scale, constEval: () => result } } }).ok);
  }
  assert.ok(!compile("local scale=1 local n=scale(3) function _draw() end", "fold.lua", opts).ok);
  assert.ok(!compile("local n=scale(3) function scale(x) return x end function _draw() end", "fold.lua", opts).ok);
});

test("runtimeDivision is opt-in and preserves native multiplication", () => {
  const source = `local a=1.5 local b=2.5 local r=0.0
    function _update() r=a/b r=a%b r=a*b r=a\\b end function _draw() end`;
  for (const enabled of [false, true]) {
    const target = { ...TARGETS.md, caps: { ...TARGETS.md.caps, runtimeDivision: enabled } };
    const result = compile(source, "division.lua", { target, builtins: CORE, callbacks: CALLBACKS });
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
    assert.equal(result.c.includes("md_fdiv("), enabled);
    assert.equal(result.c.includes("md_ffmod("), enabled);
    assert.equal(result.c.includes("md_ffdiv("), enabled);
    assert.match(result.c, /long long/);
    assert.doesNotMatch(result.c, /md_fmul\(/);
  }
});

test("exact maximum 16.16 literals are accepted without widening the range", () => {
  const opts = { target: TARGETS.md, builtins: CORE, callbacks: CALLBACKS };
  for (const value of ["32767.99998474121", "0x7fff.ffff"]) {
    const result = compile(`local x=${value} function _draw() end`, "max.lua", opts);
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
    assert.match(result.c, /2147483647L/);
  }
  for (const value of ["32767.99999", "32768"]) {
    assert.ok(!compile(`local x=${value} function _draw() end`, "max.lua", opts).ok);
  }
  // Hex is a signed bit pattern; 0x8000 intentionally denotes the minimum.
  assert.ok(compile("local x=0x8000 function _draw() end", "min.lua", opts).ok);
});

test("initializer overflow rejection is opt-in", () => {
  const opts = { target: TARGETS.md, builtins: CORE, callbacks: CALLBACKS };
  for (const value of ["32767+1", "array(2,32767+1)", "{1,32767+1}"]) {
    const source = `local x=${value} function _draw() end`;
    assert.ok(compile(source, "overflow.lua", opts).ok);
    const strict = compile(source, "overflow.lua", {...opts, rejectInitializerOverflow: true});
    assert.ok(!strict.ok);
    assert.match(strict.diagnostics.map(d=>d.message).join("\n"), /constant initializer is outside/);
  }
});

test("sdkName threads into diagnostics", () => {
  // assigning an undeclared global inside a function -> the sdkName message
  const r = compile(`function _update() y = 5 end\nfunction _draw() end`, "t.lua",
    { target: TARGETS.gba, sdkName: "gbalua", builtins: CORE, callbacks: CALLBACKS });
  assert.ok(!r.ok);
  assert.match(r.diagnostics.map(d => d.message).join("\n"), /gbalua has no implicit globals/);
});
