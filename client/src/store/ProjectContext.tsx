import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { Instruction } from 'shared/src/types';

export interface ProjectState {
  projectId: number | null;
  instructions: Instruction[];
  currentStep: number;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  showGrid: boolean;
  playing: boolean;
  playSpeed: number; // ms per step
  currentColorHex: string;
  palette: string[];
  currentColorIndex: number | null;
  lastComment: string | null;
}

export type ProjectAction =
  | { type: 'SET_PROJECT'; projectId: number; instructions: Instruction[]; canvasWidth: number; canvasHeight: number }
  | { type: 'SET_INSTRUCTIONS'; instructions: Instruction[] }
  | { type: 'GO_TO_STEP'; step: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'FIRST_STEP' }
  | { type: 'LAST_STEP' }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'TOGGLE_GRID' }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_PLAY_SPEED'; speed: number }
  | {
      type: 'SET_RENDER_META';
      currentColorHex: string;
      palette: string[];
      currentColorIndex: number | null;
      lastComment: string | null;
    };

const initialState: ProjectState = {
  projectId: null,
  instructions: [],
  currentStep: 0,
  canvasWidth: 32,
  canvasHeight: 32,
  zoom: 12,
  showGrid: true,
  playing: false,
  playSpeed: 200,
  currentColorHex: '#000000',
  palette: [],
  currentColorIndex: null,
  lastComment: null,
};

function getCanvasSizeFromInstructions(
  instructions: Instruction[],
  fallbackWidth: number,
  fallbackHeight: number,
) {
  let width = fallbackWidth;
  let height = fallbackHeight;

  for (const instruction of instructions) {
    if (!Array.isArray(instruction)) continue;
    const [head, rawWidth, rawHeight] = instruction as unknown[];
    if ((head === 'canvas' || head === 'C') && typeof rawWidth === 'number' && typeof rawHeight === 'number') {
      width = Math.max(1, Math.min(4096, Math.round(rawWidth)));
      height = Math.max(1, Math.min(4096, Math.round(rawHeight)));
    }
  }

  return { width, height };
}

export function getHiddenStepCount(instructions: Instruction[]) {
  let hiddenCount = 0;
  if (instructions[0]?.[0] === 'canvas') {
    hiddenCount += 1;
  }
  if (instructions[hiddenCount]?.[0] === 'palette') {
    hiddenCount += 1;
  }
  return hiddenCount;
}

export function getVisibleStepCount(instructions: Instruction[]) {
  return Math.max(0, instructions.length - getHiddenStepCount(instructions));
}

export function getCurrentVisibleStep(currentStep: number, instructions: Instruction[]) {
  return Math.max(0, Math.min(getVisibleStepCount(instructions), currentStep - getHiddenStepCount(instructions)));
}

function getFirstVisibleCurrentStep(instructions: Instruction[]) {
  const hiddenCount = getHiddenStepCount(instructions);
  return getVisibleStepCount(instructions) > 0 ? hiddenCount + 1 : hiddenCount;
}

function reducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case 'SET_PROJECT': {
      const { width, height } = getCanvasSizeFromInstructions(
        action.instructions,
        action.canvasWidth,
        action.canvasHeight,
      );
      return {
        ...state,
        projectId: action.projectId,
        instructions: action.instructions,
        canvasWidth: width,
        canvasHeight: height,
        currentStep: getFirstVisibleCurrentStep(action.instructions),
      };
    }
    case 'SET_INSTRUCTIONS': {
      const { width, height } = getCanvasSizeFromInstructions(
        action.instructions,
        state.canvasWidth,
        state.canvasHeight,
      );
      return {
        ...state,
        instructions: action.instructions,
        canvasWidth: width,
        canvasHeight: height,
        currentStep: getFirstVisibleCurrentStep(action.instructions),
        playing: false,
      };
    }
    case 'GO_TO_STEP':
      return { ...state, currentStep: Math.max(0, Math.min(action.step, state.instructions.length)) };
    case 'NEXT_STEP': {
      const firstVisibleCurrentStep = getFirstVisibleCurrentStep(state.instructions);
      return {
        ...state,
        currentStep: Math.min(Math.max(state.currentStep, firstVisibleCurrentStep) + 1, state.instructions.length),
      };
    }
    case 'PREV_STEP': {
      const firstVisibleCurrentStep = getFirstVisibleCurrentStep(state.instructions);
      return {
        ...state,
        currentStep: Math.max(Math.min(state.currentStep - 1, state.instructions.length), firstVisibleCurrentStep),
      };
    }
    case 'FIRST_STEP':
      return { ...state, currentStep: getFirstVisibleCurrentStep(state.instructions), playing: false };
    case 'LAST_STEP':
      return { ...state, currentStep: state.instructions.length, playing: false };
    case 'SET_ZOOM':
      return { ...state, zoom: Math.max(1, Math.min(32, action.zoom)) };
    case 'TOGGLE_GRID':
      return { ...state, showGrid: !state.showGrid };
    case 'SET_PLAYING':
      return { ...state, playing: action.playing };
    case 'SET_PLAY_SPEED':
      return { ...state, playSpeed: action.speed };
    case 'SET_RENDER_META':
      return {
        ...state,
        currentColorHex: action.currentColorHex,
        palette: action.palette,
        currentColorIndex: action.currentColorIndex,
        lastComment: action.lastComment,
      };
    default:
      return state;
  }
}

const ProjectContext = createContext<ProjectState>(initialState);
const ProjectDispatchContext = createContext<Dispatch<ProjectAction>>(() => {});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <ProjectContext.Provider value={state}>
      <ProjectDispatchContext.Provider value={dispatch}>
        {children}
      </ProjectDispatchContext.Provider>
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}

export function useProjectDispatch() {
  return useContext(ProjectDispatchContext);
}
