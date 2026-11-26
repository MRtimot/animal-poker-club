// 百家乐外观选择（纯视觉，只保存在这台设备）：牌桌主题、牌面、筹码。不影响牌、概率或赔付。
import { useSettings } from '../../store/settingsStore';
import { CARD_SKINS, CHIP_SKINS, TABLE_THEMES, type CardSkinId, type ChipSkinId, type TableThemeId } from '../../three/skins';

export function BacCosmetics() {
  const table = useSettings((s) => s.bacTable);
  const cards = useSettings((s) => s.bacCards);
  const chips = useSettings((s) => s.bacChips);
  const set = useSettings((s) => s.set);
  return (
    <div className="bac-cos">
      <div className="field">
        <label>牌桌主题</label>
        <div className="bac-swatches" role="radiogroup" aria-label="牌桌主题">
          {(Object.keys(TABLE_THEMES) as TableThemeId[]).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={table === id} className={table === id ? 'on' : ''} onClick={() => set({ bacTable: id })}>
              <i style={{ background: `radial-gradient(circle at 40% 35%, ${TABLE_THEMES[id].felt}, ${TABLE_THEMES[id].rail})`, borderColor: TABLE_THEMES[id].accent }} aria-hidden />
              {TABLE_THEMES[id].name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>牌面</label>
        <div className="bac-swatches" role="radiogroup" aria-label="牌面">
          {(Object.keys(CARD_SKINS) as CardSkinId[]).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={cards === id} className={cards === id ? 'on' : ''} onClick={() => set({ bacCards: id })}>
              <i className="bac-cardchip" style={{ background: CARD_SKINS[id].back, borderColor: CARD_SKINS[id].paper }} aria-hidden />
              {CARD_SKINS[id].name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>筹码</label>
        <div className="bac-swatches" role="radiogroup" aria-label="筹码">
          {(Object.keys(CHIP_SKINS) as ChipSkinId[]).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={chips === id} className={chips === id ? 'on' : ''} onClick={() => set({ bacChips: id })}>
              <i className="bac-chipdot" style={{ background: CHIP_SKINS[id].colors[1000] ?? '#c49a32', borderColor: CHIP_SKINS[id].colors[100] ?? '#1b1b20' }} aria-hidden />
              {CHIP_SKINS[id].name}
            </button>
          ))}
        </div>
      </div>
      <div className="small muted">外观只改变画面：牌的点数与花色、概率、赔率都不会改变。</div>
    </div>
  );
}
