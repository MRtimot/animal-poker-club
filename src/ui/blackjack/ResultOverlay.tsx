// 结果演出的画面层：安静 → 揭晓 → 派彩。不计时、不判断结果；可以跳过（只跳过画面）
import { useEffect } from 'react';
import type { BlackjackView } from '../../core/blackjack/types';
import { OUTCOME_TITLE, useBjCine } from '../../animation/blackjack/cineStore';
import { skipBjCine } from '../../animation/blackjack/useBlackjackDirector';
import { formatChips } from '../../utils/format';
import { hotkeyBlocked } from './hotkeys';

export function ResultOverlay({ view }: { view: BlackjackView }) {
  const cine = useBjCine((s) => s.cine);
  const playing = cine !== null;
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || hotkeyBlocked(e)) return;
      skipBjCine();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);
  if (!cine || cine.roundId !== view.roundId) return null;
  const t = OUTCOME_TITLE[cine.outcome];
  const open = cine.phase !== 'hush';
  const sign = cine.profit > 0 ? `+${formatChips(cine.profit)}` : cine.profit < 0 ? `−${formatChips(-cine.profit)}` : formatChips(cine.bet);
  return (
    <div className={`bjr ${cine.outcome} ph-${cine.phase}`}>
      <div className="bjr-vig" aria-hidden />
      {open && (
        <div className="bjr-card" role="status" aria-live="assertive">
          <div className="bjr-rule" aria-hidden />
          <div className="bjr-en">{t.en}</div>
          <div className="bjr-zh">{t.zh}</div>
          <div className="bjr-vals">
            {cine.outcome === 'bust' ? (
              <span>{cine.value} 点</span>
            ) : (
              <>
                <span>你 {cine.value}</span>
                <i aria-hidden />
                <span>庄家 {cine.dealerValue}</span>
              </>
            )}
          </div>
          <div className={`bjr-profit ${cine.profit > 0 ? 'up' : cine.profit < 0 ? 'down' : ''}`}>
            {cine.profit === 0 ? '退回 ' : ''}
            {sign}
          </div>
          <div className="bjr-rule" aria-hidden />
        </div>
      )}
      <button type="button" className="bjr-skip" onClick={skipBjCine} aria-label="跳过结果演出（结果不变）">
        跳过 <span aria-hidden>›</span>
      </button>
    </div>
  );
}
