// 本地存档导出 / 导入：格式校验与清洗（导入的数据不会破坏游戏）
import { describe, it, expect } from 'vitest';
import { SAVE_FORMAT, SaveError, parseSave } from '../src/save/saveFile';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';

const good = {
  format: SAVE_FORMAT,
  version: 1,
  exportedAt: Date.now(),
  profile: {
    name: '狐狸先生',
    animal: { ...DEFAULT_ANIMAL, species: 'fox', hat: 'crown' },
    characters: [{ id: 'abc', name: '兔兔', animal: { ...DEFAULT_ANIMAL, species: 'rabbit' }, createdAt: 1 }],
    xp: 1234,
    stats: { handsPlayed: 10, handsWon: 4 },
    achievements: { first_win: 123, not_real: 5 },
    recent: [{ time: 1, mode: 'online', place: 1, players: 4, hands: 12, chips: 4000 }],
    createdCharacter: true,
  },
  settings: { quality: 'high', musicVolume: 0.3, serverUrl: 'ws://evil', room: 'cabin' },
};

describe('存档文件', () => {
  it('导出的存档可以完整导入', () => {
    const s = parseSave(JSON.stringify(good));
    expect(s.profile.name).toBe('狐狸先生');
    expect(s.profile.animal.species).toBe('fox');
    expect(s.profile.animal.hat).toBe('crown');
    expect(s.profile.xp).toBe(1234);
    expect(s.profile.stats.handsPlayed).toBe(10);
    expect(s.profile.stats.folds).toBe(0);
    expect(s.profile.characters).toHaveLength(1);
    expect(s.profile.achievements).toEqual({ first_win: 123 });
    expect(s.settings).toEqual({ quality: 'high', musicVolume: 0.3, room: 'cabin' });
  });

  it('拒绝无效文件、其他游戏的文件、更新版本的存档', () => {
    expect(() => parseSave('not json')).toThrow(SaveError);
    expect(() => parseSave(JSON.stringify({ hello: 1 }))).toThrow(SaveError);
    expect(() => parseSave(JSON.stringify({ ...good, version: 99 }))).toThrow(/更新版本/);
    expect(() => parseSave('x'.repeat(600 * 1024))).toThrow(/过大/);
  });

  it('清洗非法数值', () => {
    const s = parseSave(
      JSON.stringify({
        ...good,
        profile: { ...good.profile, xp: -50, name: '<b>坏</b>', animal: { species: 'unicorn' }, characters: 'nope', recent: [{ place: 99, players: -1 }] },
        settings: { quality: 'insane', musicVolume: 7 },
      }),
    );
    expect(s.profile.xp).toBe(0);
    expect(s.profile.name).not.toContain('<');
    expect(s.profile.animal.species).toBe('cat');
    expect(s.profile.characters).toEqual([]);
    expect(s.profile.recent[0].place).toBe(8);
    expect(s.settings).toEqual({ musicVolume: 1 });
  });
});
