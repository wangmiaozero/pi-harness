// Embedded controls are presentation-only. Standalone exports keep upstream controls.
export const ARCHITECTURE_CONTROLS = String.raw`(function () {
  if (window.piArchitectureControls || !window.architectureControls) return;
  var nav = document.querySelector('.diagram-nav');
  if (!nav) return;
  var group = document.createElement('span');
  group.className = 'pi-architecture-controls';
  var range = document.createElement('span');
  range.className = 'pi-architecture-range';
  range.setAttribute('data-testid', 'architecture-map-range');
  range.setAttribute('aria-live', 'polite');
  var icons = {
    previous: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    overview: '<path d="M3 12h18M3 12l6-6M3 12l6 6"/>',
    fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>'
  };
  function button(action) {
    var element = document.createElement('button');
    element.type = 'button';
    element.setAttribute('data-testid', 'architecture-' + action);
    element.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + icons[action] + '</svg>';
    element.addEventListener('click', function () { if (!element.disabled) architectureControls.command(action); });
    return element;
  }
  var previous = button('previous');
  var next = button('next');
  var overview = button('overview');
  var fullscreen = button('fullscreen');
  var fullscreenLabel = document.createElement('span');
  fullscreen.append(fullscreenLabel);
  group.append(previous, range, next, overview, fullscreen);
  nav.prepend(group);
  var zoom = document.createElement('span');
  zoom.className = 'pi-architecture-zoom';
  nav.querySelectorAll('[data-view]').forEach(function (button) { zoom.append(button); });
  nav.append(zoom);
  var style = document.createElement('style');
  // Upstream sizes every SVG to the diagram width. Control glyphs must have
  // their own fixed box so longer fullscreen labels participate in layout.
  style.textContent = '.diagram-nav{flex-wrap:wrap;overflow:visible;justify-content:flex-end;gap:4px}.diagram-nav button{min-width:2rem;height:2rem}.pi-architecture-controls,.pi-architecture-zoom{display:inline-flex;align-items:center;gap:1px;flex-shrink:0}.diagram-nav .pi-architecture-range{font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums;white-space:nowrap;padding:0 3px}.diagram-nav .pi-architecture-controls button{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:0 0 auto;width:max-content;white-space:nowrap}.diagram-nav .pi-architecture-controls button svg{width:16px;min-width:16px;max-width:16px;height:16px;flex:none}.diagram-nav .pi-architecture-controls button>span{flex:none}.diagram-nav .pi-architecture-controls button[hidden],.pi-architecture-range[hidden]{display:none}';
  document.head.append(style);
  function label(element, text) { element.title = text; element.setAttribute('aria-label', text); }
  window.piArchitectureControls = {
    update: function (state) {
      previous.hidden = next.hidden = range.hidden = state.focused || !state.range;
      previous.disabled = state.previousDisabled;
      next.disabled = state.nextDisabled;
      range.textContent = state.range;
      overview.hidden = !state.focused;
      overview.disabled = state.busy;
      label(previous, state.labels.previous);
      label(next, state.labels.next);
      label(overview, state.labels.overview);
      label(fullscreen, state.fullscreen ? state.labels.exitFullscreen : state.labels.fullscreen);
      fullscreenLabel.textContent = state.fullscreen ? state.labels.exitFullscreen : state.labels.fullscreen;
      fullscreen.setAttribute('aria-pressed', String(state.fullscreen));
    }
  };
})();`
