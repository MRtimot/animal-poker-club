import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { SeatView, TableView } from '../../core/game/view';
import type { Card } from '../../core/cards/card';
import { ACTION_NAME } from '../../core/table/types';
import { AnimalModel } from '../animals/AnimalModel';
import { Card3D } from '../cards/Card3D';
import { ChipPile, ChipFlights } from '../chips/Chips';
import { Chair, ClubEnvironment, PokerTableMesh } from '../environment/ClubEnvironment';
import { CameraRig } from '../camera/CameraRig';
import { Bursts } from '../effects/Bursts';
import { DECK_POS, POT_POS, SeatLayout, TABLE_Y, boardPos, computeLayout } from '../layout';
import { useFx } from '../../store/fxStore';
import { useGame } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { formatChips } from '../../utils/format';
import { cardBackTexture } from '../textures';
import { SceneLights } from './SceneLights';

function seatStatus(p: SeatView, view: TableView): { text: string; cls: string } {
  if (!p.connected && !p.isAI) return { text: '离线', cls: 'offline' };
  if (p.busted) return { text: '已出局', cls: 'out' };
  if (p.sittingOut) return { text: '已离开', cls: 'out' };
  if (view.currentPlayerId === p.id) return { text: '思考中…', cls: 'thinking' };
  if (p.folded) return { text: '弃牌', cls: 'fold' };
  if (p.allIn) return { text: '全押', cls: 'allin' };
  const la = p.lastAction;
  if (la) {
    if (la.type === 'sb') return { text: `小盲 ${formatChips(la.amount)}`, cls: '' };
    if (la.type === 'bb') return { text: `大盲 ${formatChips(la.amount)}`, cls: '' };
    const name = ACTION_NAME[la.type];
    return { text: la.type === 'call' || la.type === 'raise' ? `${name} ${formatChips(la.amount)}` : name, cls: la.type };
  }
  return { text: '', cls: '' };
}

function TurnTimer({ view }: { view: TableView }) {
  const offset = useGame((s) => s.clockOffset);
  if (!view.turnDeadline) return null;
  const remaining = Math.max(0, view.turnDeadline - (Date.now() + offset));
  const total = Math.max(1, view.turnTotalMs);
  return (
    <div className="nt-timer">
      <div
        key={view.turnDeadline}
        className="nt-timer-bar"
        style={{ animationDuration: `${remaining}ms`, width: `${(remaining / total) * 100}%` }}
      />
    </div>
  );
}

function Bubble({ playerId }: { playerId: string }) {
  const b = useFx((s) => s.bubbles.find((x) => x.playerId === playerId));
  if (!b) return null;
  return (
    <div key={b.id} className={`bubble ${b.kind === 'emote' ? 'bubble-emote' : ''}`}>
      {b.text}
    </div>
  );
}

const NameTag = memo(function NameTag({ p, view, layout, winAmount }: { p: SeatView; view: TableView; layout: SeatLayout; winAmount: number }) {
  const st = seatStatus(p, view);
  const isCurrent = view.currentPlayerId === p.id;
  const badges: string[] = [];
  if (view.dealerId === p.id) badges.push('庄');
  if (view.sbId === p.id && view.phase !== 'idle') badges.push('小盲');
  if (view.bbId === p.id && view.phase !== 'idle') badges.push('大盲');
  return (
    <Html position={layout.tag} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`nametag ${isCurrent ? 'current' : ''} ${p.folded ? 'folded' : ''} ${layout.isViewer ? 'me' : ''}`}>
        <Bubble playerId={p.id} />
        <div className="nt-name">
          {p.name}
          {layout.isViewer && <span className="nt-you">你</span>}
          {p.isAI && <span className="nt-ai">AI</span>}
        </div>
        <div className="nt-chips">🪙 {formatChips(p.chips)}</div>
        {badges.length > 0 && (
          <div className="nt-badges">
            {badges.map((b) => (
              <span key={b} className={`badge badge-${b === '庄' ? 'd' : b === '小盲' ? 'sb' : 'bb'}`}>
                {b}
              </span>
            ))}
          </div>
        )}
        {st.text && <div className={`nt-status ${st.cls}`}>{st.text}</div>}
        {p.shown && !p.folded && <div className="nt-hand">{p.shown.handName}</div>}
        {isCurrent && <TurnTimer view={view} />}
        {winAmount > 0 && <div className="nt-win">+{formatChips(winAmount)}</div>}
      </div>
    </Html>
  );
});

