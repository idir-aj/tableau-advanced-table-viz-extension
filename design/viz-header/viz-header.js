// Reference-only interactivity: visual affordances so Copilot can see the
// expected states (sort cycling, filter open/close, drag reorder, column
// resize). Not the real app logic — see viz-header-spec.md for that.

// ---- sort cycle: none -> asc -> desc -> none ----
document.querySelectorAll('.col-name-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const icon = btn.querySelector('.sort-icon');
    if (!icon.classList.contains('is-active')) {
      icon.classList.add('is-active');
      icon.classList.remove('is-desc');
    } else if (!icon.classList.contains('is-desc')) {
      icon.classList.add('is-desc');
    } else {
      icon.classList.remove('is-active', 'is-desc');
    }
  });
});

// ---- filter open/close ----
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const header = btn.closest('.col-header');
    let panel = header.querySelector('.filter-panel');
    const open = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(open));
    btn.classList.toggle('is-active', open);
    if (panel) panel.hidden = !open;
  });
});

// ---- column resize (drag the handle at the right edge) ----
let resizing = null;
document.querySelectorAll('.resize-handle').forEach((handle) => {
  handle.addEventListener('mousedown', (e) => {
    const header = handle.closest('.col-header');
    const idx = Array.from(header.parentElement.children).indexOf(header);
    const grid = document.getElementById('grid');
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ');
    resizing = { idx, startX: e.clientX, startWidth: parseFloat(cols[idx]), grid, cols };
    e.preventDefault();
  });
});
document.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const dx = e.clientX - resizing.startX;
  const newWidth = Math.max(120, resizing.startWidth + dx);
  resizing.cols[resizing.idx] = newWidth + 'px';
  resizing.grid.style.gridTemplateColumns = resizing.cols.join(' ');
});
document.addEventListener('mouseup', () => { resizing = null; });

// ---- column reorder (drag the ⠿ handle, drop on another header) ----
let draggedIdx = null;
document.querySelectorAll('.drag-handle').forEach((handle) => {
  handle.addEventListener('dragstart', (e) => {
    const header = handle.closest('.col-header');
    draggedIdx = Array.from(header.parentElement.children).indexOf(header);
    e.dataTransfer.effectAllowed = 'move';
    header.classList.add('is-dragging');
  });
  handle.addEventListener('dragend', () => {
    document.querySelectorAll('.col-header.is-dragging').forEach((h) => h.classList.remove('is-dragging'));
  });
});
document.querySelectorAll('.col-header').forEach((header) => {
  header.addEventListener('dragover', (e) => e.preventDefault());
  header.addEventListener('drop', (e) => {
    e.preventDefault();
    // Reference only: a real implementation reorders the underlying column
    // array and re-renders every row's cells in the new order (see spec §3).
    header.classList.remove('is-dragging');
  });
});
