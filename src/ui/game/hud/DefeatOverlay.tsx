// 失败演出的画面层：电影遮幅、暗角与克制的暗红边缘、冲击闪光、黑屏、“出局”画面、跳过按钮。
// 出局处决（完整版）：最后一句话的字幕、处决瞬间横过画面的一道刀光与“白 → 暗红”的闪光。
// 状态全部来自失败演出（animation/defeat）；这里不计时、不判断结果。
import { useEffect } from 'react';
import type { TableView } from '../../../core/game/view';
import { useDefeat } from '../../../animation/defeat/defeatStore';
import { finishDefeat, skipDefeat } from '../../../animation/defeat/useDefeatDirector';
import type { DefeatPhase } from '../../../animation/defeat/defeatRules';
import { useSettings } from '../../../store/settingsStore';
import { useGame } from '../../../store/gameStore';
import { session } from '../../../net/session';
import { formatChips } from '../../../utils/format';

const BARS: DefeatPhase[] = ['realize', 'winner', 'reaction', 'tension', 'lastword', 'prep', 'ecu', 'insert', 'silence', 'impact', 'headfall', 'collapse', 'aftermath'];
const TENSE: DefeatPhase[] = ['tension', 'lastword', 'prep', 'ecu', 'insert', 'silence'];
const SKIPPABLE: DefeatPhase[] = ['result', 'realize', 'winner', 'reaction', 'tension', 'lastword', 'prep', 'ecu', 'insert', 'silence', 'impact', 'headfall', 'collapse', 'aftermath', 'blackout'];

export function DefeatOverlay({ view }: { view: TableView }) {
  const seq = useDefeat((s) => s.seq);
  const phase = useDefeat((s) => s.phase);
  const skipped = useDefeat((s) => s.skipped);
  const seen = useSettings((s) => s.defeatSeen);
  const mode = useGame((s) => s.mode);

  // 电脑：Esc 跳过演出 / 在“出局”画面上继续
  useEffect(() => {
    if (!seq) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const ph = useDefeat.getState().phase;
      if (ph && SKIPPABLE.includes(ph) && useSettings.getState().defeatSeen) skipDefeat();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seq?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!seq || !phase) return null;
  const full = seq.cut === 'full';
  const bars = BARS.includes(phase) || (!full && phase === 'defeated');
  const tense = TENSE.includes(phase);
  const dark = full && (phase === 'blackout' || phase === 'defeated');
  const canSkip = seen && SKIPPABLE.includes(phase) && !(skipped && full);
  const gameOver = !!view.gameOver;

  return (
    <div className={`dcine ${full ? 'full' : 'short'} ph-${phase}${seq.reduced ? ' reduced' : ''}`} aria-live="polite">
      <div className={`dcine-vig${tense ? ' tense' : ''}${phase !== 'result' && phase !== 'recover' ? ' on' : ''}`} aria-hidden />
      <div className={`dcine-bar top${bars ? ' on' : ''}`} aria-hidden />
      <div className={`dcine-bar bottom${bars ? ' on' : ''}`} aria-hidden />
      {phase === 'impact' && !skipped && <div key={seq.key} className={`dcine-flash${full ? ' exec' : ''}`} style={{ ['--flash' as string]: seq.profile.flash }} aria-hidden />}
      {/* 处决的一瞬间：一道刀光横过画面（减少动态效果时不显示，只保留柔和的闪光） */}
      {full && phase === 'impact' && !skipped && !seq.reduced && <div key={seq.key + '-slash'} className={`dcine-slash${seq.decap?.side === -1 ? ' flip' : ''}`} aria-hidden />}
      {/* 最后一句话：字幕（声音由角色语音播放；关闭语音时只有字幕） */}
      {full && phase === 'lastword' && !skipped && seq.decap?.lastWords && (
        <div key={seq.key + '-lw'} className="dcine-lastword" role="status">
          「{seq.decap.lastWords}」
        </div>
      )}
      {full && <div className={`dcine-black${dark ? ' on' : ''}`} aria-hidden />}
      {/* 黑屏之后边缘极淡的暗红残影，几秒内消失（不会一直留着） */}
      {full && phase === 'defeated' && !skipped && <div key={`${seq.key}-after`} className="dcine-after" aria-hidden />}

      {full && phase === 'defeated' && (
        <div className="dcine-card" role="dialog" aria-modal="true" aria-labelledby="dcine-title">
          <div className="dcine-eyebrow">DEFEATED</div>
          <h2 id="dcine-title" className="dcine-title">
            你出局了
          </h2>
          <div className="dcine-rule" aria-hidden />
          <p className="dcine-sub">{gameOver ? '牌桌会记住这一手。' : '这一手，你输掉了全部筹码。'}</p>
          <div className="dcine-actions">
            {gameOver ? (
              <>
                <button type="button" className="dcine-btn primary" onClick={finishDefeat} autoFocus>
                  查看结果
                </button>
                <button type="button" className="dcine-btn" onClick={() => session.leave(mode === 'online' ? 'online' : 'home')}>
                  返回俱乐部
                </button>
              </>
            ) : (
              <>
                <button type="button" className="dcine-btn primary" onClick={finishDefeat} autoFocus>
                  继续观战
                </button>
                <button type="button" className="dcine-btn" onClick={() => session.leave(mode === 'online' ? 'online' : 'home')}>
                  {mode === 'online' ? '离开房间' : '返回俱乐部'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!full && (phase === 'defeated' || phase === 'recover') && (
        <div className={`dcine-caption${phase === 'recover' ? ' out' : ''}`} role="status">
          <div className="dcine-eyebrow">DEFEATED</div>
          <div className="dcine-caption-title">这一手，你输了</div>
          <div className="dcine-caption-sub">
            输掉 {formatChips(seq.lost)} 筹码 · {Math.round(seq.ratio * 100)}%
          </div>
        </div>
      )}

      {canSkip && (
        <button type="button" className="dcine-skip" onClick={skipDefeat} aria-label="跳过失败演出（结果不变）">
          跳过 <span aria-hidden>›</span>
        </button>
      )}
    </div>
  );
}
