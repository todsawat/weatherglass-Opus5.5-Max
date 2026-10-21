> Engineering notes written for the parallel build of this version (lead + 10 sub-agents, each owning one `src/` file). Paths below match this repository: test tools live in `tools/`, the build writes `index.html`.

# Weatherglass — how the parts fit together

`BRIEF.md` is the product spec (what it must look like and do). This file is the engineering contract between the parts.
The page is one HTML file built from `src/`. Every `src/*.js` file becomes its own inline `<script>`, loaded in file-name order. three.js r160 is inlined as the global `THREE` (UMD build: only core classes, **no** examples/addons).

Read first, in this order: `src/10-core.js`, `src/20-world.js` (the shared weather state `WG.state` — every field is commented), `src/25-glsl.js` (materials), then skim `15-terrainfn.js`, `30-render.js`, `35-sky.js`, `40-terrain.js`, `65-clouds.js`.

## Rules

- **Write only your own file(s).** Never edit another part's file or the foundation (`10`–`40`, `65`, `90`, `00-shell.html`, `build.cjs`, `test/`). If the foundation is missing something or has a bug, work around it in your file and report it in your final message.
- Wrap your file in an IIFE with `'use strict'`. Register with `WG.register('<name>', { init(), update(dt, t) })`. Both run inside try/catch; **if one part fails the rest must keep running**, so guard every call into another part: `if (WG.water && WG.water.ring) WG.water.ring(x, z, s)`.
- Other parts may not exist while you work (they are being written in parallel) and may fail at run time. Never assume; always guard.
- No external images, models, fonts or audio files. Everything is generated in code. Canvas-drawn textures are fine.
- **Deterministic layout**: anything placed in the landscape uses `WG.util.rng(seed)` / `WG.util.hash`, never `Math.random()`. (`Math.random()` is fine for live behaviour: animal decisions, particle jitter, timing.)
- **Performance** (must run smoothly on a laptop and a phone): take every count from `WG.Q` (three detail levels, see `10-core.js`); use `InstancedMesh` / merged geometry; aim for ≤ ~15 draw calls for your part; no per-frame allocation in hot loops; no per-frame geometry rebuilds beyond small dynamic buffers. Lower levels reduce counts and smoothness but **never remove a feature**.
- Respect `WG.reducedMotion` (calm down decorative motion).
- Units and axes: x −6 (left) … +6 (right), z −4 (back wall) … +4 (front glass), y up. Lake surface rests at y 0.1 (`WG.state.lakeLevel` when risen), block underside −1.8, lid underside 7.4, plinth top −1.8, table −3.0. Constants in `WG.C`.
- Colours given in the brief as hex are sRGB. `new THREE.Color(0x8a6440)` / `WG.util.hex()` converts to the linear working space. Colours "as they appear on screen" in the brief are the look after lighting and grading, not albedos.

## Drawing things

```js
const mat = WG.mat.lit({            // lit by the shared sun/moon, sky, studio fill, lightning; receives cast + cloud shadows
  name, uniforms: { uFoo: { value: 1 } }, vertexColors: true, side: THREE.DoubleSide,
  weather: true,                    // rain darkens and glosses it, snow settles on up-facing parts, frost whitens (driven by the ground-state texture at its xz)
  env: 'sky' | 'studio' | 'none',   // what glossy parts reflect: the air inside the case (default) or the studio softboxes (use for brass, plinth, glass)
  vertexDecl, vertexLocal,          // GLSL; vertexLocal edits `pos`/`nrm` in object space (before instancing)
  vertexWorld,                      // edits `w` (vec4 world position) and `wn` (world normal): wind sway goes here
  vertexEnd,                        // after gl_Position is set (e.g. gl_PointSize)
  fragDecl, frag,                   // frag sets: albedo, rough, spec, metal, N, ao, emissive, alpha, trans (0..1 leaf translucency), wetK, snowK, shadowK. Available: P (world pos), V (to camera), vUv, vCol (vertex/instance colour), vN
  fragPost,                         // after lighting: adjust `col`
  depthFrag,                        // shadow pass fragment code, e.g. alpha-test discard (needs fragDecl for its varyings)
  transparent, additive, premultiplied, depthWrite, depthTest, shadow: false,
});
const mat2 = WG.mat.unlit({...});    // same plumbing, but your `frag` writes `col` (linear HDR) and `alpha` itself
WG.add(mesh, { pass: 'A' | 'B', shadow: true, reflect: true, order: n, parent });
```

