window.__ModuleLoader__.load({
  id: 'dsh-ai-companion',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    function StatusPage() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(true);
      const [revision, refresh] = React.useReducer(value => value + 1, 0);
      React.useEffect(() => {
        const controller = new AbortController();
        let pending = false;
        async function update() {
          if (pending) return;
          pending = true;
          setBusy(true);
          try {
            const response = await fetch('/api/ai-companion/status', {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
              cache: 'no-store'
            });
            if (!response.ok) throw new Error('读取失败');
            const next = await response.json();
            if (!controller.signal.aborted) { setData(next); setError(''); }
          } catch {
            if (!controller.signal.aborted) setError('无法读取角色状态，请确认 AI 伴侣插件已启用后重试。');
          } finally {
            pending = false;
            if (!controller.signal.aborted) setBusy(false);
          }
        }
        void update();
        const timer = setInterval(update, 5000);
        return () => { controller.abort(); clearInterval(timer); };
      }, [revision]);
      const secondary = {color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 13};
      const state = data?.state;
      const metrics = state ? [
        ['心情', state.mood.toFixed(2), '-1 ～ 1'],
        ['精力', state.energy.toFixed(1), '/ 100'],
        ['信任度', state.trust.toFixed(1), '/ 100'],
        ['模拟心率', String(state.bpm), 'bpm']
      ] : [];
      return h('section', {style: {padding: 24, maxWidth: 760, color: 'inherit'}},
        h('div', {style: {display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16}},
          h('h2', {style: {fontSize: 20, margin: 0}}, 'AI 伴侣'),
          h('button', {type: 'button', disabled: busy, onClick: refresh,
            style: {padding: '6px 14px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #8886)',
              background: 'transparent', color: 'inherit', cursor: 'pointer'}}, busy ? '刷新中…' : '刷新')),
        error && h('p', {role: 'alert'}, error),
        !data && !error && h('p', {role: 'status', style: secondary}, '正在读取角色状态…'),
        data && h(React.Fragment, null,
          h('h3', {style: {fontSize: 16, marginTop: 28}}, data.name),
          error && h('p', {style: secondary}, '以下显示上次读取的状态'),
          h('dl', {style: {display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12}},
            ...metrics.map(([label, value, unit]) => h('div', {key: label,
              style: {padding: 16, borderRadius: 12, border: '1px solid var(--dsw-alias-border-l2, #8884)'}},
              h('dt', {style: secondary}, label),
              h('dd', {style: {margin: '12px 0 0', fontSize: 24, fontVariantNumeric: 'tabular-nums'}},
                value, h('span', {style: {...secondary, marginLeft: 6}}, unit))))),
          h('p', {style: secondary}, '数值由角色规则模拟，每 5 秒自动刷新。')));
    }
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'ai-companion', order: 80, label: () => 'AI 伴侣'
      }, StatusPage));
    }
    return {inject: ['slots'], apply};
  }
});
