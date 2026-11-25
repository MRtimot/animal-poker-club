import { ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { isPC } from '../../utils/pc';
import type { Card } from '../../core/cards/card';
import { SUIT_SYMBOL, isRed, rankLabel } from '../../core/cards/card';
import { AnimalConfig, FUR_COLORS, SPECIES_MAP } from '../../core/player/profile';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import { levelProgress } from '../../progress/progression';
import { sound } from '../../audio/sound';

export function Btn({ children, kind = 'gold', size, block, onClick, disabled, title, className = '' }: {
  children: ReactNode;
  kind?: 'gold' | 'pink' | 'cyan' | 'green' | 'red' | 'ghost';
  size?: 'sm' | 'lg';
  block?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      className={`btn ${kind !== 'gold' ? 'btn-' + kind : ''} ${size ? 'btn-' + size : ''} ${block ? 'btn-block' : ''} ${className}`}
      onClick={() => {
        sound.play('button');
        onClick?.();
      }}
      onPointerUp={(e) => {
        // 松开时弹回：96% → 103% → 100%
        const el = e.currentTarget;
        el.classList.remove('btn-release');
        void el.offsetWidth;
        el.classList.add('btn-release');
      }}
      onAnimationEnd={(e) => e.currentTarget.classList.remove('btn-release')}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function Seg<T extends string | number>({ options, value, onChange, disabled }: {
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === value ? 'on' : ''}
          disabled={disabled || o.disabled}
          onClick={() => {
            sound.play('tick');
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, children, onClose, actions, width }: { title?: ReactNode; children: ReactNode; onClose?: () => void; actions?: ReactNode; width?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // 电脑版键盘操作：打开时焦点移进对话框，Tab / Shift+Tab 在对话框内循环，关闭后焦点回到原来的位置
  useEffect(() => {
    const el = box.current;
    if (!el || !isPC()) return;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
        (x) => x.offsetParent !== null,
      );
    (focusables()[0] ?? el).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return e.preventDefault();
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      if (prev && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={box}
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        {title && <h2 id={titleId}>{title}</h2>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function MiniCard({ card, highlight }: { card: Card | null; highlight?: boolean }) {
  if (!card) return <div className="mini-card back" />;
  return (
    <div className={`mini-card ${isRed(card) ? 'red' : ''} ${highlight ? 'hl' : ''}`}>
      <span>{rankLabel(card.rank)}</span>
      <span className="s">{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}

export function furHex(a: AnimalConfig) {
  return FUR_COLORS.find((f) => f.id === a.furColor)?.hex || SPECIES_MAP[a.species].color;
}

/** 玩家头像：登录玩家显示 Google 公开头像，否则（或加载失败时）显示默认动物头像 */
/**
 * 防止重复点击：点击后进入“处理中”，直到服务器回应（出现新的错误提示、或组件状态变化）或超时。
 * resetKey 变化（例如房间状态改变）时自动结束。
 */
export function useBusy(resetKey?: unknown, timeoutMs = 6000) {
  const [busy, setBusy] = useState(false);
  // ref 立即生效：同一瞬间的连续点击（状态还没来得及更新）也只会执行一次
  const lock = useRef(false);
  const lastError = useGame((s) => s.toasts.filter((t) => t.kind === 'error').at(-1)?.id);
  useEffect(() => {
    lock.current = false;
    setBusy(false);
  }, [resetKey]);
  useEffect(() => {
    // 错误提示消失（变回 undefined）不算新的回应：否则上一次的提示淡出时，会把这一次的“处理中”提前解除
    if (lastError === undefined) return;
    lock.current = false;
    setBusy(false);
  }, [lastError]);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => {
      lock.current = false;
      setBusy(false);
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [busy, timeoutMs]);
  /** 返回 false 表示已经在处理中，本次点击应忽略 */
  const begin = useCallback(() => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    return true;
  }, []);
  return [busy, begin] as const;
}

export function Avatar({ animal, size, src }: { animal: AnimalConfig; size?: 'sm' | 'lg'; src?: string | null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (src && !broken)
    return (
      <div className={`avatar avatar-img ${size ?? ''}`}>
        <img src={src} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} />
      </div>
    );
  return (
    <div className={`avatar ${size ?? ''}`} style={{ background: `radial-gradient(circle at 35% 30%, #ffffff55, ${furHex(animal)})` }}>
      {SPECIES_MAP[animal.species].emoji}
    </div>
  );
}

export function LevelBar() {
  const xp = useProfile((s) => s.xp);
  const p = levelProgress(xp);
  return (
    <div className="levelbar" title={`经验值 ${p.into}/${p.need}`}>
      <span className="lv">Lv.{p.level}</span>
      <div className="bar">
        <div style={{ width: `${Math.round(p.ratio * 100)}%` }} />
      </div>
      <span className="small muted">
        {p.into}/{p.need} XP
      </span>
    </div>
  );
}

export function BackButton({ onClick, label = '返回' }: { onClick: () => void; label?: string }) {
  return (
    <div className="back-btn">
      <Btn kind="ghost" size="sm" onClick={onClick}>
        ← {label}
      </Btn>
    </div>
  );
}
