// Local room controls; keep the upstream room layout and official-version controls intact.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Tooltip } from './components.js';
import { eliteAiAllowed } from '../../../shared/eliteAi.js';
import { t } from '../../../shared/i18n.js';

export function prepTimerOption(room, myId) {
  if (!room || typeof room.prepTimer !== 'boolean') return null;
  return { on: room.prepTimer, editable: room.hostId != null && room.hostId === myId && !room.inMatch };
}

export function PrepTimerToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<${Tooltip} text=${t('仅控制每回合准备阶段；开启后单人也计时，关闭后多人也不限时。选卡与战斗计时不受影响。')}>
    <label class="prep-timer">
      <input type="checkbox" checked=${option.on} disabled=${!option.editable || !!busy}
        onChange=${event => option.editable && onToggle(event.currentTarget.checked)} />
      <span>${t('准备阶段计时器')}</span>
    </label>
  <//>`;
}

const ELITE_RECRUITS = Object.freeze([{ id: "arturia", label: () => t("阿尔图罗") }, { id: "lavinia", label: () => t("拉维妮娅") }]);
export function EliteRecruit({ room, busy, onAdd }) {
  const [open, setOpen] = useState(false), root = useRef(null);
  const unavailable = option => room.seats.some(s => s?.botPersona === option.id);
  const disabled = !!busy || !eliteAiAllowed(room) || ELITE_RECRUITS.every(unavailable);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector("[role=menuitem]:not(:disabled)")?.focus();
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const keydown = e => {
    if (e.key === "Escape" && open) {
      e.preventDefault(); setOpen(false); root.current?.querySelector("[aria-haspopup=menu]")?.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const entries = [...root.current.querySelectorAll("[role=menuitem]:not(:disabled)")];
      if (!entries.length) return;
      const at = entries.indexOf(document.activeElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? entries.length - 1 : (at + (e.key === "ArrowUp" ? -1 : 1) + entries.length) % entries.length;
      entries[next].focus();
    }
  };
  return html`<div ref=${root} class="elite-recruit" style="width:100%;position:relative" onKeyDown=${keydown}
    onBlur=${e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <${Button} variant="secondary" size="sm" block=${true} disabled=${disabled} aria-haspopup="menu" aria-expanded=${open ? "true" : "false"}
      onClick=${() => setOpen(!open)}>${t("添加精英干员")} <span aria-hidden="true">▾</span><//>
    ${open && html`<div role="menu" aria-label=${t("添加精英干员")} style="display:flex;flex-direction:column;gap:.04rem;margin-top:.04rem;padding:.04rem;border:1px solid var(--line-2);background:var(--bg-1,#0b0e0d)">
      ${ELITE_RECRUITS.map(option => html`<${Button} key=${option.id} role="menuitem" variant="secondary" size="sm" block=${true}
        disabled=${unavailable(option)} onClick=${() => { setOpen(false); onAdd(option.id); }}>${option.label()}<//>`)}
    </div>`}
  </div>`;
}
