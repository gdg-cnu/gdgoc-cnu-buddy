'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mascot', {
  // 메인 → 렌더러 이벤트 구독
  onState: (cb) => ipcRenderer.on('mascot:state', (_e, d) => cb(d)),
  onNotify: (cb) => ipcRenderer.on('mascot:notify', (_e, d) => cb(d)),
  onDnd: (cb) => ipcRenderer.on('mascot:dnd', (_e, d) => cb(d)),

  // 렌더러 → 메인
  getAnims: () => ipcRenderer.invoke('mascot:getAnims'),
  dragStart: () => ipcRenderer.send('mascot:dragStart'),
  drag: (dx, dy) => ipcRenderer.send('mascot:drag', { dx, dy }),
  // 창 안에서 캐릭터가 실제로 그려지는 칸 — 화면 경계를 이 칸 기준으로 잡는다
  setCharBox: (box) => ipcRenderer.send('mascot:charBox', box),
  setIgnoreMouse: (ignore) => ipcRenderer.send('mascot:setIgnoreMouse', ignore),
  click: () => ipcRenderer.send('mascot:click'),

  // 학기 안내
  guideGetData: () => ipcRenderer.invoke('guide:getData'),
  guideClose: () => ipcRenderer.send('guide:close'),
  guideDragStart: () => ipcRenderer.send('guide:dragStart'),
  guideDrag: (dx, dy) => ipcRenderer.send('guide:drag', { dx, dy }),
  onGuideData: (cb) => ipcRenderer.on('guide:data', (_e, d) => cb(d)),
  openExternal: (url) => ipcRenderer.send('open:external', url),
});

// 사용 안내 창
contextBridge.exposeInMainWorld('help', {
  close: (opts) => ipcRenderer.send('help:close', opts),
  dragStart: () => ipcRenderer.send('help:dragStart'),
  drag: (dx, dy) => ipcRenderer.send('help:drag', { dx, dy }),
  onShow: (cb) => ipcRenderer.on('help:show', () => cb()),
});
