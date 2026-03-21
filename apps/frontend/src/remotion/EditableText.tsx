import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useInlineEditStore } from '../stores/inlineEditStore';
import { parseAssOverrides } from '../lib/assOverrides';

interface EditableTextProps {
  clipId: string;
  field: 'subtitle_text';
  text: string;
  style: React.CSSProperties;
}

export const EditableText: React.FC<EditableTextProps> = ({
  clipId,
  field,
  text,
  style,
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const { editingClipId, startEditing, updateDraft, commitEdit, cancelEdit } =
    useInlineEditStore();
  const isEditing = editingClipId === clipId;

  // When entering edit mode, set content, focus, and select all
  useEffect(() => {
    if (isEditing && divRef.current) {
      divRef.current.innerText = text;
      divRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(divRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isEditing]); // intentionally omit `text` — only run on edit mode entry

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!isEditing) {
        startEditing(clipId, field, text);
      }
    },
    [clipId, field, text, isEditing, startEditing],
  );

  const handleBlur = useCallback(() => {
    if (isEditing) {
      commitEdit();
    }
  }, [isEditing, commitEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isEditing) return;
      e.stopPropagation(); // Prevent player/timeline keyboard shortcuts

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        divRef.current?.blur(); // triggers handleBlur → commitEdit
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
        if (divRef.current) {
          divRef.current.innerText = text;
        }
        divRef.current?.blur();
      }
    },
    [isEditing, cancelEdit, text],
  );

  const handleInput = useCallback(() => {
    if (isEditing && divRef.current) {
      updateDraft(divRef.current.innerText);
    }
  }, [isEditing, updateDraft]);

  // Prevent pointer events from bubbling to Player when editing
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isEditing) {
        e.stopPropagation();
      }
    },
    [isEditing],
  );

  const renderedText = useMemo(() => parseAssOverrides(text), [text]);

  const editingStyle: React.CSSProperties = isEditing
    ? {
        outline: '2px solid rgba(59, 130, 246, 0.8)',
        outlineOffset: 2,
        cursor: 'text',
        minWidth: 20,
        minHeight: '1em',
        pointerEvents: 'auto' as const,
      }
    : {
        cursor: 'default',
        pointerEvents: 'auto' as const,  // Override Player's pointer-events: none
      };

  return (
    <div
      ref={divRef}
      contentEditable={isEditing}
      suppressContentEditableWarning
      onDoubleClick={handleDoubleClick}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      onPointerDown={handlePointerDown}
      style={{ ...style, ...editingStyle }}
    >
      {isEditing ? undefined : renderedText}
    </div>
  );
};