function PlayerSeat({ p, view, layout, dealOrder, highlight, winAmount, seedIndex }: {
  p: SeatView;
  view: TableView;
  layout: SeatLayout;
  dealOrder: string[];
  highlight: Set<string>;
  winAmount: number;
  seedIndex: number;
}) {
  const rotY = layout.angle + Math.PI;
  const tangent: [number, number] = [Math.cos(layout.angle), -Math.sin(layout.angle)];
  const thinking = view.currentPlayerId === p.id;
  const showdown = view.phase === 'showdown' || view.phase === 'complete';
  return (
    <group>
      <Chair position={[layout.seat[0], 0, layout.seat[2]]} rotY={rotY} color={layout.isViewer ? '#1f5c8a' : '#7a1f2b'} />
      <group position={layout.seat} rotation={[0, rotY, 0]}>
        {!p.busted && !p.sittingOut && <AnimalModel config={p.profile.animal} animKey={p.id} seated folded={p.folded} thinking={thinking} seed={seedIndex} />}
      </group>
      <NameTag p={p} view={view} layout={layout} winAmount={winAmount} />

      {/* 底牌 */}
      {p.hole.map((c, i) => {
        const side = i === 0 ? -1 : 1;
        const spread = layout.isViewer ? 0.3 : 0.2;
        const pos: [number, number, number] = p.folded
          ? [layout.muck[0] + side * 0.08, layout.muck[1] + i * 0.009, layout.muck[2]]
          : [
              layout.cards[0] + tangent[0] * side * spread,
              layout.cards[1] + (layout.isViewer ? 0.18 : 0) + i * 0.004,
              layout.cards[2] + tangent[1] * side * spread,
            ];
        // 发牌顺序：第 i 轮中该玩家的位置
        let idx = 0;
        let seen = 0;
        for (let k = 0; k < dealOrder.length; k++) {
          if (dealOrder[k] === p.id) {
            if (seen === i) {
              idx = k;
              break;
            }
            seen++;
          }
        }
        const faceUp = !!c && !p.folded && (layout.isViewer || showdown);
        return (
          <Card3D
            key={`${view.handNumber}-${p.id}-${i}`}
            card={c}
            target={pos}
            yaw={layout.angle + (p.folded ? 0.6 + i * 0.4 : side * 0.06)}
            tilt={layout.isViewer && !p.folded ? 0.55 : 0}
            faceUp={faceUp}
            delay={idx * 160}
            highlight={!!c && highlight.has(c.id)}
            silent={!layout.isViewer && idx % 2 === 1}
          />
        );
      })}

      {/* 下注筹码 */}
      <ChipPile amount={p.bet} position={layout.bet} />
    </group>
  );
}

function DealerButton({ layout }: { layout?: SeatLayout }) {
  const ref = useRef<THREE.Group>(null!);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fffdf5';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c9a227';
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = '#1d1d2b';
    g.font = 'bold 64px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('庄', 64, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useFrame(() => {
    if (!layout || !ref.current) return;
    ref.current.position.lerp(new THREE.Vector3(...layout.button), 0.08);
  });
  if (!layout) return null;
  return (
    <group ref={ref} position={layout.button}>
      <mesh castShadow position={[0, 0.025, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.05, 32]} />
        <meshStandardMaterial attach="material-0" color="#fffdf5" roughness={0.4} />
        <meshStandardMaterial attach="material-1" map={tex} roughness={0.4} />
        <meshStandardMaterial attach="material-2" color="#fffdf5" />
      </mesh>
    </group>
  );
}

