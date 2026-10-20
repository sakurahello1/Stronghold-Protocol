import { html, Tooltip } from './components.js';
import { t } from '../../../shared/i18n.js';

/** Server-owned electorate: spectators, bots, eliminated and departed seats cannot vote. */
export function combatSpeedModel(pub, myId) {
  const vote = pub?.combatSpeedVote;
  if (!vote || !Array.isArray(vote.eligible) || !Array.isArray(vote.voters)) return null;
  return { ...vote, votes: vote.voters.length, selected: vote.voters.includes(myId),
    canVote: pub.phase !== 'RESULT' && vote.eligible.includes(myId) };
}

export function CombatSpeedButton({ pub, myId, busy = false, onToggle }) {
  const state = combatSpeedModel(pub, myId);
  if (!state) return null;
  const status = state.active ? t('已启用2倍速（{votes}/{required}票）', state)
    : state.enabled ? t('已达票数，将在个人防御和联防阶段加速')
      : t('等待启用2倍速（{votes}/{required}票）', state);
  const action = !state.canVote ? t('仅仍在对局中的真人玩家可投票')
    : state.selected ? t('已选择启用2倍速，点击撤回') : t('投票启用2倍速');
  return html`<${Tooltip} text=${`${status} · ${action}`} placement="bottom">
    <button type="button" class=${`speedvote tapx${state.selected ? ' is-selected' : ''}${state.active ? ' is-active' : ''}`}
      data-testid="combat-speed" data-active=${state.active ? 'true' : 'false'}
      aria-label=${t('2倍速')} aria-pressed=${state.selected ? 'true' : 'false'}
      disabled=${busy || !state.canVote} onClick=${() => onToggle?.(!state.selected)}>
      <b>${t('2倍速')}</b><small class="num">${state.votes}/${state.required}</small>
    </button>
  <//>`;
}