- **Always build materials with `WG.mat.lit` / `WG.mat.unlit`** (they are `THREE.ShaderMaterial`s). The scene buffer's alpha channel stores distance-from-camera for the air/cloud pass; these builders write it correctly (opaque) or leave it untouched (transparent). Stock three materials (`MeshStandardMaterial` etc.) would corrupt it and are not lit by the scene's lights — do not use them.
- GLSL is written WebGL1-style (`varying`, `texture2D`, `gl_FragColor`) but compiles as GLSL ES 3.0, so `dFdx`, int loops, const arrays, `texelFetch` all work. Instancing (`instanceMatrix`, `instanceColor`) and vertex colours are handled by the builder; `vCol` carries them.
- Shared GLSL available in every material (see `25-glsl.js`): `wgNoise(vec2)`, `wgFbm`, `wgNoise3(vec3)`, `wgHash`, `wgHash2`, `wgIGN`, `wgUV(xz)` (world xz → 0..1 over the floor), `wgWindAt(vec3 worldPos)` → local wind velocity xz (breeze + travelling gust waves + wind-tool gusts), `wgGround(xz)` → `(wet, snow, frost, rainLandingNow)`, `wgHeight(xz)` → land height, `wgShadow`, `wgCloudShadow`, `wgStudio(R, rough)`, `wgSkyEnv(R)`, `wgBump(P, N, h, k)`, `wgCaustic(uv, t)`, `wgRings(p, t)` (raindrop rings), and all uniforms in `WG.G` (`uTime, uSunDir, uSunCol, uSkyCol, uGndCol, uEnvCol, uRoomCol, uStudio(softbox, night, storm, golden), uFlashCol, uFlashPos, uWind(dx, dz, speed, phase), uSeason, uSeasonW(spring, summer, autumn, winter), uLake(level, ice, turbidity, flow), uAir(temp, humidity, storm, rain), uGrassA, uGrassB, uCloudMap, uReflTex/uReflMat/uReflOn, uMask1/uMask2, uNoiseTex, uRes`).
- **Passes.** Pass `'A'` (default) is everything drawn before the air: land, objects, water, far glass, stars. Then the air (haze, fog, clouds, rain shafts) is composited using the distance stored by pass A. Pass `'B'` is drawn after it: the near glass panes, rain/snow/sparks, lightning bolts — things that must sit in front of the fog and clouds. Pass B shares pass A's depth buffer (occlusion by solid things works). You can move an object between passes each frame with `WG.setPass(obj, 'A'|'B')`.
- `shadow: true` makes a mesh cast into the shared shadow map (the builder made a matching depth material, including your vertex code). Grass and tiny things should not cast.
- `reflect: true` shows the object in the lake's planar mirror image (highest detail level only; keep it to the big things: trees, cabin, rocks).
- Emissive / glowing things: write HDR values (> 1) — bloom picks up anything brighter than ~1. Lit windows ≈ 3–6, sparks 5–20, lightning 20–60.
- The camera: `WG.camera` (three), `WG.cam` rig: `cam.pos`, `cam.right`, `cam.up`, `cam.fwd`, `cam.project(x,y,z,out)` → css px + `nx` −1..1, `cam.panOf(x,y,z)` → −1..1 (for stereo panning), `cam.ray(cssX, cssY)` → `{o, d}`, `cam.orbit(dAz, dEl)`, `cam.dolly(f)`, `cam.pan(dx, dy)`, `cam.shake(a)`, `cam.idle` (seconds since last camera input; reset it to 0 on any pointer input).

## The land (`WG.terrain`, `WG.layout`)

