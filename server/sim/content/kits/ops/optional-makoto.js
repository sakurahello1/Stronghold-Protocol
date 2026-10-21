// Optional local content kit, adapted from remember-4/Stronghold-Protocol-test (GPL-3.0-or-later).
// Only the collab-recruits content plugin supplies its data; vanilla DIY availability is unchanged.
// server/sim/content/kits/ops/op-makoto.js — 结城理 (char_4217_makoto) 自选 operator kit: 6★ 傀儡师 (特种), an owned-6★
// pick of the tier-5 and tier-6 自选 slots in the A6000 fork only (tools/build-data.mjs DIY_A6000_COLLABS — upstream leaves
// the collab operators out). Ported from the A6000 Rem deployment's shop-chess kit (remember-4/Stronghold-Protocol-Rem
// server/sim/content/kits/makoto.js and its docs/MAKOTO-REM.md, the rules the user played there) to the 自选 contract:
// every skill, both talents, the trait and the module PUM-Y at every form, the numbers from `chess` / `bb`. A playable
// adaptation of the descriptions, not a decoded client kit. Kit contract and the 自选 rules: ../README.md.
//
// Forms (data/backups.json units.char_4217_makoto): normal = E2 Lv1, skills at rank 4; elite = E2 Lv60, rank 7, PUM-Y
// 彼此的声音 at stage 1 (tier 5) / 3 (tier 6) when picked. Full potential, as every pick.
// - Trait (傀儡师): the engine's 替身 (professions.js installDollkeeper: a lethal hit or a skill switches to it for 20 s,
//   it blocks nothing); `dollSwap` puts the persona on and off. PUM-Y: the 替身's HP +max_hp (trait bb).
// - T1 不羁之力: entering the 替身 停顿s every enemy of the persona range (the trait range) for `sluggish` s; as the 替身 the
//   persona fights — ATK +atk, HP +max_hp_t1, attack interval +base_attack_time s, arts ranged attacks on that range.
// - T2 S.E.E.S.队长: when the 替身 ends on its own (not knocked out), the 总攻击 — atk_scale × ATK true damage to every
//   enemy of the persona range [ASSUMED: he is the only S.E.E.S. member, so around himself].
// - S1 俄耳甫斯的竖琴: the persona attacks one target, attack@atk_scale arts; with an ally of the range at ≤ 50 % HP it
//   heals the lowest one attack@heal_scale × ATK instead.
// - S2 塔纳托斯的囚锁: up to attack@max_target, attack@atk_scale arts, attack@prob to 恐惧 attack@fear s; every 0.1 s a
//   feared enemy of the range whose HP ≤ attack@kill_atk_scale × ATK falls (attack@kill_damage true).
// - S3 开辟明日的剑刃: 塔纳托斯, ASPD +talent@attack_speed, up to attack@max_target, weakness damage (弱点伤害,
//   garrisons/battle.js weaknessType), air too; a lethal hit on the 替身 switches to 俄耳甫斯 once (the 替身's remaining time
//   kept): block attack@block_cnt, no attack, the allies of the range get attack@prob physical / arts dodge, and every
//   attack@interval s up to attack@max_target_heal of them are healed attack@heal_scale × ATK 0.5 s later. The user's rule
//   (Rem): only the lethal hit switches — casting again does not.
// - Every skill's active part, "立即切换为<替身>状态作战": a switch at once (`dollSwitch`), none while he is the 替身.
// The client draws the personas as forms makoto_s1 / s2 / s3a / s3b and the 本体 as `body` (render/units.js FORMS).

import { weaknessType, WEAKNESS_PRIORITY } from '../../garrisons/battle.js';
import { DOLL_SWITCH } from '../../../professions.js';

const SKILLS = ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3'];

