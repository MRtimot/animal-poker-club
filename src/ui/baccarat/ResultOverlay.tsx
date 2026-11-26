// 结果演出的画面层：安静 → 宣布 → 派彩。只读取已经确定的结果；可以跳过（只跳过画面）
import { useEffect } from 'react';
import type { BaccaratView } from '../../core/baccarat/types';
import { WINNER_TITLE, useBacCine } from '../../animation/baccarat/cineStore';
import { skipBacCine } from '../../animation/baccarat/useBaccaratDirector';
import { formatChips } from '../../utils/format';
import { hotkeyBlocked } from '../blackjack/hotkeys';

export function BacResultOverlay({ view }: { view: BaccaratView }) {
  const cine = useBacCine((s) => s.cine);
  const playing = cine !== null;
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || hotkeyBlocked(e)) return;
      skipBacCine();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);
  if (!cine || cine.roundId !== view.roundId) return null;
  const t = WINNER_TITLE[cine.winner];
  const open = cine.phase !== 'hush';
  return (
    <div className={`bacr ${cine.winner} ph-${cine.phase}`}>
      <div className="bacr-vig" aria-hidden />
      {open && (
        <div className="bacr-card" role="status" aria-live="assertive">
          <div className="bacr-rule" aria-hidden />
          <div className="bacr-en">{t.en}</div>
          <div className="bacr-zh">
            {t.zh}
            {cine.natural ? ' · 例牌' : ''}
          </div>
          <div className="bacr-vals">
            <span className={cine.winner === 'player' ? 'win' : ''}>闲 {cine.player}</span>
            <i aria-hidden />
            <span className={cine.winner === 'banker' ? 'win' : ''}>庄 {cine.banker}</span>
          </div>
          {cine.profit !== null && (
            <div className={`bacr-profit ${cine.profit > 0 ? 'up' : cine.profit < 0 ? 'down' : ''}`}>
              {cine.profit > 0 ? `+${formatChips(cine.profit)}` : cine.profit < 0 ? `−${formatChips(-cine.profit)}` : `退回 ${formatChips(cine.bet)}`}
            </div>
          )}
          <div className="bacr-rule" aria-hidden />
        </div>
      )}
      <button type="button" className="bacr-skip" onClick={skipBacCine} aria-label="跳过结果演出（结果不变）">
        跳过 <span aria-hidden>›</span>
      </button>
    </div>
  );
}