`T.height(x,z)`, `T.normal(x,z,out)`, `T.up(x,z)` (normal.y), `T.lakeR(x,z)` (<1 in the lake), `T.riverInfo(x,z)` → `{d, s (0 pool … 1 lake), y (water surface), w (width), side, steep}`, `T.riverAt(s)`, `T.waterAt(x,z)` → `'lake'|'river'|'pool'|null`, `T.waterY(x,z)`, `T.rayHit(ox,oy,oz, dx,dy,dz, stopAtWater)` → distance or −1, `T.grassDensity(x,z)`, `T.waterDist(x,z)`, `T.path/bare/sand/mud/riverBed/shade/rock/hollow(x,z)` 0..1, `T.inside(x,z,margin)`.
`WG.layout`: `lake`, `fall {x, zLip, yTop, yPool, width, springX, springZ}`, `pool {x,z,r,y}`, `river {pts:[{x,z,y,w,s,tx,tz,steep}], len, sShore}`, `cabin {x,z,rot,len,dep,ridge,padY}`, `jetty {x0,z0,x1,z1,dx,dz,len,width}`, `boat {x,z,len}`, `boulders [{x,z,r,seed}]` (the six big ones), `stones [{x,z,y,r,seed}]` (stepping stones), `paths`, `trees [{id, kind:'pine'|'spruce'|'oak'|'birch'|'cherry', x, y, z, h, r (crown radius), seed, blue?}]` (already trimmed to the detail level).
`WG.perches` — push `{x, y, z, sheltered: bool, kind}` for places birds can land (tree tops, inside crowns, cabin ridge, chimney, fence posts, jetty posts, under the porch eave).

## The weather (`WG.state` = S, `WG.world` = W)

Read anything in `S` (see `20-world.js`). Key fields: `time` (h), `season` (0 spring … 4), `seasonName`, `sunDir`, `moonDir`, `sunPos`, `moonPos`, `sunUp`, `sunI`, `night`, `golden`, `dusk`, `temp`, `humidity`, `cover`, `storm`, `rain`, `snowing`, `wind {dx, dz, speed, phase}`, `wetAvg`, `snowAvg`, `frostAvg`, `fogAvg`, `lakeLevel`, `lakeRise`, `ice`, `riverIce`, `fallIce`, `flow`, `turbid`, `mist[5]`, `paneRain[5]`, `glassFrost`, `flash`, `flashPos`, `phrase`, `foliage`, `rainbow`.
Pane order everywhere: `0` front (+z), `1` back (−z), `2` left (−x), `3` right (+x), `4` lid.
`W.tempAt(y)` (5° colder per unit of height), `W.snowLine()`, `W.wetAt/snowAt/frostAt/rainAt/fogAt(x,z)`, `W.windAt(x,z,out)` → `{x,z}` units/s, `W.bySeason(spring, summer, autumn, winter)`, `W.deposit(x,z,kind,mass)` (precipitation landing), `W.addFog(x,z,amount,radius)`, `W.gust(x,z,vx,vz,radius)`, `W.sunDirAt(time,out)`, `W.moonDirAt`, `W.orbit(dir,out)`.
Control: `WG.api.setTime(h, glide)`, `nudgeTime(dh)`, `togglePlay()`, `setSeason(s, glide)`, `nudgeSeason(d)`, `nextSeason()`, `setTool(name)` / `api.tool` (`'hand'|'wind'|'cloud'|'fog'|'wipe'`), `toggleSound()` / `api.soundOn`, `toggleUI()` / `api.uiHidden`, `fullscreen()`.
`WG.sky`: `sunScreen`, `moonScreen` (`{x,y,z}` css px), `hover` / `grab` (set to `'sun'|'moon'|null` to make the body swell), `starVis`, `keyIsMoon`.
Clouds (`WG.clouds`, see `65-clouds.js`): `list` of `{id, x,y,z, vx,vz, R, baseY, rain (0..1 what it is letting go now), alpha, dark, storm, stormK, water, vol, lobes:[{x,y,z3,wr}]}`, `pick(o,d)`, `grab(c,hit)`, `dragTo(o,d)`, `release()`, `held`, `hover`, `wheelSqueeze(c, amount)`, `spawn({x,y,z,vol,water})`, `feed(c,dt)`, `paint(c,x,y,z)`, `strike(c)`.

