import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url);

test('a clean consumer can install the tarball, load the DSH plugin and invoke the CLI', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'companion-package-'));
  t.after(() => rm(temp, {recursive: true, force: true, maxRetries: 3}));
  const npm = (cwd, ...args) => exec(process.execPath, [process.env.npm_execpath, ...args], {cwd});
  const {stdout} = await npm(root, 'pack', '--json', '--pack-destination', temp);
  const [packed] = JSON.parse(stdout);
  const files = packed.files.map(file => file.path);
  const allowed = /^(src\/[^/]+\.(?:js|d\.ts)|package\.json|README\.md|LICENSE|config\.example\.json|cordis\.patch\.yml)$/;
  assert.deepEqual(files.filter(path => !allowed.test(path)), []);
  for (const file of ['cordis.patch.yml', 'config.example.json', 'README.md', 'LICENSE']) {
    assert.ok(files.includes(file), `Tarball missing ${file}`);
  }

  const consumer = join(temp, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true}');
  await npm(consumer, 'install', '--prefer-offline', '--no-audit', '--no-fund', join(temp, packed.filename));
  const help = await npm(consumer, 'exec', '--offline', '--', 'dsh-ai-companion', '--help');
  assert.match(help.stdout, /Usage: dsh-ai-companion/);
  const check = `
    import assert from 'node:assert/strict';
    import { readFile, writeFile } from 'node:fs/promises';
    import { resolve } from 'node:path';
    import { apply } from 'dsh-ai-companion';
    import { Companion } from 'dsh-ai-companion/engine';
    assert.equal(typeof Companion, 'function');
    const config = JSON.parse(await readFile('node_modules/dsh-ai-companion/config.example.json', 'utf8'));
    config.dataDir = resolve('state');
    config.port = 0;
    config.qq.enabled = false;
    process.env[config.tokenEnv] = 'package-smoke-only-1234567890';
    await writeFile('config.json', JSON.stringify(config));
    const registered = new Map();
    const dispose = await apply({tools: {register(tool) { registered.set(tool.name, tool); }}}, {configPath: 'config.json'});
    try {
      assert.deepEqual([...registered.keys()].sort(), ['companion_chat', 'companion_state']);
      assert.ok(JSON.parse(await registered.get('companion_state').execute()).bpm > 0);
    } finally {
      await dispose();
    }
    await assert.rejects(readFile('state/engine.lock'), {code: 'ENOENT'});
  `;
  await exec(process.execPath, ['--input-type=module', '--eval', check], {cwd: consumer, timeout: 15000});

  const installed = join(consumer, 'node_modules', 'dsh-ai-companion');
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  const token = 'installed-cli-smoke-only-0123456';
  const cli = spawn(process.execPath, [join(installed, manifest.bin['dsh-ai-companion']), 'config.json'], {
    cwd: consumer, env: {...process.env, COMPANION_API_TOKEN: token}, windowsHide: true,
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const exit = once(cli, 'exit');
  const lines = createInterface({input: cli.stdout});
  try {
    const [line] = await Promise.race([
      once(lines, 'line', {signal: AbortSignal.timeout(10000)}),
      exit.then(([code]) => { throw new Error(`CLI exited before startup (code ${code})`); })
    ]);
    const address = /^DSH AI Companion: (http:\/\/127\.0\.0\.1:\d+)$/.exec(line);
    assert.ok(address, line);
    const response = await fetch(address[1] + '/state', {
      headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(5000)
    });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).bpm > 0);
  } finally {
    lines.close();
    cli.kill();
    await exit;
  }
});
