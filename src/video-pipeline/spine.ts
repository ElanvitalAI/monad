// ── 영상 생산 «뼈대» — 노드가 요구하는 능력 ────────────────────────────────
//
// ⭐⭐ 레고의 «돌기»는 contract.inputs 다.
//    어느 노드든 «그 노드의 inputs 를 채울 수 있으면» 거기서 시작할 수 있다.
//    ⇒ 조합은 프로파일 열거가 아니라 ***「입력을 어디서 얻나」***로 정해진다.
//
// 📄 그래프 선언 = graphs/video/video-production-pipeline.declaration.yaml

export interface SpineNode {
  readonly id: string;
  readonly what: string;
  /** 없으면 이 노드를 못 돈다. */
  readonly needs: readonly string[];
  /** 있으면 좋고 없으면 건너뛴다. */
  readonly optional?: readonly string[];
  /** 이 노드에서 «시작»하려면 사람이 미리 줘야 하는 것 = 레고 돌기. */
  readonly inputs: readonly string[];
  /** ⛔ 선택 입력 — 없어도 노드가 «돈다». 선언 스키마엔 이 자리가 없어서 drift 가 «못 본다»(그 자가 스스로 말한다). */
  readonly optionalInputs?: readonly string[];
  readonly outputs: readonly string[];
}

export const SPINE: readonly SpineNode[] = [
  { id: 'ground',    what: '사실을 실물에서',        needs: [],                     optional: ['fetch-source'],
    inputs: ['brief'],                       outputs: ['facts', 'clips', 'specs'] },
  { id: 'structure', what: '구조가 있나 (분기점)',    needs: [],                     optional: ['asr'],
    inputs: ['facts|clips'],                 outputs: ['arc'] },
  { id: 'plan',      what: '컷 목록 SSOT (시간 소유)', needs: [],
    inputs: ['arc', 'target_specs'],         outputs: ['shot_plan', 'target_dur'] },
  { id: 'assets',    what: '소재를 만들/모은다',      needs: [],
    optional: ['image-gen', 'video-gen', '3d-render', 'motion-graphics', 'raster-edit',
               'avatar-video', 'physics-sim', 'character-rig'],
    inputs: ['shot_plan', 'palette', 'budget_credits'], outputs: ['asset_files'] },
  { id: 'assetgate', what: '소재가 쓸 수 있나',       needs: ['raster-edit'],
    inputs: ['asset_files', 'target_specs', 'palette'], outputs: ['verdict'] },
  { id: 'audio',     what: '목소리·음악',            needs: ['audio-mix'],
    optional: ['tts', 'music-gen', 'voice-clone'],
    inputs: ['shot_plan'],                   outputs: ['vo', 'music', 'word_timestamps'] },
  { id: 'align',     what: '시간을 맞춘다',          needs: [],                     optional: ['asr'],
    inputs: ['shot_plan', 'word_timestamps', 'music'], outputs: ['timeline'] },
  { id: 'compose',   what: '어느 클립이 몇 초에',     needs: ['assemble'], optional: ['app-control'],
    // ⭐⭐ 산출이 «둘»이다 — edl(기계가 읽는 배치) ⊕ comp_project(사람이 «다시 여는» 프로젝트).
    //   📌 근거: Higgsfield/Astra/AE 워크플로의 유일한 구조적 차별점이 «편집 가능한 프로젝트를 남긴다»는 것.
    //      결과물만 남기면 로컬라이제이션·리사이즈가 매번 «처음부터»가 된다.
    inputs: ['timeline', 'asset_files'],     outputs: ['edl', 'comp_project'] },
    // ⭐ app-control 이 있으면 comp_project 가 «진짜» 편집 가능한 프로젝트가 된다.
    //   없으면 edl 뿐이고, 그러면 ⑬ 의 언어교체·리사이즈가 매번 «처음부터»가 된다.
  { id: 'overlay',   what: '그 위 텍스트·층',        needs: ['caption'], optional: ['app-control'],
    inputs: ['edl', 'word_timestamps'],      outputs: ['overlay_layers'] },
  // ⛔⭐⭐ 6차 리뷰 ④ — comp_project 를 «필수 입력»으로 두면 ***자유 갈래가 계약상 닫히지 않는다***.
  //   compose 의 주석은 「app-control 이 없으면 edl 뿐」이라 적어 놓고, render 는 comp_project 를
  //   «반드시» 요구했다 ⇒ 무료 ffmpeg 경로(compose→overlay→render→deliver)가 선언과 모순이었다.
  //   ✅ 필수는 edl ⊕ overlay_layers 뿐이고, comp_project 는 «있으면 더 좋은» 선택 입력이다.
  { id: 'render',    what: '픽셀을 굽는다',          needs: ['encode'],             optional: ['color-grade'],
    inputs: ['edl', 'overlay_layers'], optionalInputs: ['comp_project'], outputs: ['master'] },
  { id: 'readback',  what: '만든 것을 다시 잰다',     needs: ['encode'],
    inputs: ['master', 'target_dur'],        outputs: ['dur', 'gaps'] },
  { id: 'qc',        what: '검수 (심장)',            needs: [],
    inputs: ['master', 'shot_plan'],         outputs: ['findings'] },
  // ⛔ master 를 «잘라» 파생하지 않는다 — comp_project 로 «다시 굽는다».
  //   그래서 입력이 `master|comp_project` 다(둘 중 하나로 들어올 수 있다 = 레고 돌기 둘).
  //   📏 DaVinciStack 실측: 마스터만 고치면 소셜이 «안 따라온다».
  { id: 'deliver',   what: '비율 변형 · 납품 · 언어 교체', needs: ['encode'],
    optional: ['tts', 'voice-clone', 'caption'],
    inputs: ['master|comp_project', 'target_specs'], outputs: ['deliverables'] },
  // ⛔ 2026-09-22 신설 — ***납품물을 보는 눈이 「없었다».***
  //   자막이 통째로 빠진 납품물이 delivered 로 나갔고 qc 는 master 만 봤다.
  { id: 'shipcheck', what: '납품물 검수 (마스터와 견준다)', needs: ['encode'],
    inputs: ['deliverables', 'master'], outputs: ['findings'] },
];

/** 구간이 왜 비었나 — ⛔ 「오타」와 「역순」을 같은 값으로 답하지 않는다.
 *  📏 계기: segment('ground','nope') 과 segment('deliver','compose') 가 둘 다 [] 였다.
 *     호출부는 "구간이 비었다"만 말할 수 있었고, ***어느 이름이 틀렸는지*** 못 말했다. */
export type SegmentError =
  | { readonly kind: 'unknown-from'; readonly name: string }
  | { readonly kind: 'unknown-to'; readonly name: string }
  | { readonly kind: 'inverted'; readonly from: string; readonly to: string };

export interface SegmentResult {
  readonly nodes: readonly SpineNode[];
  readonly error?: SegmentError;
}

/** 진입 노드부터 끝까지의 구간. ⛔ 뼈대는 선형이라 구간은 «잘라내기»다. */
export function segmentOf(from: string, to?: string): SegmentResult {
  const i = SPINE.findIndex((n) => n.id === from);
  if (i < 0) return { nodes: [], error: { kind: 'unknown-from', name: from } };
  if (to === undefined) return { nodes: SPINE.slice(i) };
  const j = SPINE.findIndex((n) => n.id === to);
  if (j < 0) return { nodes: [], error: { kind: 'unknown-to', name: to } };
  if (j < i) return { nodes: [], error: { kind: 'inverted', from, to } };
  return { nodes: SPINE.slice(i, j + 1) };
}

