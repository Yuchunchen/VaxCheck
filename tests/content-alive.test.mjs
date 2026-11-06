// v0.4.29:外掛重新載入後,舊 content script 不丟「Extension context invalidated」
import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionAlive, isInvalidated, makeSend } from '../src/content/alive.js';

const fake = ({ id = 'abc', send } = {}) => ({ runtime: { id, sendMessage: send || (async (m) => ({ ok: true, echo: m.type })) } });

test('連線正常:照常轉送訊息與回覆,不呼叫 onDead', async () => {
  let dead = 0;
  const send = makeSend(() => dead++, fake());
  assert.deepEqual(await send({ type: 'rules:get' }), { ok: true, echo: 'rules:get' });
  assert.equal(dead, 0);
  assert.equal(extensionAlive(fake()), true);
});

test('已斷線(runtime.id 為 undefined):回 null、onDead 只呼叫一次、之後不再呼叫 sendMessage', async () => {
  let dead = 0, calls = 0;
  const api = fake({ id: null, send: async () => { calls++; return {}; } });   // 斷線後 runtime.id 消失
  const send = makeSend(() => dead++, api);
  assert.equal(await send({ type: 'session:start' }), null);
  assert.equal(await send({ type: 'session:end' }), null);
  assert.deepEqual([dead, calls], [1, 0]);
  assert.equal(extensionAlive(api), false);
});

test('sendMessage 同步丟或非同步 reject「Extension context invalidated」→ 不外漏錯誤,改呼叫 onDead', async () => {
  const err = new Error('Extension context invalidated.');
  let d1 = 0;
  const syncThrow = makeSend(() => d1++, fake({ send: () => { throw err; } }));
  assert.equal(await syncThrow({ type: 'x' }), null);
  let d2 = 0;
  const asyncReject = makeSend(() => d2++, fake({ send: async () => { throw err; } }));
  assert.equal(await asyncReject({ type: 'x' }), null);
  assert.deepEqual([d1, d2], [1, 1]);
  assert.equal(isInvalidated(err), true);
});

test('其他錯誤(例如背景頁沒有接收端)照常丟出,呼叫端原本的 .catch 行為不變', async () => {
  let dead = 0;
  const send = makeSend(() => dead++, fake({ send: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); } }));
  await assert.rejects(send({ type: 'x' }), /Receiving end does not exist/);
  assert.equal(dead, 0);
});

test('存取 chrome.runtime 本身丟錯 → 視為斷線', () => {
  const api = { get runtime() { throw new Error('Extension context invalidated.'); } };
  assert.equal(extensionAlive(api), false);
});
