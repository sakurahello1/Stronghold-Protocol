// Optional local content kit, adapted from remember-4/Stronghold-Protocol-test (GPL-3.0-or-later).
// Only the collab-recruits content plugin supplies its data; vanilla DIY availability is unchanged.
// server/sim/content/kits/ops/op-oblvns.js — 丰川祥子 (char_4182_oblvns) 自选 operator kit: 6★ 领主 (近卫), an owned-6★
// pick of the tier-5 and tier-6 自选 slots in the A6000 fork only (tools/build-data.mjs DIY_A6000_COLLABS — upstream leaves
// the collab operators out). Ported from the A6000 Rem deployment's shop-chess kit (remember-4/Stronghold-Protocol-Rem
// server/sim/content/kits/extra6.js sakikoKit and its docs/EXTRA-OPERATORS.md, the rules the user played there) to the 自选
// contract: every skill, both talents, the trait and the module LOR-Y at every form, the numbers from `chess` / `bb`. A
// playable adaptation of the descriptions, not a decoded client kit. Kit contract and the 自选 rules: ../README.md.
//
// Forms (data/backups.json units.char_4182_oblvns): normal = E2 Lv1, skills at rank 4; elite = E2 Lv60, rank 7, LOR-Y at
// stage 1 (tier 5) / 3 (tier 6) when picked. Full potential, as every pick.
// - Her attack is a 音符 (note): no normal attack of the profession; every attack interval she sends one straight homing
//   note at the first target of her range (none in range: it flies 4 tiles ahead), physical, the 领主 ranged scale (trait
//   atk_scale) unless the target is blocked by her / on her or the tile in front. A note that has left her range for
//   `delay` s vanishes.
// - T1 颂乐音符: each note in flight (at most max_cnt) gives her def_penetrate_ratio DEF and magic_resist_penetrate_ratio RES
//   ignore; T2 毋畏遗忘: the operators of her range ASPD +attack_speed; every damage she deals adds `cnt` to the player's
//   Fever gauge (450, shared by the player's 丰川祥子); a skill cast with a full gauge starts a 20 s Fever.
// - S1: eight arts notes at once (atk_scale, atk_scale_2 … _8), cast by itself once both charges are full; in a Fever
//   once a second, free.
// - S2: toggles piano (ATK +attack@atk) / organ (ASPD +attack@attack_speed, arts notes, slower); in a Fever two notes an
//   attack.
// - S3 (25 s): each attack two physical notes at the highest-RES target and two arts notes at the highest-DEF one,
//   attack@atk_scale; a Fever pauses its timer and casts it for free; a lethal hit inside a Fever keeps her at 1 HP until
//   the Fever ends, then she falls.
// - LOR-Y: with ≥ 2 enemies in range ASPD +attack_speed (trait bb); a skill's notes ignore the ranged scale.
// [ASSUMED] the Rem simplifications: straight notes (no random start angle or arc, no piano piercing), no Fever UI gauge or
// BGM, no other Ave Mujica member.

import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';

const SKILLS = ['skchr_oblvns_1', 'skchr_oblvns_2', 'skchr_oblvns_3'];
const FEVER_MAX = 450, FEVER_TIME = 20;

const live = (u) => u.alive && u.deployed && !u.hidden;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const foes = (b, u) => {
  const list = b.enemiesInKeys(u.rangeKeys, u, { canHitFly: true }).filter((e) => canTargetEnemy(u, e, { canHitFly: true }));
  sortEnemyTargets(b, u, list, u.profile.priority);
  return list;
};

