const { createPlateDedupeGate } = require('../src/services/plateDedupeGate');

const gate = createPlateDedupeGate({ inflightMs: 2000 });
const plate = 'CVXC04';
const windowMs = 15 * 60 * 1000;

const t0 = Date.parse('2026-03-20T16:00:00.000Z');

const a = gate.begin(plate, t0, windowMs);
console.log('req1', a);

const b = gate.begin(plate, t0, windowMs);
console.log('req2', b);

gate.end(a.key, { acceptedEventMs: t0 });

const c = gate.begin(plate, t0, windowMs);
console.log('req3', c);

const d = gate.begin(plate, t0 + (16 * 60 * 1000), windowMs);
console.log('req4', d);
