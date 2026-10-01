// test/fixtures/modular/index.js
import { deepClone, formatLabel } from './utils.js';
import { filterDirectRules, getTag } from './rules.js';

export function main(config, profileName) {
  const result = deepClone(config || {});
  result.profile = profileName;
  result.meta = {
    label: formatLabel(profileName),
    ruleTag: getTag(),
    directCount: filterDirectRules(result.rules || []).length,
  };
  return result;
}
