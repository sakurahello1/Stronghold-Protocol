// Local fork contract, owner request 2026-10-23: only the reviewed additive DIY recruits may accompany elite AI.
// Compare composed data, not just a plugin id/version: a changed plugin must not silently change the AI's rules.
import { isDeepStrictEqual as equal } from 'node:util';
import { PRESENTATION_DATA } from './identity.js';

const RECRUITS = Object.freeze({
  char_x_collab_recruits_oblvns: { kit: 'char_4182_oblvns', bonds: [['emptyShip']] },
  // Both local packs exist: the original neutral fallback and the later official hidden-Laterano membership.
  char_x_collab_recruits_makoto: { kit: 'char_4217_makoto', bonds: [['emptyShip'], ['lateranoShip']] },
});
const without = (value, keys) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !keys.includes(key)));

/** Admit only additive DIY records; shops, economy, bonds, stages, modes and all existing operators stay identical. */
export function eliteAiCompatible(content, data, vanilla) {
  const plugins = content?.plugins;
  if (!Array.isArray(plugins) || !plugins.some(p => p.class === 'content' && p.id === 'collab-recruits')) return false;
  if (plugins.some(p => p.class !== 'cosmetic' && !(p.class === 'content' && p.id === 'collab-recruits'))) return false;
  if (content.trusted || content.execution || content.modes?.length || Object.keys(content.rules || {}).length) return false;
  if (!data?.backups?.diy || !vanilla?.backups?.diy) return false;
  if (!equal(without(data, [...PRESENTATION_DATA, 'backups']), without(vanilla, [...PRESENTATION_DATA, 'backups']))) return false;
  const a = data.backups, b = vanilla.backups, ids = Object.keys(RECRUITS);
  if (!equal(without(a, ['units', 'diy']), without(b, ['units', 'diy']))) return false;
  if (!equal(without(a.units, ids), b.units)) return false;
  if (!equal(without(a.diy, ['ownedPool', 'operators']), without(b.diy, ['ownedPool', 'operators']))) return false;
  if (!equal(without(a.diy.operators, ids), b.diy.operators)) return false;
  if (!equal(a.diy.ownedPool, [...b.diy.ownedPool, ...ids])) return false;
  return ids.every(id => a.units?.[id]?.charId === id && a.units[id].kitRef === RECRUITS[id].kit
    && RECRUITS[id].bonds.some(bonds => equal(a.diy.operators?.[id]?.bonds, bonds)));
}
