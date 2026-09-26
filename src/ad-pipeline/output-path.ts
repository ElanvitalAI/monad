export interface AdOutputPathInput {
  readonly home: string;
  readonly slug: string;
  readonly date: string;
}

export type AdOutputPathResult = string | { readonly error: string };

type AdSubDirKind = 'clips' | 'frames';

const SEPARATOR_OR_TRAVERSAL = /[\\/]|\.\./;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function error(message: string): { readonly error: string } {
  return { error: message };
}

function validSegment(value: string, name: 'slug' | 'aspect'): { readonly error: string } | undefined {
  if (value.trim().length === 0) return error(`${name} must not be empty.`);
  if (SEPARATOR_OR_TRAVERSAL.test(value)) return error(`${name} must not contain path separators or '..'.`);
  return undefined;
}

function validDate(date: string): { readonly error: string } | undefined {
  if (date.trim().length === 0) return error('date must not be empty.');
  if (SEPARATOR_OR_TRAVERSAL.test(date)) return error("date must not contain path separators or '..'.");
  const match = DATE.exec(date);
  if (!match) return error('date must use the YYYY-MM-DD format.');
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return error('date must be a valid YYYY-MM-DD calendar date.');
  }
  return undefined;
}

function validInput(input: AdOutputPathInput): { readonly error: string } | undefined {
  if (input.home.trim().length === 0) return error('home must not be empty.');
  return validSegment(input.slug, 'slug') ?? validDate(input.date);
}

function join(base: string, name: string): string {
  return `${base.replace(/[\\/]+$/, '')}/${name}`;
}

/** Builds the documented output project directory without accessing the filesystem. */
export function adProjectDir(input: AdOutputPathInput): AdOutputPathResult {
  const rejection = validInput(input);
  if (rejection) return rejection;
  return join(join(join(input.home, 'Movies'), 'elanous-ad'), `${input.date}-${input.slug}`);
}

/** Builds the documented final master filename without accessing the filesystem. */
export function adMasterName(slug: string, version: number, aspect: string): AdOutputPathResult {
  const slugRejection = validSegment(slug, 'slug');
  if (slugRejection) return slugRejection;
  if (!Number.isInteger(version) || version < 1) return error('version must be a positive integer.');
  const aspectRejection = validSegment(aspect, 'aspect');
  if (aspectRejection) return aspectRejection;
  return `${slug}_v${version}_${aspect}.mp4`;
}

/** Builds a documented clips or frames subdirectory without accessing the filesystem. */
export function adSubDir(input: AdOutputPathInput, kind: AdSubDirKind): AdOutputPathResult {
  const project = adProjectDir(input);
  return typeof project === 'string' ? join(project, kind) : project;
}
