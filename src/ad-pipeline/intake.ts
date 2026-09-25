export type Intake =
  | { kind: 'url'; url: string; brief?: string }
  | { kind: 'text'; brief: string }
  | { kind: 'image'; paths: string[]; brief?: string };

export type IntakeKind = Intake['kind'];

const BRIEF_OPTION_GUIDANCE = 'pass the accompanying brief with --brief.';
const UNRESOLVED_URL_VS_TEXT_MESSAGE = `Input is neither a valid URL nor an unambiguous text brief; ${BRIEF_OPTION_GUIDANCE}` as const;

export type IntakeRejection =
  | { ok: false; code: 'missing-input'; message: 'No advertising input was provided.' }
  | { ok: false; code: 'unresolved-url-vs-text'; message: typeof UNRESOLVED_URL_VS_TEXT_MESSAGE }
  | { ok: false; code: 'unreadable-image-path'; message: 'One or more image paths are unreadable.'; paths: string[] }
  // ⛔ 이미지와 «본문 입력»이 같이 오면 어느 쪽이 대상인지 모른다. 조용히 하나를 버리면
  //    판매 URL 이 사라져 «접지 자체가 일어나지 않는다». 브리프를 붙이려면 --brief 를 쓴다.
  | { ok: false; code: 'mixed-image-and-values'; message: 'Image inputs cannot be combined with positional URL or text; pass the brief with --brief.'; values: string[] };

export type IntakeClassification =
  | { ok: true; intake: Intake }
  | IntakeRejection;

export interface IntakeInput {
  readonly values?: readonly string[];
  readonly imagePaths?: readonly string[];
  readonly brief?: string;
  readonly unreadableImagePaths?: readonly string[];
}

const URL_PROTOCOL = /^https?:\/\/[^\s]+$/i;

/**
 * ⛔ 「값 «안»에 주소가 섞여 있나」 — 이것을 안 보면 `<URL> 여름 캠페인` 이 텍스트로 접힌다.
 * 🔑 그 오분류의 방향이 위험하다: 출처가 `real` → `generated` 로 «뒤집힌다».
 *    판매 중 제품을 「생성물」로 다루게 되므로, 애매하면 «거부»가 안전한 쪽이다.
 */
const URL_INSIDE = /(?:https?:\/\/|www\.)\S+|[\w-]+(?:\.[\w-]+)+\/\S*/i;
const TEXT_BRIEF = /\s|[.!?,:;]|[\u3131-\uD79D]/u;

export function classifyIntake(input: IntakeInput): IntakeClassification {
  const values = input.values?.map((value) => value.trim()).filter(Boolean) ?? [];
  const imagePaths = input.imagePaths?.map((path) => path.trim()).filter(Boolean) ?? [];
  const unreadableImagePaths = input.unreadableImagePaths?.map((path) => path.trim()).filter(Boolean) ?? [];
  const brief = input.brief?.trim();

  // ⛔⭐ 우선순위는 «의도»다: 혼합 입력이 «먼저»다.
  //    둘 다 참일 때 「경로를 못 읽는다」를 먼저 내면, 사람이 경로를 고쳐도 안 풀린다.
  if (imagePaths.length > 0 || unreadableImagePaths.length > 0) {
    if (values.length > 0) {
      return {
        ok: false,
        code: 'mixed-image-and-values',
        message: 'Image inputs cannot be combined with positional URL or text; pass the brief with --brief.',
        values,
      };
    }
    if (unreadableImagePaths.length > 0) {
      return { ok: false, code: 'unreadable-image-path', message: 'One or more image paths are unreadable.', paths: unreadableImagePaths };
    }
    return { ok: true, intake: { kind: 'image', paths: imagePaths, ...(brief ? { brief } : {}) } };
  }
  if (values.length === 0) {
    return { ok: false, code: 'missing-input', message: 'No advertising input was provided.' };
  }
  if (values.length === 1 && URL_PROTOCOL.test(values[0])) {
    // Preserve explicit URL context for createAdPipelinePlan and downstream stages rather than silently discarding it.
    return { ok: true, intake: { kind: 'url', url: values[0], ...(brief ? { brief } : {}) } };
  }
  // ⛔ 주소가 섞였는데 «단독 URL 이 아니다» — 텍스트로 접으면 URL 을 조용히 버린다.
  if (values.some((value) => URL_INSIDE.test(value))) {
    return { ok: false, code: 'unresolved-url-vs-text', message: UNRESOLVED_URL_VS_TEXT_MESSAGE };
  }

  const text = values.join(' ');
  if (TEXT_BRIEF.test(text)) {
    return { ok: true, intake: { kind: 'text', brief: text } };
  }
  return { ok: false, code: 'unresolved-url-vs-text', message: 'Input is neither a valid URL nor an unambiguous text brief; pass the accompanying brief with --brief.' };
}
