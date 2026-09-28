// Reference-only interactivity: visual affordances so Copilot can see the
// expected states. Not the real app logic (see design-spec.md for that).

document.querySelectorAll('.segmented').forEach((group) => {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    group.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
  });
});

document.querySelectorAll('.swatches').forEach((group) => {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch');
    if (!btn) return;
    group.querySelectorAll('.swatch').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
  });
});

document.querySelectorAll('.dir-group').forEach((group) => {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-card');
    if (!btn) return;
    group.querySelectorAll('.dir-card').forEach((b) => {
      b.classList.remove('is-active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', 'true');
  });
});

const secSwitch = document.getElementById('secSwitch');
if (secSwitch) {
  secSwitch.addEventListener('click', () => {
    const on = secSwitch.classList.toggle('is-on');
    secSwitch.setAttribute('aria-checked', String(on));
  });
}

document.querySelectorAll('.card-toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    const body = document.getElementById(toggle.dataset.target);
    const chev = toggle.querySelector('.chev');
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    if (body) body.hidden = !open;
    if (chev) chev.classList.toggle('is-closed', !open);
  });
});

document.querySelectorAll('.col-row-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.col-row').forEach((r) => r.classList.remove('selected'));
    btn.closest('.col-row').classList.add('selected');
    // NOTE: in the real extension this must also swap the detail form's
    // content for the selected column (see design-spec.md §3, §5).
  });
});

const dirtyFlag = document.getElementById('dirtyFlag');
function markDirty() { if (dirtyFlag) dirtyFlag.hidden = false; }
document.querySelectorAll('.detail input, .detail select, .detail textarea, .detail .seg-btn, .detail .swatch, .detail .dir-card, .detail .switch')
  .forEach((el) => el.addEventListener('click', markDirty));
document.getElementById('btnSave')?.addEventListener('click', () => { if (dirtyFlag) dirtyFlag.hidden = true; });
document.getElementById('btnCancel')?.addEventListener('click', () => { if (dirtyFlag) dirtyFlag.hidden = true; });
