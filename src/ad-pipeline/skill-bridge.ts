import {
  type AspectRatio,
  type Beat,
  type CameraMove,
  type SceneSpec,
  type ShotSize,
  validateSceneSpec,
} from './scene-spec.js';

export const SKILL_SHOT_FORMAT_MISMATCH = 'Expected ### Shot N or ### 샷 N blocks';

export interface SkillParseResult {
  readonly scene?: SceneSpec;
  readonly missing: readonly string[];
  readonly sceneWarnings?: readonly string[];
  readonly formatMismatch?: typeof SKILL_SHOT_FORMAT_MISMATCH;
  readonly genre?: string;
  readonly englishPrompt?: string;
}

interface ParsedShot {
  readonly aspectRatio?: AspectRatio;
  readonly audio?: boolean;
  readonly duration?: number;
  readonly grade?: string;
  readonly hook?: string;
  readonly lens?: string;
  readonly lighting?: string;
  readonly model?: string;
  readonly prompt?: string;
  readonly texture?: string;
  readonly role?: Beat['role'];
  readonly emotion?: { readonly primary: string; readonly secondary: string };
  readonly camera?: { readonly move: CameraMove; readonly shotSize: ShotSize };
  readonly transitionIn?: Beat['transitionIn'];
  readonly missing: readonly string[];
}

const aspectRatios: readonly AspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const cameraMoves: readonly CameraMove[] = ['dolly-in', 'dolly-out', 'pan', 'tilt', 'tracking', 'crane', 'drone', 'push-in', 'static'];
const shotSizes: readonly ShotSize[] = ['wide', 'medium', 'close-up'];
const fixedHeadings = ['장르 식별', '5축 분석 (한국어)', '5축 분석', 'English Prompt (Higgsfield-ready)', 'English Prompt', 'Higgsfield 설정'] as const;

function headingExpression(heading: string): RegExp {
  return new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
}

function section(markdown: string, headings: readonly string[]): string | undefined {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => headings.some((heading) => headingExpression(heading).test(line)));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && fixedHeadings.some((heading) => headingExpression(heading).test(line)));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').replace(/\n$/, '');
}

