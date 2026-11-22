// 首页操作（Context）：所有按钮都连接到现有的真实页面，不做假功能
import { createContext, useContext } from 'react';
import type { HomeSectionId } from './homeTimeline';

/** 首页上的所有操作（全部连接到现有的真实页面，不做假功能） */
export interface HomeActions {
  play: () => void;
  createRoom: () => void;
  joinRoom: () => void;
  aiMode: () => void;
  creator: () => void;
  collection: () => void;
  settings: () => void;
  rules: () => void;
  scrollTo: (id: HomeSectionId | 'top') => void;
}

export const HomeActionsContext = createContext<HomeActions | null>(null);
export function useHomeActions(): HomeActions {
  const a = useContext(HomeActionsContext);
  if (!a) throw new Error('HomeActionsContext 未提供');
  return a;
}

