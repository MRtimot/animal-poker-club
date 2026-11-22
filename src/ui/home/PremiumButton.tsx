// 首页统一的高级按钮（Premium Button System）
// primary：金色主按钮（开始游戏） · secondary：玻璃 + 细金边（探索 / 创建房间） · ghost：文字按钮
// 状态：静止有轻微立体感；悬停时上浮、出现扫光与柔和光晕；按下轻微压缩；键盘焦点有清晰的焦点环。
import type { ReactNode } from 'react';

export type PremiumVariant = 'primary' | 'secondary' | 'ghost';

export function PremiumButton({
  variant = 'primary',
  size = 'md',
  onClick,
  children,
  icon,
  disabled,
  ariaLabel,
}: {
  variant?: PremiumVariant;
  size?: 'md' | 'lg';
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button type="button" className={`pbtn pbtn-${variant} pbtn-${size}`} onClick={onClick} disabled={disabled} aria-label={ariaLabel ?? (typeof children === 'string' ? children : undefined)}>
      <span className="pbtn-sheen" aria-hidden />
      {icon && (
        <span className="pbtn-icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="pbtn-label">{children}</span>
    </button>
  );
}