export default {
  char_4217_makoto: (bb, chess) => {
    const sid = chess.skill?.skillId;
    const s1 = sid === SKILLS[0], s2 = sid === SKILLS[1];
    const t0 = chess.talents?.find((t) => t && t.index === 0)?.bb ?? {};
    const t1 = chess.talents?.find((t) => t && t.index === 1)?.bb ?? {};
    const grid = chess.trait?.rangeGrid ?? null;
    const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const toDoll = { kind: 'instant', onStart({ battle, unit }) {
      if (!unit.trait.doll) battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
    } };
    return {
      skills: Object.fromEntries(SKILLS.map((id) => [id, toDoll])),
      install(b, u) {
        const bodyProfile = { ...u.profile }, bodyRange = u.rangeGrid;
        let persona = null;
        const inRange = (side) => (grid ? b.unitsInGrid(u, grid, { side }) : []);
        const enemies = () => inRange('enemy');
        const allies = () => inRange('ally').filter((a) => a.kind === 'op');
        const refresh = () => {
          u.rangeGrid = persona && grid ? grid : bodyRange;
          u.form = persona ? (s1 ? 'makoto_s1' : s2 ? 'makoto_s2' : persona === 'thanatos' ? 'makoto_s3a' : 'makoto_s3b') : null;
          u.profile = { ...bodyProfile };
          if (persona) {
            b.addBuff(u, { key: 'makoto:persona', flags: { silence: true }, mods: {
              atkMul: 1 + num(t0.atk), hpMul: (1 + num(t0.max_hp_t1)) * (1 + num(chess.trait?.bb?.max_hp)),
              batPct: num(t0.base_attack_time) / Math.max(0.01, num(u.base.bat, 1)),
              aspd: !s1 && !s2 ? num(bb['talent@attack_speed']) : 0,
            } });
            u.profile.attack = 'ranged';
            u.profile.projectile = 'none';
            u.profile.dmgType = 'arts';
            u.profile.canHitFly = !s1 && !s2;
            u.profile.atkScale = num(bb['attack@atk_scale'], 1);
            u.profile.maxTargets = s1 ? 1 : num(bb['attack@max_target'], 1);
            if (s1) {
              u.profile.canAttack = () => {
                const hurt = b.injuredAlliesInKeys(u.rangeKeys, u).some((a) => a.hpRatio <= 0.5);
                u.profile.dmgType = hurt ? 'heal' : 'arts';
                u.profile.heal = hurt ? { mode: 'single', hpAtMost: 0.5 } : null;
                u.profile.atkScale = hurt ? num(bb['attack@heal_scale']) : num(bb['attack@atk_scale'], 1);
                return true;
              };
            }
            if (persona === 'orpheus' && !s1) {
              u.profile.noAttack = true;
              // the 替身 blocks nothing (trait:substitute blockCnt −99); 俄耳甫斯 blocks attack@block_cnt
              const sub = u.findBuff('trait:substitute');
              if (sub) sub.mods.blockCnt = num(bb['attack@block_cnt']) - num(u.base.blockCnt);
            }
          } else b.removeBuff(u, 'makoto:persona');
          u.markDirty();
          b.refreshRange(u);
        };
        const healPulse = () => {
          if (!u.alive || !u.deployed || u.trait.dollSwitching || persona !== 'orpheus' || s1) return;
          const seq = u.deploySeq;
          const list = b.injuredAlliesInKeys(u.rangeKeys, u).slice(0, num(bb['attack@max_target_heal']));
          b.after(0.5, () => {
            if (!u.alive || !u.deployed || u.deploySeq !== seq || persona !== 'orpheus') return;
            for (const a of list) if (a.alive && a.deployed) b.heal(u, a, u.s.atk * num(bb['attack@heal_scale']));
          }, { owner: u });
        };
        const subLeft = () => u.findBuff('trait:substitute')?.timeLeft;
        // S3: 塔纳托斯 → 俄耳甫斯 on a lethal hit, a 替身-to-替身 change: the 20 s window does not restart
        const orpheus = () => {
          if (!u.trait.doll || u.trait.dollSwitching || u.findBuff('makoto:changing') || persona !== 'thanatos' || s1 || s2) return false;
          persona = 'orpheus';
          b.addBuff(u, { key: 'makoto:changing', duration: DOLL_SWITCH,
            flags: { invulnerable: true, noSp: true, noHeal: true, isolated: true, disarm: true }, onExpire: healPulse });
          refresh();
          u.hp = u.s.maxHp;
          b.fx('substitute', { x: u.x, y: u.y, id: u.id, form: u.form, dur: subLeft() });
          return true;
        };
        b.on('dollSwap', ({ unit, form }) => {
          if (unit !== u) return;
          const doll = form === 'doll';
          persona = doll ? (s1 ? 'orpheus' : 'thanatos') : null;
          refresh();
          if (doll) {
            u.hp = u.s.maxHp; // the persona's HP: the switch starts at full HP (professions.js)
            // the engine's 'substitute' fx named the plain 替身; the persona's clip set
            b.fx('substitute', { x: u.x, y: u.y, id: u.id, form: u.form, dur: subLeft() });
            for (const e of enemies()) b.applyStatus(e, 'sluggish', { duration: num(t0.sluggish), source: u });
          } else {
            // only a natural end gives the 总攻击 (a 替身 knocked out takes the death hook, no dollSwap)
            for (const e of enemies()) b.dealDamage(u, e, { amount: u.s.atk * num(t1.atk_scale), type: 'true', tags: ['talent', 'makotoAllOut'] });
          }
        }, { owner: u });
        b.on('fatal', (c) => {
          if (c.unit !== u || c.prevented) return;
          if (u.findBuff('makoto:changing') || orpheus()) c.prevented = true;
        }, { owner: u, priority: -90 });
        b.on('hit', (c) => {
          if (c.source === u && c.dmg.isAttack && persona === 'thanatos' && !s2) c.dmg.type = weaknessType(u, c.target, c.dmg);
        }, { owner: u, priority: WEAKNESS_PRIORITY });
        b.on('damaged', (c) => {
          if (s2 && persona === 'thanatos' && c.source === u && c.dmg.isAttack && c.target.alive && b.rng.chance(num(bb['attack@prob']))) {
            b.applyStatus(c.target, 'fear', { duration: num(bb['attack@fear']), source: u });
          }
        }, { owner: u });
        b.every(0.1, () => {
          if (!u.alive || !u.deployed || u.trait.dollSwitching || !persona) return;
          if (s2) for (const e of enemies()) if (e.s.flags.fear && e.hp <= u.s.atk * num(bb['attack@kill_atk_scale'])) {
            b.dealDamage(null, e, { amount: num(bb['attack@kill_damage']), type: 'true', tags: ['execute'] });
          }
          if (persona === 'orpheus' && !s1) for (const a of allies()) b.addBuff(a, {
            key: 'makoto:dodge', duration: 0.15, mods: { dodgePhys: num(bb['attack@prob']), dodgeArts: num(bb['attack@prob']) }, source: u });
        }, { owner: u });
        if (!s1 && !s2) b.every(num(bb['attack@interval'], 1), healPulse, { owner: u });
        b.on('death', ({ unit }) => {
          if (unit !== u) return;
          persona = null;
          refresh();
        }, { owner: u });
      },
    };
  },
};