function Deck() {
  const back = useMemo(() => cardBackTexture(), []);
  return (
    <group position={[DECK_POS[0], TABLE_Y, DECK_POS[2]]} rotation={[0, 0.2, 0]}>
      <mesh castShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[0.5, 0.1, 0.7]} />
        <meshStandardMaterial attach="material-0" color="#efe8d8" />
        <meshStandardMaterial attach="material-1" color="#efe8d8" />
        <meshStandardMaterial attach="material-2" map={back} />
        <meshStandardMaterial attach="material-3" color="#efe8d8" />
        <meshStandardMaterial attach="material-4" color="#efe8d8" />
        <meshStandardMaterial attach="material-5" color="#efe8d8" />
      </mesh>
    </group>
  );
}

function PotLabel({ view }: { view: TableView }) {
  if (view.potTotal <= 0) return null;
  const side = view.pots.length > 1;
  return (
    <Html position={[POT_POS[0], POT_POS[1] + 0.55, POT_POS[2]]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="pot-label">
        <div>底池 {formatChips(view.potTotal)}</div>
        {side && (
          <div className="pot-side">
            {view.pots.map((p, i) => (
              <span key={i}>
                {i === 0 ? '主池' : `边池${i}`} {formatChips(p)}
              </span>
            ))}
          </div>
        )}
      </div>
    </Html>
  );
}

export function GameScene({ view }: { view: TableView }) {
  const quality = useSettings((s) => s.quality);
  const cameraMode = useGame((s) => s.cameraMode);
  const ids = view.players.map((p) => p.id).join(',');
  const layout = useMemo(() => computeLayout(view), [ids, view.viewerId]); // eslint-disable-line

  const dealOrder = useMemo(() => {
    const ev = view.events.find((e) => e.type === 'dealHole');
    return ev && ev.type === 'dealHole' ? ev.order : [];
  }, [view.events]);

  // 获胜高亮的牌
  const { highlight, wins } = useMemo(() => {
    const h = new Set<string>();
    const w = new Map<string, number>();
    if (view.summary && view.phase === 'complete') {
      for (const win of view.summary.winners) {
        w.set(win.playerId, (w.get(win.playerId) ?? 0) + win.amount);
        const shown = view.summary.shown.find((s) => s.playerId === win.playerId);
        shown?.bestCards.forEach((c: Card) => h.add(c.id));
      }
    }
    return { highlight: h, wins: w };
  }, [view.summary, view.phase]);

  useEffect(() => () => useFx.getState().reset(), []);

  return (
    <>
      <SceneLights quality={quality} />
      <ClubEnvironment quality={quality} />
      <PokerTableMesh />
      <Deck />
      {view.players.map((p, i) => (
        <PlayerSeat
          key={p.id}
          p={p}
          view={view}
          layout={layout.get(p.id)!}
          dealOrder={dealOrder}
          highlight={highlight}
          winAmount={wins.get(p.id) ?? 0}
          seedIndex={i}
        />
      ))}
      {view.board.map((c, i) => (
        <Card3D
          key={`${view.handNumber}-b-${c.id}`}
          card={c}
          target={boardPos(i)}
          faceUp
          delay={i < 3 ? i * 170 : 0}
          highlight={highlight.has(c.id)}
          flightMs={560}
        />
      ))}
      <ChipPile amount={view.potCollected} position={POT_POS} delay={700} />
      <PotLabel view={view} />
      <ChipFlights />
      <Bursts density={quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1} />
      <DealerButton layout={view.dealerId ? layout.get(view.dealerId) : undefined} />
      <CameraRig mode={cameraMode} layout={layout} />
    </>
  );
}
