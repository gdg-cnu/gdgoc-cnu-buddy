// 헤더/영역을 잡고 창을 옮길 때 쓰는 공통 드래그. 화면 좌표 변화량만 콜백에 넘긴다.
(function (root) {
  function bindPanelDrag(el, { onStart, onMove, ignore }) {
    if (!el) return;
    let dragging = false;
    let last = { x: 0, y: 0 };

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (ignore && e.target.closest(ignore)) return;
      dragging = true;
      last = { x: e.screenX, y: e.screenY };
      if (onStart) onStart();
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.screenX - last.x;
      const dy = e.screenY - last.y;
      last = { x: e.screenX, y: e.screenY };
      if ((dx || dy) && onMove) onMove(dx, dy);
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  root.bindPanelDrag = bindPanelDrag;
})(typeof window !== 'undefined' ? window : globalThis);
