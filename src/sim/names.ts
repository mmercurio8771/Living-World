import { Rng } from './rng';

const ONSETS = ['', '', 'b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'th', 'sh', 'br', 'kr', 'dr', 'vr', 'sk', 'fl'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o', 'ai', 'ei', 'ia', 'io', 'ae', 'ou'];
const CODAS = ['', '', '', 'n', 'l', 'r', 's', 'sh', 'th', 'm', 'k', 'rn', 'ss', 'x', 'v'];

/** Pronounceable, softly alien names: "Vessa", "Orin", "Thaiel", "Kroum". */
export function generateName(rng: Rng): string {
  const syllables = rng.chance(0.55) ? 2 : rng.chance(0.7) ? 3 : 1;
  let name = '';
  for (let i = 0; i < syllables; i++) {
    const onset = i === 0 ? rng.pick(ONSETS) : rng.pick(ONSETS.filter((o) => o.length <= 1 || rng.chance(0.3)));
    const vowel = rng.pick(VOWELS);
    const coda = i === syllables - 1 ? rng.pick(CODAS) : rng.chance(0.25) ? rng.pick(CODAS) : '';
    name += onset + vowel + coda;
  }
  if (name.length < 3) name += rng.pick(['a', 'i', 'o', 'u']) + rng.pick(['n', 'l', 'r']);
  return name.charAt(0).toUpperCase() + name.slice(1);
}
