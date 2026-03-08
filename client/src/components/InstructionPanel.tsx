import {
  getCurrentVisibleStep,
  getHiddenStepCount,
  useProject,
  useProjectDispatch,
} from '../store/ProjectContext';

function formatInstruction(inst: unknown[]): string {
  return JSON.stringify(inst);
}

function formatSetupIndex(inst: unknown[]) {
  const type = inst[0];
  if (type === 'canvas') return 'C';
  if (type === 'palette') return 'P';
  return 'S';
}

export default function InstructionPanel() {
  const { instructions, currentStep } = useProject();
  const dispatch = useProjectDispatch();
  const hiddenStepCount = getHiddenStepCount(instructions);
  const currentVisibleStep = getCurrentVisibleStep(currentStep, instructions);
  const hiddenInstructions = instructions.slice(0, hiddenStepCount);
  const visibleInstructions = instructions.slice(hiddenStepCount);

  return (
    <div className="instruction-panel">
      {hiddenInstructions.length > 0 && (
        <div className="instruction-section-label">前置指令</div>
      )}
      {hiddenInstructions.map((inst, i) => (
        <div
          key={`setup-${i}`}
          className="instruction-item setup"
          title="前置指令，不计入步骤"
        >
          <span className="inst-index">{formatSetupIndex(inst)}</span>
          <span className="inst-params">{formatInstruction(inst)}</span>
        </div>
      ))}
      {hiddenInstructions.length > 0 && visibleInstructions.length > 0 && (
        <div className="instruction-divider" />
      )}
      {visibleInstructions.length > 0 && (
        <div className="instruction-section-label">绘制步骤</div>
      )}
      {visibleInstructions.length === 0 && (
        <div style={{ padding: '12px', color: 'var(--text-dim)', fontSize: 12 }}>
          暂无可绘制步骤，在下方粘贴 JSON 开始绘制。
        </div>
      )}
      {visibleInstructions.map((inst, i) => {
        const isActive = i < currentVisibleStep;
        const isCurrent = i === currentVisibleStep - 1;
        return (
          <div
            key={i}
            className={`instruction-item${isCurrent ? ' active' : ''}`}
            style={{ opacity: isActive ? 1 : 0.4 }}
            onClick={() => dispatch({ type: 'GO_TO_STEP', step: hiddenStepCount + i + 1 })}
          >
            <span className="inst-index">{i + 1}</span>
            <span className="inst-params">{formatInstruction(inst)}</span>
          </div>
        );
      })}
    </div>
  );
}