## Who provides what (each is a guarded optional for everyone else)

| File (register name) | `WG.` | Must expose |
|---|---|---|
| `45-glass.js` (`glass`) | `glass` | `glass.wipeRay(o, d, radius)` → `{pane, x,y,z}`/null (wipes mist at the first pane the ray meets that is still misted there: the near pane, else the far one through it; emits `glass:wipe`, with `first: true` the very first time); `glass.tapRay(o, d)` → `{pane, x,y,z}`/null (two rings ripple from the point, the pane shivers; emits `glass:tap`); `glass.hitRay(o,d)` → `{pane,x,y,z,t}`/null without side effects; `glass.mistAt(pane, x,y,z)` 0..1 |
| `46-studio.js` (`studio`) | `gauge`, `studio` | brass frame, plinth, plaque, gauge, table, backdrop. `gauge.hit(o,d)` → bool, `gauge.tap()` (needles jump; emits `gauge:tap`) |
| `48-water.js` (`water`) | `water` | `splash(x, z, strength 0..1)` (crown, jet, mist, rings; on the frozen lake a star of cracks; emits `splash` or `ice:crack`; also call `WG.fauna.scatterFish`), `ring(x, z, size)` (one raindrop ring; cheap, may be called hundreds of times a second), `wake(x, z, dx, dz)`, `surfaceY(x,z)` |
| `50-props.js` (`props`) | `props` | cabin, smoke, jetty, boat, rocks, stepping stones. `props.boat.rock(strength)`, `props.chimneyTop {x,y,z}`; pushes perches |
| `55-trees.js` (`trees`) | `flora` | `flora.trees` (live list with sway state), `pickTree(o,d)` → `{tree, t, x,y,z}`/null, `grabTree(tree, hit)`, `pullTree(o,d)`, `releaseTree()`, `flickTree(tree, dx, dz)`, `hoverTree(tree|null)`, `shakeAt(x, z, strength, radius)`, `tallestNear(x, z, radius)` → `{x, y (top), z, tree}`/null; falling leaves/petals; pushes perches |
| `57-meadow.js` (`meadow`) | `meadow` | grass, wildflowers, reeds, lily pads, bushes-free ground cover |
| `60-fauna.js` (`fauna`) | `fauna` | `flush(x,y,z)` (birds take off), `scatterFish(x,z)`, `scatterInsects(x,z,r)` |
| `70-precip.js` (`precip`) | `precip` | rain, snow, hail, splashes, lightning; listens for `cloud:strike`, emits `lightning` |
| `75-audio.js` (`audio`) | `audio` | `start()` (call from the first user gesture), `cont(name, level 0..1, pan −1..1)` for sounds that last while something is held (`'squeeze' | 'charge' | 'wipe' | 'windsweep'`; call every frame while active, it fades by itself when the calls stop), `one(name, {pan, level, pitch, size})` for one-shots (`'tick' | 'tink' | 'pop' | 'chime' | 'whoosh' | 'drip'`); listens to the events below for everything else |
| `80-ui.js` + `src/ui.css` (`ui`) | `ui` | the DOM interface inside `#wg-ui`; `ui.hint(text)`; `ui.isOver(clientX, clientY)` |
| `85-interact.js` (`interact`) | `interact` | pointer, touch and keyboard: tools, picking, camera gestures, cursors, wind wisps, fog puffs |

