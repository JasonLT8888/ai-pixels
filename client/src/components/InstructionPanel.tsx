import { useProject, useProjectDispatch } from '../store/ProjectContext';

function formatInstruction(inst: unknown[]): string {
  return JSON.stringify(inst);
}

export default function InstructionPanel() {
  const { instructions, currentStep } = useProject();
  const dispatch = useProjectDispatch();

  return (
    <div className="instruction-panel">
      {instructions.length === 0 && (
        <div style={{ padding: '12px', color: 'var(--text-dim)', fontSize: 12 }}>
          暂无指令，在下方粘贴 JSON 开始绘制。
        </div>
      )}
      {instructions.map((inst, i) => {
        const isActive = i < currentStep;
        const isCurrent = i === currentStep - 1;
        return (
          <div
            key={i}
            className={`instruction-item${isCurrent ? ' active' : ''}`}
            style={{ opacity: isActive ? 1 : 0.4 }}
            onClick={() => dispatch({ type: 'GO_TO_STEP', step: i + 1 })}
          >
            <span className="inst-index">{i}</span>
            <span className="inst-params">{formatInstruction(inst)}</span>
          </div>
        );
      })}
    </div>
  );
}
