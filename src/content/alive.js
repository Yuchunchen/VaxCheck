// 外掛更新或在 chrome://extensions 按「重新載入」後,已開啟分頁內的舊 content script 仍在執行,
// 但與外掛斷線:之後呼叫 chrome.runtime.* 會丟「Extension context invalidated」(v0.4.29)。
// Chrome 不會把新版自動注入已開啟的分頁 → 舊版要安靜停下,提示使用者重新整理該頁。

/** 仍連得到外掛(斷線後 chrome.runtime.id 為 undefined;存取本身也可能丟錯) */
export function extensionAlive(chromeApi = globalThis.chrome) {
  try { return !!chromeApi?.runtime?.id; } catch { return false; }
}

export const isInvalidated = (e) => /Extension context invalidated/i.test(String(e?.message ?? e));

/**
 * sendMessage 包裝:斷線時不丟錯,呼叫 onDead()(只呼叫一次)並回 null;其他錯誤照常丟出
 * (呼叫端原本的 .catch 行為不變)。
 */
export function makeSend(onDead, chromeApi = globalThis.chrome) {
  let fired = false;
  const dead = () => { if (!fired) { fired = true; onDead(); } return null; };
  const gone = (e) => isInvalidated(e) || !extensionAlive(chromeApi);
  return (msg) => {
    if (fired || !extensionAlive(chromeApi)) return Promise.resolve(dead());
    try {
      return Promise.resolve(chromeApi.runtime.sendMessage(msg)).catch((e) => { if (gone(e)) return dead(); throw e; });
    } catch (e) {
      if (gone(e)) return Promise.resolve(dead());
      throw e;
    }
  };
}
