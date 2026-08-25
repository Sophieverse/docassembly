/**
 * @module samples
 * Bundled example templates. Each sample: { id, name, description, category, text, sampleAnswers }.
 * `text` is template source in the DocAssembly language; `sampleAnswers` is a complete
 * data set matching the variable paths used in the template.
 */
import tutorial from './tutorial.js';
import engagementLetter from './engagement-letter.js';
import lastWill from './last-will.js';
import llcOperatingAgreement from './llc-operating-agreement.js';
import residentialLease from './residential-lease.js';
import nda from './nda.js';
import demandLetter from './demand-letter.js';

export const samples = [
  tutorial,
  engagementLetter,
  lastWill,
  llcOperatingAgreement,
  residentialLease,
  nda,
  demandLetter,
];

/** Look up a sample by id. */
export function getSample(id) {
  return samples.find((s) => s.id === id) || null;
}

export default samples;
