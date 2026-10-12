// Isolated diagram and offline export controls. Only the diagram camera zooms.
export const ARCHITECTURE_INTERACTIONS = String.raw`(function () {
  var container = document.querySelector('.diagram-container');
  var svg = container && container.querySelector('svg');
  if (!svg || !window.Archify || !Archify.view) return;
  var timer;
  var gestureScale = 1;
  var gestureStart = 1;
  var style = document.createElement('style');
  style.textContent = '.diagram-container.pi-gesture-active>svg{transition:none!important}';
  document.head.appendChild(style);
  function cameraState() {
    var camera = Archify.view.state();
    if (window.DOMMatrixReadOnly) {
      var matrix = new window.DOMMatrixReadOnly(window.getComputedStyle(svg).transform);
      if (matrix.a > 0) { camera.scale = matrix.a; camera.x = matrix.e; camera.y = matrix.f; }
    }
    return camera;
  }
  function zoomAt(next, clientX, clientY) {
    // A narrow desktop viewport may have upstream's mobile horizontal-scroll
    // mode. Explicit pinch uses the same camera as desktop zoom in that case.
    container.removeAttribute('data-wide-diagram');
    var camera = cameraState();
    var box = svg.viewBox.baseVal;
    var width = svg.clientWidth;
    var height = svg.clientHeight;
    var fit = Math.min(width / box.width, height / box.height);
    if (!(fit > 0)) return;
    var rect = svg.getBoundingClientRect();
    var px = Number.isFinite(clientX) ? clientX - rect.left + camera.x : width / 2;
    var py = Number.isFinite(clientY) ? clientY - rect.top + camera.y : height / 2;
    next = Math.max(1, Math.min(3, next));
    var contentX = (px - camera.x) / camera.scale;
    var contentY = (py - camera.y) / camera.scale;
    var centerX = contentX + (width / 2 - px) / next;
    var centerY = contentY + (height / 2 - py) / next;
    container.classList.add('pi-gesture-active');
    clearTimeout(timer);
    timer = setTimeout(function () { container.classList.remove('pi-gesture-active'); }, 180);
    Archify.view.centerAt(
      box.x + (centerX - (width - box.width * fit) / 2) / fit,
      box.y + (centerY - (height - box.height * fit) / 2) / fit,
      { scale: next, instant: true }
    );
  }
  container.addEventListener('wheel', function (event) {
    if (!event.ctrlKey || !Number.isFinite(event.deltaY)) return;
    event.preventDefault();
    var delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1);
    zoomAt(cameraState().scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01), event.clientX, event.clientY);
  }, { passive: false });
  container.addEventListener('gesturestart', function (event) {
    event.preventDefault();
    gestureStart = cameraState().scale;
    gestureScale = Number(event.scale) || 1;
  }, { passive: false });
  container.addEventListener('gesturechange', function (event) {
    if (!(Number(event.scale) > 0)) return;
    event.preventDefault();
    zoomAt(gestureStart * event.scale / gestureScale, event.clientX, event.clientY);
  }, { passive: false });
  container.addEventListener('gestureend', function (event) { event.preventDefault(); }, { passive: false });
})();`
