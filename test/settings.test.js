import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, {act} from 'react';
import { createRoot } from 'react-dom/client';
import { registerSettings } from '../src/settings.js';

test('settings status enforces host access and returns only name and simulated state', () => {
  let route;
  let reject;
  let released = false;
  const state = {mood: 0, energy: 81.3, trust: 0, bpm: 73, lastTick: 1};
  const ctx = {
    inject(dependencies, callback) {
      assert.deepEqual(dependencies, ['webServer', 'connection']);
      callback({
        effect: callback => { this.dispose = callback(); },
        connection: {requestRejection: () => reject},
        webServer: {register(value) {route = value; return () => { released = true; };}}
      });
    }
  };
  registerSettings(ctx, {config: {character: {name: '澜'}, token: 'secret'}, snapshot: () => state});
  const response = {writeHead(code) {this.status = code;}, end(body) {this.body = JSON.parse(body);}};
  reject = 401;
  route.handler({method: 'GET'}, response);
  assert.equal(response.status, 401);
  reject = undefined;
  route.handler({method: 'POST'}, response);
  assert.equal(response.status, 405);
  route.handler({method: 'GET'}, response);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {name: '澜', state});
  ctx.dispose();
  assert.ok(released);
});

test('settings navigation mounts a live state page with refresh, error feedback and cleanup', async () => {
  let module;
  const dom = new JSDOM('<div id="root"></div>', {url: 'http://localhost'});
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const timers = new Set();
  let calls = 0;
  let fail = false;
  let signal;
  const sandbox = {
    window: {__ModuleLoader__: {load(value) { module = value.factory(() => React); }}},
    AbortController, AbortSignal,
    setInterval(callback) { timers.add(callback); return callback; },
    clearInterval(callback) { timers.delete(callback); },
    async fetch(path, options) {
      assert.equal(path, '/api/ai-companion/status');
      signal = options.signal;
      calls++;
      return {ok: !fail, json: async () => ({
        name: '澜', state: {mood: 0, energy: 81.3, trust: 0, bpm: 73}
      })};
    }
  };
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), sandbox);
  let registration;
  let Page;
  module.apply({slots: {
    inject(slot, callback) {assert.equal(slot, 'settings.section'); callback();},
    register(options, component) {registration = options; Page = component;}
  }});
  assert.equal(registration.label(), 'AI 伴侣');
  assert.equal(registration.name, 'settings.section');
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Page)));
    const text = dom.window.document.body.textContent;
    for (const label of ['澜', '心情', '精力', '81.3', '信任度', '模拟心率', '73']) assert.ok(text.includes(label));
    await act(async () => dom.window.document.querySelector('button').click());
    assert.equal(calls, 2);
    fail = true;
    await act(async () => { for (const update of timers) await update(); });
    assert.match(dom.window.document.querySelector('[role="alert"]').textContent, /无法读取/);
    assert.match(dom.window.document.body.textContent, /上次读取/);
  } finally {
    await act(async () => root.unmount());
    assert.equal(timers.size, 0);
    assert.ok(signal.aborted);
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});
