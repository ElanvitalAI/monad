/**
 * 🖼️ 비율 리프레임 — ***자르지도 검은 띠도 아니게, 「내용을 늘려서」 채운다.***
 *
 * 대표 2026-09-22: *"생성된 이미지가 비율대로 안나오기때문에 … 다양한 기법으로 편집"*
 *
 * ⛔ 종전 파이프라인의 셋은 전부 «내용을 못 만든다»:
 *     scale=decrease + pad=black → 검은 띠 · boxblur → 가짜 배경 · crop → 잘라낸다
 *
 * 📐 기법 «셋» (아래로 갈수록 위에 얹힌다):
 *   ① 커버 배경   원본을 «덮도록» 키워 깔고 ***가우시안 블러*** — 색·명암이 원본에서 온다
 *   ② 거울 확장   모자란 쪽에 ***원본을 뒤집어*** 이어 붙인다 — 구조가 이어져 «늘어난 것»처럼 보인다
 *   ③ 원본       한 픽셀도 안 잘리게 «맞춰» 가운데 얹는다
 *
 * ⛔⭐ 설정은 ***이 파일 위쪽에 «박혀서» 들어온다***(`__CFG__` 치환). 파일 읽기를 «안 한다» —
 *   `/fs.js` 를 거치면 실패 종류가 늘고, 그 실패가 「스크립트가 틀렸다」와 구별이 안 된다.
 */
const CFG = __CFG__;

const { Document, NewDocumentOptions, FileExportOptions, FileExportArea } = require('/document.js');
const { UnitType } = require('/units.js');
const { Bitmap } = require('/rasterobject.js');
const { ImageNodeDefinition } = require('/nodes.js');
const { AddChildNodesCommandBuilder, DocumentCommand } = require('/commands.js');
const { Transform } = require('/geometry.js');
const { Selection } = require('/selections.js');   // ⛔ `selection.js` 가 «아니다» — 복수형

const W = CFG.width, H = CFG.height;
const BLUR = CFG.blur === undefined ? 40 : CFG.blur;
// ⛔ 거울 띠는 «형태를 지워야» 한다 — 배경보다 더 세게 흐리고 더 투명하게.
const MIRROR_BLUR = CFG.mirrorBlur === undefined ? BLUR * 1.5 : CFG.mirrorBlur;
const MIRROR_OPACITY = CFG.mirrorOpacity === undefined ? 0.55 : CFG.mirrorOpacity;

// ── 목표 비율의 문서 ──────────────────────────────────────────────────
const opts = NewDocumentOptions.createDefault();
opts.units = UnitType.Pixel;          // ⛔ 단수형 — 복수형은 거부된다
opts.width = W;
opts.height = H;
if (W > H) opts.isLandscape = true;   // ⛔ 안 주면 치수가 «뒤바뀐다»
const doc = Document.createFromOptions(opts);   // ⛔ current 가 «안 된다» — 반환값을 쓴다

const bm = Bitmap.loadFromFile(CFG.src);
const SW = bm.width, SH = bm.height;
console.log('src ' + SW + 'x' + SH + '  →  target ' + W + 'x' + H);

const spread = doc.spreads.toArray()[0];
// ⛔ 멤버 이름을 «짐작하지 않았다» — 객체에 직접 물어서 얻었다(introspection).
//   🩸 1판은 `getChildNodes()`·`childNodes` 를 썼고 ***둘 다 undefined*** 였다.
//      실제 이름은 `children`(⊕ `firstChild`·`lastChild`·`getFirstChild()`).
//   🔑 ***SDK 힌트는 「쓰는 법」을 알려주지만 「이 빌드의 «이름»」은 객체가 안다.***
const kidsOf = function () {
  const c = spread.children;
  if (!c) throw new Error('spread.children 이 «없다» — 이 빌드의 멤버 이름을 다시 재라');
  return c.toArray ? c.toArray() : c;
};

