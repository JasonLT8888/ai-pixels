import { useState, useEffect, useCallback, useRef } from 'react';
import { useProject, useProjectDispatch } from '../store/ProjectContext';
import { saveInstructions } from '../api/projects';
import type { Instruction } from 'shared/src/types';

export default function JsonEditor() {
  const { instructions, projectId } = useProject();
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
      if (!Array.isArray(parsed)) {
        setError('必须是 JSON 数组');
        return;
      }
      setError('');
      dirty.current = false;
      dispatch({ type: 'SET_INSTRUCTIONS', instructions: parsed as Instruction[] });

      if (projectId) {
        saveInstructions(projectId, parsed).catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [text, dispatch, projectId]);

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
        placeholder='在此粘贴指令 JSON，例如 [["canvas",32,32,"#fff"],["color","#f00"],["rect",2,2,10,10]]'
      />
      {error && <div className="json-error">{error}</div>}
    </div>
  );
}
