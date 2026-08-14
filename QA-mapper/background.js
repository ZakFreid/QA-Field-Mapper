// background.js — бейдж на иконке при выключенном расширении
function applyBadge() {
    chrome.storage.local.get({ qamEnabled: true }).then(r => {
      chrome.action.setBadgeBackgroundColor({ color: '#777' });
      chrome.action.setBadgeText({ text: r.qamEnabled === false ? 'OFF' : '' });
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.qamEnabled) applyBadge();
  });
  chrome.runtime.onInstalled.addListener(applyBadge);
  chrome.runtime.onStartup.addListener(applyBadge);