/** 원본을 한 장 놓고 «그 노드»를 돌려준다. */
function place() {
  const before = kidsOf().length;
  const d = ImageNodeDefinition.create(bm.format);
  d.bitmap = bm;
  const b = AddChildNodesCommandBuilder.create();
  b.addNode(d);
  doc.executeCommand(b.createCommand(false), false);
  const after = kidsOf();
  if (after.length <= before) throw new Error('노드가 «안 늘었다» — 배치 실패');
  return after[after.length - 1];
}

/**
 * ⛔ 이 빌드의 «경계» 이름은 `getSpreadBaseBox()` 다.
 *   🩸 1판은 `getBoundsInSpread()`·`boundsInSpread` 를 썼고 ***둘 다 undefined*** 였다(내가 지어낸 이름).
 *   📏 객체에 물어 얻은 실제 후보: getSpreadBaseBox · getExactSpreadBaseBox · getLocalVisibleBox …
 *      갓 놓은 1024² 이미지에 대고 넷 다 `{x:0,y:0,w:1024,h:1024}` 로 «같은» 답을 냈다.
 *   ⇒ 그중 «스프레드 좌표계»를 이름에 담은 `getSpreadBaseBox` 를 쓴다(우리가 배치하는 좌표계와 같다).
 */
function boundsOf(node) {
  const b = node.getSpreadBaseBox();
  if (!b || !(b.width > 0) || !(b.height > 0)) {
    throw new Error('노드의 경계를 «못 쟀다» — ' + JSON.stringify(b));
  }
  return b;
}

/**
 * 노드를 (x,y,w,h) 에 앉힌다. w·h 가 음수면 그 축으로 «뒤집는다».
 * ⛔ 현재 위치를 «재서» 원점으로 보낸 뒤 스케일한다 — 현재 위치를 0 이라 가정하면 누적해서 어긋난다.
 */
function fit(node, x, y, w, h) {
  const bb = boundsOf(node);
  const sx = w / bb.width, sy = h / bb.height;
  const xf = Transform.createTranslate(x, y)
    .multiply(Transform.createScale(sx, sy))
    .multiply(Transform.createTranslate(-bb.x, -bb.y));
  doc.executeCommand(DocumentCommand.createTransform(Selection.create(doc, [node], true), xf));
}

/** 노드에 가우시안 블러를 «켜면서» 건다. ⛔ 반경 0 이면 «안 건다». */
function blur(node, radius) {
  if (!(radius > 0)) return;
  doc.executeCommand(DocumentCommand.createSetGaussianBlurLayerEffectRadius(
    Selection.create(doc, [node], true), radius, true));
}

/** 노드 불투명도(0~1). ⛔ 1 이면 «안 건다» — 불필요한 명령은 되돌리기 이력만 늘린다. */
function opacity(node, v) {
  if (v >= 1) return;
  doc.executeCommand(DocumentCommand.createSetOpacity(Selection.create(doc, [node], true), v));
}

const srcAR = SW / SH, dstAR = W / H;
const coverW = srcAR > dstAR ? H * srcAR : W;
const coverH = srcAR > dstAR ? H : W / srcAR;
const fitW = srcAR > dstAR ? W : H * srcAR;
const fitH = srcAR > dstAR ? W / srcAR : H;

// ── ① 커버 배경 + 블러 ────────────────────────────────────────────────
const bg = place();
fit(bg, (W - coverW) / 2, (H - coverH) / 2, coverW, coverH);
// ⛔ SDK 힌트가 준 `createSetGaussianBlurLayerEffect(sel, fx)` 는 ***없다***.
//   실제 계약은 «속성마다 명령»이다 — radius(…, enableIfDisabled) 로 «켜면서» 건다.
blur(bg, BLUR);
console.log('① 커버 배경' + (BLUR > 0 ? ' + 블러 ' + BLUR + 'px' : ' (블러 없음)'));

