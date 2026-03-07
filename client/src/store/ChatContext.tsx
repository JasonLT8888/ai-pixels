import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { ChatMessage } from 'shared/src/types';

export interface ChatInfo {
  id: number;
  title: string;
  canvas_w: number;
  canvas_h: number;
  created_at: string;
  message_count: number;
  last_assistant_content?: string | null;
  compressed_summary?: string | null;
  compress_before_id?: number | null;
}

export interface ChatState {
  messages: ChatMessage[];
  streaming: boolean;
  streamingText: string;
  inputText: string;
  error: string | null;
  models: string[];
  selectedModel: string;
  currentChatId: number | null;
  chatList: ChatInfo[];
  compressedSummary: string | null;
  compressBeforeId: number | null;
  compressing: boolean;
}

export type ChatAction =
  | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'SET_STREAMING'; streaming: boolean }
  | { type: 'APPEND_STREAMING_TEXT'; delta: string }
  | { type: 'RESET_STREAMING_TEXT' }
  | { type: 'SET_INPUT'; text: string }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_MODELS'; models: string[] }
  | { type: 'SET_SELECTED_MODEL'; model: string }
  | { type: 'SET_CURRENT_CHAT'; chatId: number | null }
  | { type: 'SET_CHAT_LIST'; chatList: ChatInfo[] }
  | { type: 'ADD_CHAT'; chat: ChatInfo }
  | { type: 'REMOVE_CHAT'; chatId: number }
  | { type: 'SET_COMPRESSION'; summary: string | null; beforeId: number | null }
  | { type: 'SET_COMPRESSING'; compressing: boolean };

const initialState: ChatState = {
  messages: [],
  streaming: false,
  streamingText: '',
  inputText: '',
  error: null,
  models: [],
  selectedModel: '',
  currentChatId: null,
  chatList: [],
  compressedSummary: null,
  compressBeforeId: null,
  compressing: false,
};

function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_MESSAGES':
      return { ...state, messages: action.messages };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] };
    case 'SET_STREAMING':
      return { ...state, streaming: action.streaming };
    case 'APPEND_STREAMING_TEXT':
      return { ...state, streamingText: state.streamingText + action.delta };
    case 'RESET_STREAMING_TEXT':
      return { ...state, streamingText: '' };
    case 'SET_INPUT':
      return { ...state, inputText: action.text };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'SET_MODELS':
      return { ...state, models: action.models };
    case 'SET_SELECTED_MODEL':
      return { ...state, selectedModel: action.model };
    case 'SET_CURRENT_CHAT':
      return { ...state, currentChatId: action.chatId };
    case 'SET_CHAT_LIST':
      return { ...state, chatList: action.chatList };
    case 'ADD_CHAT':
      return { ...state, chatList: [action.chat, ...state.chatList] };
    case 'REMOVE_CHAT':
      return { ...state, chatList: state.chatList.filter((c) => c.id !== action.chatId) };
    case 'SET_COMPRESSION':
      return { ...state, compressedSummary: action.summary, compressBeforeId: action.beforeId };
    case 'SET_COMPRESSING':
      return { ...state, compressing: action.compressing };
    default:
      return state;
  }
}

const ChatContext = createContext<ChatState>(initialState);
const ChatDispatchContext = createContext<Dispatch<ChatAction>>(() => {});

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <ChatContext.Provider value={state}>
      <ChatDispatchContext.Provider value={dispatch}>
        {children}
      </ChatDispatchContext.Provider>
    </ChatContext.Provider>
  );
}

export function useChat() {
  return useContext(ChatContext);
}

export function useChatDispatch() {
  return useContext(ChatDispatchContext);
}
