import { useGame } from '../../store/gameStore';

/** 快捷键不生效的情况：打开了任何对话框、正在输入文字、组合键、一直按住（重复键） */
export function hotkeyBlocked(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || useGame.getState().modal || document.querySelector('.modal-backdrop')) return true;
  const tag = (e.target as HTMLElement)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
