import { useState, useEffect, useCallback, useRef } from 'react';
import { useProject, useProjectDispatch } from '../store/ProjectContext';
import { saveInstructions } from '../api/projects';
import { normalizeProjectInstructions } from 'shared/src/instruction-format';
import type { Instruction } from 'shared/src/types';

export default function JsonEditor() {
  const { instructions, projectId, canvasWidth, canvasHeight } = useProject();
  const dispatch = useProjectDispatch();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const dirty = useRef(false);

  // Sync state → textarea only when instructions change from outside (e.g. player, load)
  useEffect(() => {
    if (!dirty.current) {
      setText(JSON.stringify(instructions, null, 1));
    }
  }, [instructions]);

  const apply = useCallback(() => {
    try {
      const parsed = JSON.parse(text);
      const normalized = normalizeProjectInstructions(parsed, { width: canvasWidth, height: canvasHeight });
      setError('');
      dirty.current = false;
      dispatch({ type: 'SET_INSTRUCTIONS', instructions: normalized as Instruction[] });

      if (projectId) {
        saveInstructions(projectId, normalized).catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [text, dispatch, projectId, canvasWidth, canvasHeight]);

  const handleChange = (value: string) => {
    dirty.current = true;
    setText(value);
  };

  return (
    <div className="json-editor">
      <div className="json-editor-header">
        <span>指令 JSON</span>
        <button onClick={apply}>应用</button>
      </div>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            apply();
          }
        }}
        spellCheck={false}
        placeholder='在此粘贴指令 JSON，例如 [["canvas",32,32],["palette",["#f00","#00f"]],["rect",2,2,10,10,0],["ellipse",20,16,6,6,1]]'
      />
      {error && <div className="json-error">{error}</div>}
    </div>
  );
}