// ── ② 거울 확장 — 모자란 «쪽»에만 ──────────────────────────────────────
let mirrored = 0;
// ⛔⭐⭐ ***기본이 «꺼짐»이다*** — 2026-09-22 실측으로 정한 값이다.
//   같은 그림(유리 프리즘 광고 컷)을 두 판으로 굽고 «나란히» 봤다:
// ```
//   거울 없음  블러 배경만 ⇒ 위아래가 «부드러운 확장»으로 읽힌다        ✅
//   거울 있음  블러 60 ⊕ 투명도 0.55 를 걸어도 ***유령 프리즘이 남는다***  ⛔
// ```
//   🔑 거울 확장은 «질감·풍경»에 듣고 ***「고립된 물체」에는 안 듣는다.***
//   ⇒ 기본은 끄고, 질감/풍경일 때만 «켜서» 쓴다(`mirror: true`).
//   ⛔ 「기법이 있다」를 「기본으로 둔다」로 접지 않는다 — 나란히 놓고 «보고» 정한다.
if (CFG.mirror === true) {
  // ⛔⭐⭐ ***거울을 «날것으로» 붙이면 「뒤집힌 물체가 떠 있는」 그림이 된다.***
  //   🩸 실측 2026-09-22: 유리 프리즘 한 점짜리 광고 컷에 그대로 붙였더니
  //      위쪽에 ***거꾸로 된 프리즘이 또 하나*** 생겨서, 검은 띠보다 «더» 이상했다.
  //   🔑 거울 확장은 «질감·풍경»에는 듣고 ***「고립된 물체」에는 안 듣는다.***
  //   ⇒ 그래서 띠에 ***블러 ⊕ 투명도***를 걸어 «구조는 잇되 형태는 지운다».
  //     그러면 물체가 아니라 «번짐»으로 읽힌다.
  const strip = function (node) { blur(node, MIRROR_BLUR); opacity(node, MIRROR_OPACITY); };
  if (dstAR < srcAR) {                       // 목표가 «더 세로» ⇒ 위아래가 빈다
    const gap = (H - fitH) / 2;
    if (gap > 2) {
      const x0 = (W - fitW) / 2;
      const a = place(); fit(a, x0, gap, fitW, -gap);       // 위 — 아래로 뒤집어 올린다
      const b2 = place(); fit(b2, x0, H - gap, fitW, -gap); // 아래
      strip(a); strip(b2);
      mirrored = Math.round(gap);
      console.log('② 거울 확장 — 위아래 각 ' + mirrored + 'px (블러 ' + MIRROR_BLUR + ' · 투명도 ' + MIRROR_OPACITY + ')');
    }
  } else if (dstAR > srcAR) {                // 목표가 «더 가로» ⇒ 좌우가 빈다
    const gap = (W - fitW) / 2;
    if (gap > 2) {
      const y0 = (H - fitH) / 2;
      const a = place(); fit(a, gap, y0, -gap, fitH);
      const b2 = place(); fit(b2, W - gap, y0, -gap, fitH);
      strip(a); strip(b2);
      mirrored = Math.round(gap);
      console.log('② 거울 확장 — 좌우 각 ' + mirrored + 'px (블러 ' + MIRROR_BLUR + ' · 투명도 ' + MIRROR_OPACITY + ')');
    }
  }
}
if (mirrored === 0) console.log('② 거울 확장 «건너뜀» — 비율이 같거나 틈이 없다');

// ── ③ 원본을 «한 픽셀도 안 자르고» 가운데 ──────────────────────────────
fit(place(), (W - fitW) / 2, (H - fitH) / 2, fitW, fitH);
console.log('③ 원본 ' + Math.round(fitW) + 'x' + Math.round(fitH) + ' 가운데');

// ── 내보낸다 ──────────────────────────────────────────────────────────
const names = FileExportOptions.allPresetNames;
const pick = names.find(function (n) { return /png/i.test(n); }) || names[0];
doc.export(CFG.out, FileExportOptions.createWithPresetName(pick), FileExportArea.createForCurrentSpread());
console.log('내보냄 ✅ ' + CFG.out + '  (preset: ' + pick + ')');