### Case dimensions (shared by glass and studio)
- Wall panes: inner faces on x = ±6 and z = ±4, outer faces at ±6.07 / ±4.07, from y −1.8 to 7.4. Lid slab: y 7.4 … 7.58, reaching x ±6.17, z ±4.17 (overhangs the walls), bevelled rim.
- Brass corner posts: round, radius 0.09, centred at (±6.13, ±4.13), from the plinth top (y −1.8) to y 7.66, a small ball finial (r ≈ 0.075) above at y ≈ 7.8. Top rail: a flat band 0.24 tall (y 7.16 … 7.4) wrapped round the outside of the walls (0.035 proud of the glass). Shoe rail: 0.45 tall (y −1.8 … −1.35), same. Lid knob: 0.3 tall in the lid centre, standing on y 7.58.
- Plinth: top at y −1.8, footprint x ±6.62, z ±4.62, height 1.2 (down to the table at y −3.0); the front frieze faces +z.

## Events (`WG.bus.on(name, fn)`, `WG.bus.emit(name, data)`)

`ready` · `resize {w,h}` · `tool {tool}` · `sound {on}` · `ui:hidden {hidden}` · `play {playing}` · `phrase {phrase}` · `season:name {name,index}` · `season:arrived` · `season:turn` (the user turned the dial) · `time:scrub`
`cloud:pop {x,y,z,pan}` · `cloud:grab {cloud,size,pan}` · `cloud:dragged` · `cloud:release {speed,pan}` · `cloud:merge {size,x,y,z,pan}` · `cloud:bounce {speed,pan}` · `cloud:rain` (squeezed until it rains) · `cloud:storm` · `cloud:strike {cloud,power}` (a bolt is wanted from this cloud)
`lightning {x,y,z, power, cloud, target:'tree'|'ground'|'lake', tree, dist, pan}` (a bolt has struck at x,y,z) · `rainbow`
`splash {x,y,z,size,pan,kind}` · `ice:crack {x,z,pan}` · `drip {pan}`
`glass:tap {pane,x,y,z,pan}` · `glass:wipe {pane, speed, pan, first}` · `gauge:tap`
`wind:sweep {x,z,speed,pan}` · `fog:pour {x,z,pan}` · `tree:grab {tree,pan}` · `tree:release {tree,pan,strength}` · `tree:flick {tree,pan}`
`sun:hover` / `moon:hover` (first time the pointer passes over each) · `sun:grab {body}` · `sun:drag {body}` (the user changed the time by dragging) · `scene:click {x,y}`
Emit the ones that belong to your part; listen to whichever you need. `pan` is `WG.cam.panOf(x,y,z)`.

## Building and checking your work

```bash
node --check src/<your file>.js                 # syntax
node build.cjs                                  # builds index.html
node tools/shot.cjs "<query>" shots/<tag>-1.png [w] [h] [seconds] ["js"]   # paused page: simulate N seconds, run js, draw one frame, screenshot
node tools/run.cjs test/<tag>-script.cjs "<query>" [w] [h]                # live page with a Playwright `page` for mouse/keyboard tests
node tools/px.cjs shots/x.png 400,300 [x,y ...]   # read pixel colours
```

Query flags: `scenario=calm|rain|storm|snow|mountainsnow|fog|autumn|night|dusk`, `q=0|1|2` (detail level; the test browser is software-rendered and auto-detects as 0 — pass `q=1` or `q=2` to check the higher looks), `only=a,b` (run only these parts plus the foundation: world, sky, terrain, camera — much faster; e.g. `only=flora` or `only=flora,clouds`), `skip=a,b`, `t=<hours>`, `season=<0..4>`, `novol=1` (no air/cloud pass), `nopost=1`, `debug=1` (report shader compile errors — always use it), `paused=1`.
In the `js` argument: `WG.debug.cam(azDeg, elDeg, zoom, tx, ty, tz)` places the camera (opening view is `22, 25, 1`; zoom < 1 is closer), `WG.debug.step(seconds)` advances the simulation, and you can poke state directly (`WG.state.temp = -5`, `WG.api.setSeason(2)`, `WG.clouds.list[0].auto = 1`…).
The test machine has 2 cores shared with other workers: keep screenshots small (800×500), prefer `only=`, and look at each screenshot you take (Read the PNG) — judge the look against the brief, not just the absence of errors. `shot.cjs` prints `errors` and `modules` (parts that failed); both must be empty.
