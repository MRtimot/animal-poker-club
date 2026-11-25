# BLACKJACK 21 开发文档

21 点是俱乐部的第二个游戏模式。它与德州扑克共用房间、账号、存档、音频、3D 牌桌、动物、镜头与页面（`screen: 'game'`），
只有规则引擎、控制器、桌面布局和 HUD 是新的。没有付费服务，没有真钱，只有虚拟金币 / 筹码。

## 1. 规则（`src/core/blackjack/rules.ts`）

| 规则 | 设定 |
| --- | --- |
| 牌靴 | 6 副牌；用掉 75% 后在下一局开始前重新洗牌（`crypto.getRandomValues`，Fisher–Yates） |
| 庄家 | 17 点及以上一律停牌（含软 17）；明牌是 A / 10 点时先看暗牌（peek），黑杰克立即结束 |
| 黑杰克 | 起手两张 A + 10 点，3:2，盈利向下取整（筹码始终是整数）；拆牌后的 21 点不算黑杰克 |
| 赔付 | 赢 1:1，平局退回本金，输 / 爆牌 0；玩家与庄家都是黑杰克 = 平局 |
| 加倍 | 起手两张时可加倍一次，只再拿一张；拆牌后也可以加倍 |
| 拆牌 | 点数相同（10 与 K 可拆），最多 4 手；拆 A 每手只拿一张，不能再要牌 |
| 保险 | **没有实现**，界面里也没有任何保险按钮 |
| 离桌 | 一局中途离开 = 放弃桌上的下注，按输结算一次 |

限额：单人桌三档（10–200 / 50–1000 / 200–5000）；在线房间最低下注 = 房间的大盲，最高 = 初始筹码。

## 2. 引擎（`engine.ts`，纯逻辑）

- 不依赖 UI、网络、时间；一步一步走：下注 → 发牌 → 玩家行动 → 庄家 → 结算 → 派彩 → 结束。
- 状态机见 `types.ts` 的 `BJ_TRANSITIONS`；非法跳转直接抛错（说明程序有 bug），非法操作抛 `BlackjackError`（给玩家看的原因）。
- A 的点数由 `hand.ts` 的 `evaluateBlackjack` 决定（尽量按 11，超过 21 就按 1），界面不自己算牌。
- 筹码守恒：余额 + 桌上下注 + 派彩在任何一步都可核对，`tests/blackjack.test.ts` 有随机模糊测试。
- 状态可以 `JSON.stringify` 保存；服务器换一台机器也能接着打。

## 3. 控制器（`controller.ts`）

与德州的 `GameController` 同形（`tick / nextWakeAt / toState / fromState / handle / getView`），只决定**什么时候**走下一步：

- 下注倒计时 15 秒（第一位真人下注后才开始；没人下注时牌桌不会自己空转），行动倒计时由房间设置决定，离线玩家更短。
- 超时 = 停牌；不下注 = 旁观这一局。单人桌没有倒计时。
- `token`：每当“谁能做什么”改变就 +1。客户端的操作带着 `round` + `token`，对不上就拒绝（过期 / 重复 / 连点）。
- 表现永远不会反过来影响结果：结果先确定，画面随后播放。

## 4. 本地与在线的权威

| | 谁裁决 | 筹码 |
| --- | --- | --- |
| 游客单人 | 浏览器里的同一套控制器（`src/net/localBlackjack.ts`） | 持久金币（本地存档） |
| 登录玩家单人 | 服务器 | 账号的虚拟筹码（数据库） |
| 登录但连不上服务器 | 浏览器 | 练习桌，**不影响账号** |
| 在线房间 | 服务器 | 桌上筹码（与德州房间相同，不动账号筹码） |

本地离线模式不以防作弊为目标：牌局与存档都在玩家自己的设备上。本地一局中途刷新网页，这一局作废、金币不变
（只恢复持久存档，不恢复半局）；从界面离开则按输结算。在线模式由服务器裁决，客户端只发送“我要下注 X / 要牌”，
从不发送余额、牌、派彩或胜负。

## 5. 在线事件（`src/core/protocol.ts`，协议版本 3）

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 客 → 服 | `createRoom { settings.gameMode }` | 建房时选择模式 |
| 客 → 服 | `setMode { gameMode }` | 房主在大厅切换模式；牌局进行中拒绝 |
| 客 → 服 | `bj { cmd, actionId, round, token }` | `cmd`：`bet / skip / hit / stand / double / split / next / rebuy` |
| 服 → 客 | `bjState { view }` | 只含该玩家能看到的内容；**暗牌翻开前视图与事件里都没有它的任何信息** |
| 服 → 客 | `ack { actionId, ok }` | 同一 `actionId` 只执行一次，重发返回同样的结果 |

断线重连、房主转移、踢人、限流、Redis 多实例都走原有的房间系统，没有第二套。

## 6. 庄家（`dealers.ts`、`dialogue.ts`）

庄家是现有的动物 + 现有的西装与领结。性格只影响台词、表情和节奏，**不影响洗牌、牌、概率或赔付**
（引擎根本不知道庄家是谁）。测试 BJ-58 用同一副牌靴比较不同性格的庄家，发出的牌、结果、赔付完全一样。

## 7. 结算、经验、统计、成就

- 每局有唯一 `roundId`；服务器结算键 `房间:局:bj:roundId`，本地用 `BlackjackGate`，重复处理不会重复发奖。
- 奖励规则在 `src/progress/rewards.ts`（`applyBlackjackRound`），服务器与游客共用。
- 统计在 `Stats.blackjack`；数据库迁移 v2 增加 `blackjack` 列（旧存档自动补零）。
- 成就：`bj_first`、`bj_ten`、`bj_win10`、`bj_double`、`bj_exact`、`bj_comeback`。

## 8. 画面

| 内容 | 位置 |
| --- | --- |
| 桌面布局、牌 / 筹码位置 | `src/three/blackjack/layout.ts` |
| 场景（复用俱乐部、牌桌、灯光、Card3D、筹码、动物） | `src/three/blackjack/BlackjackScene.tsx` |
| 事件 → 动作 / 筹码 / 镜头 / 音效 / 演出 | `src/animation/blackjack/useBlackjackDirector.ts` |
| 结果演出状态（hush → verdict → payout，可跳过） | `src/animation/blackjack/cineStore.ts` |
| HUD | `src/ui/blackjack/*` |

镜头取景避开 HUD：`CameraRig` 的 `blackjackInsets` 与 `blackjack.css` 的高度对应，改其中一个要同时改另一个。

## 9. 调试（只在开发模式）

网址加 `?debug=1`：调试面板显示模式、局号、阶段、点数、token、牌靴、演出状态。`npm run dev` 时，本地牌桌的下注阶段还有
`Force Blackjack / Bust / Push / Dealer Blackjack / Win / Loss / Split / Re-split` 按钮（只交换牌靴里牌的顺序，不改规则）。
正式构建不包含这些代码。

## 10. 测试

```bash
npx vitest run tests/blackjack.test.ts          # 规则、引擎、控制器、AI、模糊测试
npx vitest run tests/blackjack-online.test.ts   # 房间、权威、重连、重复 / 过期操作、账号结算
npm test && npm run typecheck && npm run build
```
