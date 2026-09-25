/**
 * Markdown render config — react-markdown + remark-gfm.
 * Re-export so chat / future surfaces share the same plugin set.
 */

import remarkGfm from 'remark-gfm';

export const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