export default {
  char_4182_oblvns: (bb, chess) => {
    const index = chess.skill?.index ?? 0;
    const t0 = chess.talents?.find((t) => t && t.index === 0)?.bb ?? {};
    const t1 = chess.talents?.find((t) => t && t.index === 1)?.bb ?? {};
    const skillBb = (i) => chess.skills?.find((s) => s && s.index === i)?.bb ?? {};
    const sRec = (i) => chess.skills?.find((s) => s && s.index === i) ?? null;
    let shoot = null;
    let isFever = () => false;
    const specOf = (i) => {
      const sb = skillBb(i);
      if (i === 0) return { kind: 'charges', trigger: 'NEVER', onStart() {
        for (let n = 1; n <= 8; n++) shoot?.('arts', num(sb[n === 1 ? 'atk_scale' : `atk_scale_${n}`]));
      } };
      if (i === 1) return { kind: 'instant', onStart({ battle: b, unit: u }) {
        u.mem.sakikoOrgan = !u.mem.sakikoOrgan;
        b.addBuff(u, { key: 'sakiko:timbre', persist: true,
          mods: u.mem.sakikoOrgan ? { aspd: num(sb.attack_speed) } : { atkPct: num(sb['attack@atk']) } });
      } };
      return { kind: 'duration', targeting: { rangeGrid: sRec(2)?.rangeGrid ?? null },
        onStart({ unit }) { unit.mem.sakikoFeverNew = isFever(); },
        onTick({ skill, dt }) { if (isFever()) skill.timeLeft += dt; } };
    };
    return {
      skills: Object.fromEntries(SKILLS.map((id, i) => [id, specOf(i)])),
      install(b, u) {
        u.profile.noAttack = true;
        u.mem.sakikoNotes = [];
        // the player's Fever gauge, shared by the player's 丰川祥子 on this field (per battle: content keeps no globals)
        const state = (b._sakikoFever ??= new Map());
        if (!state.has(u.ownerId)) state.set(u.ownerId, { value: 0, until: 0 });
        const fever = state.get(u.ownerId);
        let next = 0, repeat = 0, wasFever = false;
        const activeFever = () => fever.until > b.time;
        isFever = activeFever;
        const prune = () => {
          for (const p of u.mem.sakikoNotes) {
            const inside = u.rangeKeySet.has(Math.round(p.y) * b.grid.cols + Math.round(p.x));
            if (inside) p._sakikoExitAt = null; else p._sakikoExitAt ??= b.time;
            if (p._sakikoExitAt != null && b.time - p._sakikoExitAt >= num(t0.delay, 1)) b.projectiles.list = b.projectiles.list.filter((q) => q !== p);
          }
          u.mem.sakikoNotes = u.mem.sakikoNotes.filter((p) => b.projectiles.list.includes(p));
          return Math.min(num(t0.max_cnt, 10), u.mem.sakikoNotes.length);
        };
        shoot = (type = 'phys', scale = 1, priority = null) => {
          if (!live(u)) return;
          const list = foes(b, u);
          if (priority) list.sort((a, z) => z.s[priority] - a.s[priority]);
          const e = list[0], seq = u.deploySeq;
          const skillShot = index === 1 || u.skill.active;
          const moduleSkill = chess.module?.active && skillShot;
          const rangedMul = e && !moduleSkill ? (u.profile.dmgMul?.(b, u, e) ?? 1) : 1;
          const amount = u.s.atk * scale * rangedMul;
          const p = b.addProjectile({ from: u, target: e, to: e ? undefined : { x: u.x + u.fwd[1] * 4, y: u.y + u.fwd[0] * 4 },
            speed: index === 1 && u.mem.sakikoOrgan ? 2 : 4, visual: type === 'arts' ? 'arts' : 'arrow', source: u, maxAge: 5,
            onHit({ target }) {
              if (target && live(u) && u.deploySeq === seq) b.dealDamage(u, target, { amount, type, isAttack: true, isSkill: index === 2 && u.skill.active, tags: ['sakikoNote'] });
            } });
          u.mem.sakikoNotes.push(p);
        };
        const reset = () => {
          u.mem.sakikoOrgan = false;
          u.mem.sakikoFallen = false;
          next = b.time;
          b.removeBuff(u, 'sakiko:timbre');
          if (index === 1) b.addBuff(u, { key: 'sakiko:timbre', persist: true, mods: { atkPct: num(skillBb(1)['attack@atk']) } });
        };
        reset();
        b.on('deploy', ({ unit }) => { if (unit === u) reset(); }, { owner: u });
        b.on('damaged', (c) => { if (c.source === u && c.amount > 0 && !activeFever()) fever.value = Math.min(FEVER_MAX, fever.value + num(t1.cnt, 3)); }, { owner: u });
        b.on('skillStart', ({ unit }) => {
          if (unit === u && fever.value >= FEVER_MAX && !activeFever()) {
            fever.value = 0;
            fever.until = b.time + FEVER_TIME;
            b.fx('buff', { id: u.id, x: u.x, y: u.y, key: 'Fever' });
          }
        }, { owner: u });
        b.on('fatal', (c) => {
          if (c.unit === u && !c.prevented && index === 2 && u.skill.active && activeFever()) {
            c.prevented = true;
            u.hp = 1;
            u.mem.sakikoFallen = true;
            b.addBuff(u, { key: 'sakiko:feverSurvival', duration: fever.until - b.time, flags: { invulnerable: true, noHeal: true } });
          }
        }, { owner: u, priority: -80 });
        b.every(0.05, () => {
          if (!live(u)) return;
          const f = activeFever();
          if (wasFever && !f) {
            if (index === 2 && u.skill.active && u.mem.sakikoFeverNew) u.skill.end('fever');
            if (u.mem.sakikoFallen) { u.mem.sakikoFallen = false; b.kill(u); return; }
          }
          wasFever = f;
          if (f && index === 2 && !u.skill.active) u.skill.activate('fever', { free: true });
          if (f && index === 0 && b.time >= repeat) { repeat = b.time + 1; u.skill.activate('fever', { free: true }); }
          if (index === 0 && !f && u.skill.charges === u.skill.maxCharges && b.time >= u.skill.opReadyAt && u.canAct && !u.s.flags.silence) u.skill.activate('fullCharges');
          if (chess.module?.active) b.addBuff(u, { key: 'sakiko:moduleTempo', duration: 0.1, mods: { aspd: foes(b, u).length >= 2 ? num(chess.trait?.bb?.attack_speed, 12) : 0 } });
          const notes = prune();
          b.addBuff(u, { key: 'sakiko:notes', duration: 0.1, mods: { defIgnorePct: notes * num(t0.def_penetrate_ratio), resIgnorePct: notes * num(t0.magic_resist_penetrate_ratio) } });
          for (const a of b.alliesInGrid(u).filter((x) => x.kind === 'op')) b.addBuff(a, { key: 'sakiko:tempo', duration: 0.1, mods: { aspd: num(t1.attack_speed) } });
          if (u.s.flags.stun || u.s.flags.disarm || u.s.flags.sleep || b.time < next) return;
          next = b.time + u.s.interval;
          u.stats.attacks++;
          u.lastAttackAt = b.time;
          if (index === 2 && u.skill.active) {
            for (let n = 0; n < 2; n++) { shoot('phys', num(bb['attack@atk_scale'], 1), 'res'); shoot('arts', num(bb['attack@atk_scale'], 1), 'def'); }
          } else for (let n = 0; n < (index === 1 && f ? 2 : 1); n++) shoot(index === 1 && u.mem.sakikoOrgan ? 'arts' : 'phys');
          const targets = foes(b, u).slice(0, 1);
          if (targets.length) b._ev(['atk', u.id, targets[0].id, 'none']);
          if (b._hooks.attack) b.emit('attack', { attacker: u, targets, isSkill: index === 2 && u.skill.active });
          u.skill.onAttackPerformed(targets, index === 2 && u.skill.active);
        }, { owner: u });
      },
    };
  },
};
