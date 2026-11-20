import { ReactNode, useEffect } from 'react';
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
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal panel" style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        {title && <h2>{title}</h2>}
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

export function Avatar({ animal, size }: { animal: AnimalConfig; size?: 'sm' }) {
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