function value(block: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]\\s*(.+?)\\s*$`, 'mi'));
  return match?.[1];
}

function splitShots(markdown: string): readonly string[] | undefined {
  const lines = markdown.split('\n');
  const starts = lines.reduce<number[]>((indices, line, index) => {
    const firstContent = lines.slice(index + 1).find((following) => following.trim().length > 0);
    if (/^###\s+(?:Shot|샷)\s*\d+[^\n]*$/i.test(line) && /^##\s+장르 식별\s*$/.test(firstContent ?? '')) indices.push(index);
    return indices;
  }, []);
  return starts.length > 0 ? starts.map((start, index) => lines.slice(start, starts[index + 1]).join('\n')) : undefined;
}

function parsedEnum<T extends string>(source: string | undefined, choices: readonly T[]): T | undefined {
  if (!source) return undefined;
  const normalized = source.trim().toLowerCase();
  return choices.find((choice) => normalized === choice);
}

function parseDuration(source: string | undefined): number | undefined {
  const match = source?.trim().match(/^(\d+(?:\.\d+)?)\s*s$/i);
  const duration = match ? Number(match[1]) : undefined;
  return duration && duration > 0 ? duration : undefined;
}

/** ⛔⭐ 구분자를 «하나»로 두지 않는다 — 스킬 템플릿과 교재가 서로 다른 것을 쓴다:
 *    SKILL.md   "[primary emotion **+** secondary, grounded in a specific moment]"
 *    교재 7종    "톤·감정 열망 **+** 청결감" · "그리움" · "친밀 **+** 열망"
 *    씬 구조표   "외로움**,** 차가움"
 *  🩸 초판은 `/` «만» 받았고, 그것은 자식이 «자기가 쓴 시험 문면»에 맞춘 것이었다.
 *     ⇒ 실제 스킬 산출을 먹이면 `tone·emotion` 이 missing 으로 나왔다(검토에서 잡힘). */
const EMOTION_SEPARATORS = /\s*[/+,·]\s*|\s+그리고\s+/;

function parseEmotion(source: string | undefined): { readonly primary: string; readonly secondary: string } | undefined {
  const parts = source?.trim().split(EMOTION_SEPARATORS).map((p) => p.trim()).filter(Boolean) ?? [];
  // ⛔ 하나만 오면 «거절»한다 — 실패 모드 1번이 「감정이 떠 있음」이고,
  //    둘째를 빈 문자열로 채우면 SceneSpec 의 불변식이 그것을 다시 거절한다(그때는 원인이 안 보인다).
  return parts.length >= 2 && parts[0] && parts[1] ? { primary: parts[0], secondary: parts[1] } : undefined;
}

function parseCamera(source: string | undefined): { readonly move: CameraMove; readonly shotSize: ShotSize } | undefined {
  const [move, shotSize] = source?.trim().split(/\s*\/\s*/, 2) ?? [];
  const parsedMove = parsedEnum(move, cameraMoves);
  const parsedShotSize = parsedEnum(shotSize, shotSizes);
  return parsedMove && parsedShotSize ? { move: parsedMove, shotSize: parsedShotSize } : undefined;
}

function parseAudio(source: string | undefined): boolean | undefined {
  if (/^yes$/i.test(source?.trim() ?? '')) return true;
  if (/^no$/i.test(source?.trim() ?? '')) return false;
  return undefined;
}

function parseTransition(source: string): Beat['transitionIn'] | undefined {
  const [kindSource, intentSource] = source.split(/\s*—\s*|\s+-\s+/, 2);
  const kind = parsedEnum(kindSource, ['hard-cut', 'match-cut', 'hold', 'dissolve'] as const);
  return kind ? { kind, intent: intentSource?.trim() || kind } : undefined;
}

function parseShot(markdown: string): ParsedShot {
  const axes = section(markdown, ['5축 분석 (한국어)', '5축 분석']);
  const prompt = section(markdown, ['English Prompt (Higgsfield-ready)', 'English Prompt']);
  const settings = section(markdown, ['Higgsfield 설정']);
  const missing: string[] = [];
  if (axes === undefined) missing.push('5축 분석');
  if (prompt === undefined || prompt.length === 0) missing.push('English Prompt');
  if (settings === undefined) missing.push('Higgsfield 설정');
  if (!axes || prompt === undefined || !settings) return { missing, ...(prompt === undefined ? {} : { prompt }) };

  const emotion = parseEmotion(value(axes, '① 톤·감정'));
  const role = parsedEnum(value(axes, '③ 구조'), ['hook', 'buildup', 'climax', 'transition'] as const);
  const hook = value(axes, '④ 후킹 포인트');
  const camera = parseCamera(value(axes, '카메라'));
  const lens = value(axes, '렌즈');
  const lighting = value(axes, '조명');
  const grade = value(axes, '색감');
  const texture = value(axes, '텍스처');
  const model = value(settings, '모델');
  const aspectRatio = parsedEnum(value(settings, 'Aspect ratio'), aspectRatios);
  const duration = parseDuration(value(settings, 'Duration'));
  const audio = parseAudio(value(settings, 'Audio'));
  const transitionSource = value(settings, '전환');
  const transitionIn = transitionSource === undefined ? undefined : parseTransition(transitionSource);

  for (const [name, field] of [
    ['tone·emotion', emotion], ['hook', hook], ['camera', camera], ['lens', lens], ['lighting', lighting],
    ['grade', grade], ['texture', texture], ['모델', model], ['Aspect ratio', aspectRatio],
    ['Duration', duration], ['Audio', audio],
  ] as const) if (field === undefined || field === '') missing.push(name);
  if (transitionSource !== undefined && !transitionIn) missing.push('전환');

  return { aspectRatio, audio, duration, grade, hook, lens, lighting, model, prompt, texture, role, emotion, camera, ...(transitionIn ? { transitionIn } : {}), missing };
}

export function parseSkillOutput(markdown: string): SkillParseResult {
  const genre = section(markdown, ['장르 식별'])?.split('\n').find((line) => line.trim().length > 0);
  const standalonePrompt = section(markdown, ['English Prompt (Higgsfield-ready)', 'English Prompt']);
  const shotBlocks = splitShots(markdown);
  const formatIndependent = {
    ...(genre ? { genre } : {}),
    ...(standalonePrompt !== undefined && standalonePrompt.length > 0 ? { englishPrompt: standalonePrompt } : {}),
  };

  if (!shotBlocks) return { missing: [], formatMismatch: SKILL_SHOT_FORMAT_MISMATCH, ...formatIndependent };

  const shots = shotBlocks.map(parseShot);
  const missing = shots.flatMap((shot, index) => shot.missing.map((name) => shots.length === 1 ? name : `Shot ${index + 1}: ${name}`));
  const prompts = shots.map((shot) => shot.prompt).filter((prompt): prompt is string => prompt !== undefined);
  const englishPrompt = prompts.length > 0 ? prompts.join('\n\n') : undefined;
  const result = { ...(genre ? { genre } : {}), ...(englishPrompt !== undefined ? { englishPrompt } : {}) };

  if (missing.length > 0 || shots.length < 3 || shots.length > 6) {
    return { missing: shots.length < 3 || shots.length > 6 ? [...missing, 'beats (3-6 required)'] : missing, ...result };
  }

  const first = shots[0]!;
  if (!first.aspectRatio || !first.hook || !first.lens || !first.lighting || !first.grade || !first.texture) {
    return { missing: [...missing, 'first shot metadata'], ...result };
  }
  if (shots.some((shot) => shot.aspectRatio !== first.aspectRatio)) return { missing: [...missing, 'consistent Aspect ratio'], ...result };

  let startSec = 0;
  const beats: Beat[] = shots.map((shot, index) => {
    if (!shot.duration || !shot.emotion || !shot.camera || shot.model === undefined || shot.audio === undefined || shot.prompt === undefined) throw new Error('unreachable parsed shot');
    const beat: Beat = {
      role: shot.role ?? (index === 0 ? 'hook' : index === shots.length - 1 ? 'climax' : 'buildup'),
      startSec,
      endSec: startSec + shot.duration,
      emotion: shot.emotion,
      camera: shot.camera,
      model: shot.model,
      audio: shot.audio,
      promptCore: shot.prompt,
      checks: [],
      ...(shot.transitionIn ? { transitionIn: shot.transitionIn } : {}),
    };
    startSec = beat.endSec;
    return beat;
  });
  const scene: SceneSpec = {
    beats,
    axes: { hook: first.hook, totalSeconds: startSec, lock: { lens: first.lens, lighting: first.lighting, grade: first.grade, texture: first.texture } },
    aspectRatio: first.aspectRatio,
    forbidden: [],
    provenance: 'generated',
  };
  const validation = validateSceneSpec(scene);
  const sceneWarnings = validation.warnings.length > 0 ? { sceneWarnings: validation.warnings } : {};
  return validation.valid
    ? { scene, missing, ...sceneWarnings, ...result }
    : { missing: [...missing, ...validation.errors], ...sceneWarnings, ...result };
}
