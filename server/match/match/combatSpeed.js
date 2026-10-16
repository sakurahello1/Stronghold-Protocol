// Custom fork option: a revocable N-1 human vote doubles the existing normal/unite clock, never the sim tick.
// [ASSUMED] One human needs one vote; eligible seats are alive, non-bot and not permanently left (disconnects count).
import { PHASE, ERR } from '../../../shared/constants.js';
import { OK, fail } from './common.js';

export class MatchCombatSpeed {
  combatSpeedState() {
    const eligible = this.order.filter(ps => !ps.isBot && !ps.left && ps.alive).map(ps => ps.playerId);
    const voters = eligible.filter(id => this.combatSpeedVotes.has(id));
    const required = Math.max(1, eligible.length - 1);
    const enabled = voters.length >= required;
    const phase = this.phase === PHASE.COMBAT || this.phase === PHASE.UNITE;
    const active = enabled && phase && this.fields.some(f => f.live && !f.done);
    return { eligible, voters, required, enabled, active, speed: this.gameSpeed };
  }

  setCombatSpeed(ps, on) {
    if (typeof on !== 'boolean') return fail(ERR.BAD_MSG);
    if (!ps || ps.isBot || ps.left || !ps.alive) return fail(ERR.WRONG_PHASE, 'not an eligible human voter');
    if (on) this.combatSpeedVotes.add(ps.playerId);
    else this.combatSpeedVotes.delete(ps.playerId);
    this._syncCombatSpeed();
    this.markPublic();
    return OK;
  }

  /** Called before publishing a state: departures/elimination and phase changes also recompute the vote. */
  _syncCombatSpeed() {
    if (!this.combatSpeedVotes || this._syncingCombatSpeed) return;
    this._syncingCombatSpeed = true;
    try {
      const state = this.combatSpeedState();
      const eligible = new Set(state.eligible);
      for (const id of this.combatSpeedVotes) if (!eligible.has(id)) this.combatSpeedVotes.delete(id);
      const multiplier = state.active ? 2 : 1;
      const previous = this.combatSpeedMultiplier;
      if (multiplier === previous) return;
      const old = this.gameSpeed;
      const speed = old / previous * multiplier;
      const now = this._clockNow();
      const fields = this.fields.filter(f => f.cc && f.live && !f.done && (f.kind === 'normal' || f.kind === 'unite'));
      const elapsed = new Map(fields.map(f => [f, this._fieldElapsed(f)]));
      // Preserve unconsumed time at the old rate; the next pump uses the new rate without stepping twice.
      const wall = this.sched.now();
      for (const runner of [this.runner, this.pacer]) {
        if (!runner?.interval || runner.stopped || runner.done) continue;
        if (!this.paused) runner.acc += Math.max(0, wall - runner.last) / 1000 * old;
        runner.last = wall;
      }
      this.gameSpeed = speed;
      this.combatSpeedMultiplier = multiplier;
      // Non-combat deadlines (PREP, settlement, boss overtime) must never be rescaled.
      if ((this.phase === PHASE.COMBAT || this.phase === PHASE.UNITE) && this.fields.some(f => f.live && !f.done) && this.deadline > 0) {
        this.deadline = now + Math.round(Math.max(0, this.deadline - now) * old / speed);
      }
      for (const f of fields) {
        const gt = elapsed.get(f);
        // _fieldElapsed is clamped at the limit. Once already in grace, keep the original nominal end:
        // anchoring that clamped value to "now" would give a late client another 15 seconds on every vote.
        const endAt = f.startAt + f.spec.timeLimit / old * 1000;
        f.startAt = f.mode === 'client' && f.spec.timeLimit > 0 && now >= endAt
          ? endAt - f.spec.timeLimit / speed * 1000 : now - gt / speed * 1000;
        if (f.mode === 'client') {
          if (this.paused) f.rearmDeadline = true;
          else this._armDeadline(f);
        }
        if (f.mode === 'server' && f.result) this._armRelease(f);
        const recipients = new Set([...f.players, ...this.watchersOf(f.fieldId)]);
        for (const pid of recipients) this.sendTo(pid, {
          t: 'b.speed', battleId: f.battleId, fieldId: f.fieldId, speed,
          elapsed: gt, serverNow: this.sched.now(),
        });
      }
      this.markPublic();
    } finally { this._syncingCombatSpeed = false; }
  }
}
