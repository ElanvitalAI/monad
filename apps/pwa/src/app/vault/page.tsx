// Obsidian Vault surface (OP1 브라우저 + OP2 에디터 · 2026-07-09) — iPad Obsidian PWA 이식.
// 브라우저(폴더·프리뷰·검색) ↔ 노트 에디터(편집·저장·409) 토글. 백엔드 /v1/vault/*.

'use client';

import { useState } from 'react';
import { VaultPanel } from '@/components/vault/VaultPanel';
import { NoteEditor } from '@/components/vault/NoteEditor';

export default function VaultPage(): React.ReactNode {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing) return <NoteEditor path={editing} onClose={() => setEditing(null)} />;
  return <VaultPanel onEdit={(path) => setEditing(path)} />;
}
