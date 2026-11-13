export const STATUS_PATH = '/api/ai-companion/status';

export function registerSettings(ctx, engine) {
  // The standalone engine and minimal Cordis hosts may have no desktop server.
  ctx.inject(['webServer', 'connection'], child => {
    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: STATUS_PATH,
      handler(req, res) {
        const reply = (code, body) => {
          res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
          res.end(JSON.stringify(body));
        };
        const rejection = child.connection.requestRejection(req);
        if (rejection !== undefined) return reply(rejection, {error: '无法访问角色状态'});
        if (req.method !== 'GET') return reply(405, {error: 'Method not allowed'});
        return reply(200, {name: engine.config.character.name, state: engine.snapshot()});
      }
    }), 'ai-companion: settings status');
  });
}
