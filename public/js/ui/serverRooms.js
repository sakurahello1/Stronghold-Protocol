// Same-server directory only: no global server discovery, accounts or third-party service.
// Requests run serially every 5 s while visible; leaving the screen cancels listeners/timers.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, MicroLabel, Tooltip } from './components.js';
import { DIFFICULTY_NAMES, ERR } from '../../../shared/constants.js';
import { net } from '../net.js';
import { t } from '../../../shared/i18n.js';

export function ServerRooms({ online, busy, onJoin, onSpectate }) {
  const [page, setPage] = useState(0);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const refresh = useRef(null);
  useEffect(() => {
    let live = true, pending = false;
    const off = net.on('room.list', frame => {
      if (!live || frame.page !== page || !Array.isArray(frame.rooms)) return;
      if (page >= frame.pages) { setPage(Math.max(0, frame.pages - 1)); return; }
      setSnapshot(frame); setError(null);
    });
    const load = async () => {
      if (!live || !online || pending || document.visibilityState === 'hidden') return;
      pending = true; setLoading(true);
      try { await net.request('room.list', { page }); }
      catch (err) {
        if (live) setError(err?.code === ERR.BAD_MSG ? 'unsupported' : 'failed');
      } finally { pending = false; if (live) setLoading(false); }
    };
    refresh.current = load;
    if (!online) setSnapshot(null);
    void load();
    const timer = setInterval(load, 5000);
    document.addEventListener('visibilitychange', load);
    return () => {
      live = false; off(); clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      if (refresh.current === load) refresh.current = null;
    };
  }, [online, page]);

  const rooms = online && snapshot?.page === page ? snapshot.rooms : [];
  return html`<section class="server-rooms" aria-label=${t('服务器大厅')}>
    <div class="server-rooms__head">
      <div class="section-label">${t('服务器大厅')}<${MicroLabel}>SERVER ROOMS<//></div>
      <${Button} variant="secondary" size="sm" loading=${loading} disabled=${!online || loading}
        onClick=${() => refresh.current?.()}>${t('刷新')}<//>
    </div>
    <p class="server-rooms__hint">${t('仅列出当前服务器的房间；只有观战可中途进入。')}</p>
    ${error ? html`<p class="server-rooms__error" role="status">${error === 'unsupported'
      ? t('服务器暂不支持房间列表，可继续使用同盟密钥加入。') : t('房间列表加载失败，请刷新重试。')}</p>` : null}
    <div class="server-rooms__scroll" aria-busy=${loading ? 'true' : 'false'}>
      <table class="server-rooms__table">
        <thead><tr><th>${t('房主')}</th><th>${t('模拟方式')}</th><th>${t('人数')}</th><th>${t('状态')}</th><th>${t('操作')}</th></tr></thead>
        <tbody>${rooms.map(room => html`<tr key=${room.code} data-room=${room.code}>
          <td><span class="server-rooms__host" title=${room.hostName}>${room.hostName}</span><small class="num">${room.code}</small></td>
          <td>${room.mode === 'solo' ? t('独立模拟') : t('同盟模拟')} · ${room.modeName || t(DIFFICULTY_NAMES[room.difficulty] || room.difficulty)}
            ${room.modded ? html`<small>${t('非官方')}</small>` : null}</td>
          <td class="num">${room.players}/${room.capacity}</td>
          <td><span class=${`server-rooms__status${room.inMatch ? ' is-running' : ''}`}>${room.inMatch ? t('游戏中') : t('准备中')}</span></td>
          <td><div class="server-rooms__actions">
            <${Tooltip} text=${room.mode === 'solo' ? t('独立模拟不开放加入或观战') : room.inMatch ? t('游戏中仅可观战') : !room.canJoin ? t('房间已满') : null}>
              <${Button} variant="secondary" size="sm" disabled=${!online || !!busy || !room.canJoin}
                onClick=${() => onJoin(room.code)}>${t('加入同盟')}<//>
            <//>
            <${Tooltip} text=${room.mode === 'solo' ? t('独立模拟不开放加入或观战') : t('观战席 {used}/{max}', { used: room.spectators, max: room.spectatorCapacity })}>
              <${Button} variant="secondary" size="sm" icon="eye" disabled=${!online || !!busy || !room.canSpectate}
                onClick=${() => onSpectate(room.code)}>${t('观战')}<//>
            <//>
          </div></td>
        </tr>`)}</tbody>
      </table>
      ${!rooms.length ? html`<p class="server-rooms__empty" role="status">${!online ? t('正在连接服务器…') : loading ? t('加载中…') : error ? '' : t('暂无房间')}</p>` : null}
    </div>
    ${snapshot?.pages > 1 ? html`<div class="server-rooms__pages">
      <${Button} size="sm" variant="ghost" disabled=${loading || page === 0} onClick=${() => setPage(page - 1)}>${t('上一页')}<//>
      <span class="num">${page + 1}/${snapshot.pages}</span>
      <${Button} size="sm" variant="ghost" disabled=${loading || page + 1 >= snapshot.pages} onClick=${() => setPage(page + 1)}>${t('下一页')}<//>
    </div>` : null}
  </section>`;
}
