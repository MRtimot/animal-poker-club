// 本地牌桌只会有一张：开新的一桌（不管哪种模式）之前先停掉上一桌；离开时也从这里停。
let stop: (() => void) | null = null;

export function claimLocalTable(stopFn: () => void) {
  if (stop && stop !== stopFn) stop();
  stop = stopFn;
}

export function stopLocalTable() {
  stop?.();
  stop = null;
}
