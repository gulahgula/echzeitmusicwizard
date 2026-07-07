// ── Floating toast notification injector ──

const dismissedIds = new Set();
let notifMode = 'silent';

function loadState() {
  chrome.storage.local.get(['dismissedNotifIds', 'shownToastIds', 'notifMode'], (result) => {
    (result.dismissedNotifIds || []).forEach(id => dismissedIds.add(id));
    (result.shownToastIds || []).forEach(id => shownIds.add(id));
    notifMode = result.notifMode || 'silent';
    // Path 2: on-load check — only for IDs not already shown
    chrome.storage.local.get('unreadNotifications', (result) => {
      const list = result.unreadNotifications || [];
      for (const n of list) {
        if (shouldSkip(n.id)) continue;
        showToast(n.artistName, n.eventInfo, n.id);
        persistShown(n.id);
      }
    });
  });
}

const shownIds = new Set();
loadState();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.dismissedNotifIds) {
    (changes.dismissedNotifIds.newValue || []).forEach(id => dismissedIds.add(id));
  }
  if (changes.notifMode) {
    notifMode = changes.notifMode.newValue || 'silent';
  }
  if (changes.shownToastIds) {
    (changes.shownToastIds.newValue || []).forEach(id => shownIds.add(id));
  }
});

function shouldSkip(id) {
  return notifMode === 'off' || dismissedIds.has(id) || shownIds.has(id);
}

function persistShown(id) {
  shownIds.add(id);
  chrome.storage.local.get('shownToastIds', (result) => {
    const list = result.shownToastIds || [];
    if (list.includes(id)) return;
    list.push(id);
    chrome.storage.local.set({ shownToastIds: list });
  });
}

// Path 1: immediate delivery from background via tabs.sendMessage
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'showToast' && !shouldSkip(msg.notifId)) {
    showToast(msg.artistName, msg.eventInfo, msg.notifId);
    persistShown(msg.notifId);
  }
});

function persistDismiss(notifId) {
  dismissedIds.add(notifId);
  chrome.storage.local.get('dismissedNotifIds', (result) => {
    const list = result.dismissedNotifIds || [];
    if (list.includes(notifId)) return;
    list.push(notifId);
    chrome.storage.local.set({ dismissedNotifIds: list });
  });
}

function showToast(artist, info, notifId) {
  if (shouldSkip(notifId)) return;

  let container = document.getElementById('ech-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ech-toast-container';
    container.style.cssText = 'all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column-reverse;gap:8px;';
    document.body.appendChild(container);
  }

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;';

  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
<style>
*{margin:0;padding:0;box-sizing:border-box}
.to {
  background:#1e1e0a;border:1px solid #4a4a1a;border-left:3px solid #ffd54f;
  border-radius:6px;padding:10px 14px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;
  color:#e0e0e0;max-width:380px;box-shadow:0 4px 16px rgba(0,0,0,0.4);
  display:flex;align-items:flex-start;gap:8px;animation:in .3s ease;
}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.i{flex:1;min-width:0}
.a{font-weight:700;color:#ffd54f}
.d{color:#bbb;margin-top:2px}
.x{flex-shrink:0;background:none;border:none;color:#666;cursor:pointer;font-size:16px;padding:2px;line-height:1}
.x:hover{color:#e57373}
</style>
<div class="to"><div class="i"><div class="a">${esc(artist)}</div><div class="d">${esc(info)}</div></div><button class="x">✕</button></div>`;

  container.appendChild(host);

  const btn = shadow.querySelector('.x');
  btn.onclick = () => {
    host.remove();
    if (notifId) persistDismiss(notifId);
  };

  const timeout = 5000;
  setTimeout(() => {
    if (host.parentNode) host.remove();
  }, timeout);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
