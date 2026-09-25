/**
 * 🎬 엔드카드 — ***Affinity 가 «벡터로» 짠 판.*** ffmpeg 자막이 아니다.
 *
 * 대표 2026-09-22: *"2번으로 더 화려하게 만드는 것으로 보여주세요"*
 *
 * ⛔ ffmpeg 로는 «원리상» 안 되는 것만 여기서 한다:
 *   ① 선형 그라디언트 배경            ② 벡터 마크(겹친 도형 + 블렌드모드)
 *   ③ 자간·정렬을 제어한 타이포        ④ 가우시안 블러 글로우
 *   ⇒ 그리고 ***편집 가능한 문서가 남는다*** — 자막은 픽셀에 구우면 끝이다.
 *
 * ⛔ 설정은 `__CFG__` 로 «박아» 넣는다(파일 읽기 안 함 — 실패 종류를 줄인다).
 * ⛔ API 이름은 «지어내지 않았다» — `~/docs/ref/affinity-sdk` 원문에서 읽었다.
 */
const CFG = __CFG__;

const { Document, NewDocumentOptions, FileExportOptions, FileExportArea } = require('/document.js');
const { UnitType } = require('/units.js');
const { AddChildNodesCommandBuilder, DocumentCommand } = require('/commands.js');
const { Rectangle, Transform } = require('/geometry.js');
const { Selection } = require('/selections.js');
const { ShapeNodeDefinition, FrameTextNodeDefinition } = require('/nodes.js');
const { ShapeRectangle, ShapeEllipse } = require('/shapes.js');
const { LineStyleDescriptor } = require('/linestyle.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAtts } = require('/glyphatts.js');
const { ParagraphAtts, ParagraphAlignXType } = require('/paragraphatts.js');
const { Colour } = require('/colours.js');
const { SolidFill, FillDescriptor } = require('/fills.js');

const W = CFG.width, H = CFG.height;

const opts = NewDocumentOptions.createDefault();
opts.units = UnitType.Pixel;
opts.width = W; opts.height = H;
if (W > H) opts.isLandscape = true;
const doc = Document.createFromOptions(opts);
const spread = doc.spreads.toArray()[0];

// ⛔ `create()` 는 «FillDescriptor» 를 받는다 — SolidFill 을 그대로 넘기면 거부한다(매뉴얼 §5).
const rgb = (r, g, b, a) => FillDescriptor.createSolid(
  SolidFill.create(Colour.createRGBA8([r, g, b, a === undefined ? 255 : a])));

const kids = () => spread.children.toArray();
function add(def) {
  const before = kids().length;
  const b = AddChildNodesCommandBuilder.create();
  b.addNode(def);
  doc.executeCommand(b.createCommand(false), false);
  const after = kids();
  if (after.length <= before) throw new Error('노드가 «안 늘었다»');
  return after[after.length - 1];
}
const sel = (n) => Selection.create(doc, [n], true);
function blur(node, r) {
  if (!(r > 0)) return;
  doc.executeCommand(DocumentCommand.createSetGaussianBlurLayerEffectRadius(sel(node), r, true));
}
function opacity(node, v) {
  if (v >= 1) return;
  doc.executeCommand(DocumentCommand.createSetOpacity(sel(node), v));
}

// ── ① 배경 — «층을 쌓아» 그라디언트를 만든다 ─────────────────────────
//   ⛔ GradientFill 은 변환까지 물려야 하고 SDK 힌트가 *"불안정하다"* 고 적었다(매뉴얼 §5).
//   ⇒ ***되는 길로 간다*** — 얇은 띠를 겹쳐 쌓으면 같은 결과를 «확실하게» 얻는다.
//     🔑 화려함은 「어려운 API 를 쓴 것」이 아니라 「나온 그림」이다.
const BANDS = 48;
for (let i = 0; i < BANDS; i++) {
  const t = i / (BANDS - 1);
  const y = (H / BANDS) * i;
  // 위는 깊은 남색, 아래는 거의 검정 — 가운데가 살짝 푸르다
  const r = Math.round(8 + 12 * (1 - t));
  const g = Math.round(14 + 26 * (1 - t) + 10 * Math.sin(Math.PI * t));
  const b = Math.round(30 + 58 * (1 - t) + 18 * Math.sin(Math.PI * t));
  add(ShapeNodeDefinition.create(ShapeRectangle.create(),
    new Rectangle(0, y - 1, W, H / BANDS + 2), rgb(r, g, b), null, null, null));
}

const cx = W / 2, cy = H * 0.295;

// ── ② 격자 — 영화의 «시각 언어»(진단 그리드)를 카드에도 잇는다 ────────
//   ⛔ ffmpeg 로는 이런 «구조»를 못 만든다. 여기가 벡터를 쓰는 이유다.
const GRID = 14, gw = Math.max(1, W * 0.0009);
for (let i = 0; i <= GRID; i++) {
  const t = i / GRID;
  const gv = add(ShapeNodeDefinition.create(ShapeRectangle.create(),
    new Rectangle(W * t, H * 0.06, gw, H * 0.50), rgb(70, 110, 175), null, null, null));
  opacity(gv, 0.13 - 0.07 * Math.abs(t - 0.5) * 2);
}
for (let i = 0; i <= 9; i++) {
  const t = i / 9;
  const gh = add(ShapeNodeDefinition.create(ShapeRectangle.create(),
    new Rectangle(0, H * (0.06 + 0.50 * t), W, gw), rgb(70, 110, 175), null, null, null));
  opacity(gh, 0.13 - 0.07 * Math.abs(t - 0.5) * 2);
}

// ── ③ 빛살 — 중심에서 뻗는 가는 막대를 «돌려» 박는다 ──────────────────
const RAYS = 24, rayL = W * 0.62, rayW = Math.max(1, W * 0.0022);
for (let i = 0; i < RAYS; i++) {
  const a = (Math.PI * 2 * i) / RAYS;
  const n = add(ShapeNodeDefinition.create(ShapeRectangle.create(),
    new Rectangle(cx - rayW / 2, cy - rayL, rayW, rayL), rgb(120, 180, 255), null, null, null));
  const bb = n.getSpreadBaseBox();
  doc.executeCommand(DocumentCommand.createTransform(sel(n),
    Transform.createTranslate(cx, cy).multiply(Transform.createRotate(a))
      .multiply(Transform.createTranslate(-cx, -cy))));
  opacity(n, i % 3 === 0 ? 0.22 : 0.10);
  blur(n, Math.round(W * 0.004));
}

// ── ④ 글로우 두 겹 — 색을 달리해 «깊이»를 만든다 ──────────────────────
for (const g of [{ r: 0.62, c: [30, 80, 200], o: 0.45, b: 0.17 },
                 { r: 0.34, c: [90, 165, 255], o: 0.60, b: 0.10 }]) {
  const R = W * g.r;
  const n = add(ShapeNodeDefinition.create(ShapeEllipse.create(),
    new Rectangle(cx - R / 2, cy - R / 2, R, R), rgb(g.c[0], g.c[1], g.c[2]), null, null, null));
  blur(n, Math.round(W * g.b));
  opacity(n, g.o);
}

// ── ⑤ 동심 링 — «테두리만» 있는 원(brushFill=null · lineFill 로) ──────
//   ⛔ create(shape, rect, brushFill, lineFill, lineStyle, transparencyFill) — 인자 순서를 지어내지 않았다.
for (const k of [0.30, 0.42, 0.56]) {
  const R = W * k;
  const n = add(ShapeNodeDefinition.create(ShapeEllipse.create(),
    new Rectangle(cx - R / 2, cy - R / 2, R, R),
    null, rgb(130, 180, 255), LineStyleDescriptor.createDefault(Math.max(1, W * 0.0016)), null));
  opacity(n, 0.30 - 0.07 * (k * 2));
}

// ── ⑥ 벡터 마크 — «다이아몬드»는 SDK 에 이미 있다(회전으로 만들지 않는다) ─
//   📏 `Shape.createDiamond(rc)` 를 로컬 SDK 덤프에서 찾았다 — 내 회전 코드는 «재발명»이었다.
const s = W * 0.125;
const MARK = [
  { dx: 0,       dy: -s * 0.58, sc: 1.00, c: [150, 200, 255], o: 0.95 },
  { dx: -s * 0.52, dy: s * 0.32, sc: 0.84, c: [70, 145, 255], o: 0.88 },
  { dx: s * 0.52,  dy: s * 0.32, sc: 0.84, c: [225, 240, 255], o: 0.78 },
  { dx: 0,        dy: s * 0.08, sc: 0.56, c: [255, 255, 255], o: 1.00 },
];
for (const m of MARK) {
  const rc = new Rectangle(cx + m.dx - s * m.sc / 2, cy + m.dy - s * m.sc / 2, s * m.sc, s * m.sc);
  let def;
  try {
    const { Shape } = require('/shapes.js');
    def = ShapeNodeDefinition.create(Shape.createDiamond(rc), rc,
      rgb(m.c[0], m.c[1], m.c[2]), null, null, null);
  } catch (e) {
    // ⛔ 없으면 «되는 길»로 — 사각형을 45° 돌린다(결과가 같다).
    def = ShapeNodeDefinition.create(ShapeRectangle.create(), rc,
      rgb(m.c[0], m.c[1], m.c[2]), null, null, null);
  }
  const n = add(def);
  if (!def.isDiamond) {
    const bb = n.getSpreadBaseBox();
    const px = bb.x + bb.width / 2, py = bb.y + bb.height / 2;
    doc.executeCommand(DocumentCommand.createTransform(sel(n),
      Transform.createTranslate(px, py).multiply(Transform.createRotate(Math.PI / 4))
        .multiply(Transform.createTranslate(-px, -py))));
  }
  opacity(n, m.o);
}

// ── ⑦ 모서리 표식 — 인쇄물의 «크롭 마크» 어법을 빌린다 ────────────────
const cm = W * 0.045, ct = Math.max(1, W * 0.0018), pad = W * 0.055;
for (const [x, y, sx, sy] of [[pad, pad, 1, 1], [W - pad, pad, -1, 1],
                              [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]]) {
  for (const [w, h] of [[cm, ct], [ct, cm]]) {
    const n = add(ShapeNodeDefinition.create(ShapeRectangle.create(),
      new Rectangle(sx > 0 ? x : x - w, sy > 0 ? y : y - h, w, h),
      rgb(120, 155, 200), null, null, null));
    opacity(n, 0.45);
  }
}

// ── ④ 타이포 ────────────────────────────────────────────────────────
/**
 * ⛔⭐⭐ ***`height` 는 «픽셀»이 아니라 «배수»다*** — 기본값이 `1` 이다(객체에 물어 확인).
 *   🩸 1판은 `g.height = Math.round(W * 0.082)` = **88** 을 넣었다 ⇒ 88배.
 *     글자가 한 줄에 «하나씩» 떨어지며 화면이 무너졌다.
 *   ⊕ `characterSpacing` 도 같은 축이다(기본 0) — 픽셀로 넣으면 글자가 흩어진다.
 *   🔑 ***「이름이 height 니 픽셀이겠지」가 틀렸다.*** 기본값을 물어보면 한 번에 갈린다.
 * ⊕ 정렬은 `ParagraphAlignXType.Centre`(= {value:1}) — 숫자 1 을 «날것으로» 넣지 않는다.
 */
function text(str, yFrac, mult, colour, spacing, boxH) {
  const sb = StoryBuilder.create();
  sb.setToFrameTextDefaultStyle(doc.dpi, doc.rasterFormat);
  const g = GlyphAtts.create();
  g.height = mult;
  g.characterSpacing = spacing === undefined ? 0 : spacing;
  g.brushFill = rgb(colour[0], colour[1], colour[2]);
  sb.setGlyphAtts(g);
  const p = ParagraphAtts.create();
  p.alignXType = ParagraphAlignXType.Centre;
  sb.setParagraphAtts(p);
  sb.addText(str);
  return add(FrameTextNodeDefinition.createFromStoryBuilder(
    new Rectangle(W * 0.06, H * yFrac, W * 0.88, H * (boxH === undefined ? 0.07 : boxH)), sb));
}

// 📏 배수↔픽셀을 «두 번 재서» 맞췄다 — 2.2 ⇒ 9px · 22 ⇒ 28px ⇒ 1배 ≈ 1.27px.
//   ⇒ 제목 88px ≈ 69 · 부제 34px ≈ 27 · 하단 22px ≈ 17
//   ⛔ 「이름이 height 니 픽셀이겠지」로 «두 번» 틀렸다(88배 · 2.2배).
//     🔑 ***단위를 모르면 두 점을 재서 «기울기»를 얻는다.*** 짐작으로 세 번째를 쓰지 않는다.
text(CFG.title,   0.560, 69,  [245, 250, 255], 0.03, 0.075);
text(CFG.tagline, 0.645, 27,  [150, 180, 220], 0.08, 0.045);

// 얇은 선 — 타이포와 하단 정보를 가른다
add(ShapeNodeDefinition.create(ShapeRectangle.create(),
  new Rectangle(W * 0.42, H * 0.705, W * 0.16, Math.max(1, W * 0.0018)),
  rgb(90, 130, 190), null, null, null));

text(CFG.footer, 0.735, 17, [120, 152, 190], 0.14, 0.040);

// ── 내보낸다 ────────────────────────────────────────────────────────
const names = FileExportOptions.allPresetNames;
const pick = names.find(function (n) { return /png/i.test(n); }) || names[0];
doc.export(CFG.out, FileExportOptions.createWithPresetName(pick), FileExportArea.createForCurrentSpread());
console.log('엔드카드 ✅ ' + CFG.out + '  (' + W + 'x' + H + ' · 노드 ' + kids().length + '개)');
