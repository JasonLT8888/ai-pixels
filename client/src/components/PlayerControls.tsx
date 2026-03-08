import { useEffect, useRef } from 'react';
import {
  getCurrentVisibleStep,
  getVisibleStepCount,
  useProject,
  useProjectDispatch,
} from '../store/ProjectContext';

export default function PlayerControls() {
  const { currentStep, instructions, playing, playSpeed } = useProject();
  const dispatch = useProjectDispatch();
  const timerRef = useRef<number | null>(null);
  const total = getVisibleStepCount(instructions);
  const currentVisibleStep = getCurrentVisibleStep(currentStep, instructions);

  // Auto-play timer
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = window.setInterval(() => {
      dispatch({ type: 'NEXT_STEP' });
    }, playSpeed);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, playSpeed, dispatch]);

  // Stop playing when we reach the end
  useEffect(() => {
    if (playing && currentStep >= instructions.length) {
      dispatch({ type: 'SET_PLAYING', playing: false });
    }
  }, [currentStep, instructions.length, playing, dispatch]);

  return (
    <div className="player">
      <div className="player-buttons">
        <button onClick={() => dispatch({ type: 'FIRST_STEP' })} title="第一步">|◄</button>
        <button onClick={() => dispatch({ type: 'PREV_STEP' })} title="上一步">◄</button>
        <button onClick={() => dispatch({ type: 'NEXT_STEP' })} title="下一步">►</button>
        <button onClick={() => dispatch({ type: 'LAST_STEP' })} title="最后一步">►|</button>
        <button
          className={playing ? 'active' : ''}
          onClick={() => {
            if (playing) {
              dispatch({ type: 'SET_PLAYING', playing: false });
            } else {
              if (currentVisibleStep >= total) dispatch({ type: 'FIRST_STEP' });
              dispatch({ type: 'SET_PLAYING', playing: true });
            }
          }}
          title="自动播放"
        >
          {playing ? '⏸' : '▶'}
        </button>
      </div>
      <div className="player-info">
        <span>步骤 {currentVisibleStep} / {total}</span>
        <div className="player-speed">
          <span>速度</span>
          <input
            type="range"
            min={50}
            max={1000}
            step={50}
            value={playSpeed}
            onChange={(e) => dispatch({ type: 'SET_PLAY_SPEED', speed: Number(e.target.value) })}
          />
          <span>{playSpeed}ms</span>
        </div>
      </div>
    </div>
  );
}
