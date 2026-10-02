const fs = require('fs');
const path = require('path');
const assert = require('assert');

const serverFile = path.join(__dirname, 'server.js');
const source = fs.readFileSync(serverFile, 'utf8');

assert.ok(source.includes('brandBadge'), 'Email template is missing the custom branded logo header from the approved quote design.');
assert.ok(source.includes('Reply to Confirm Booking'), 'Email template is missing the confirmation CTA.');
assert.ok(source.includes('Booking Reference'), 'Email template is missing the booking reference block.');
assert.ok(source.includes("row('Delivery Fee',   bd.delivery  || 0, 'Free')"), 'Zero delivery fee should appear as Free.');
assert.ok(source.includes("row('Return Fee',     bd.return    || 0, 'Free')"), 'Zero return fee should appear as Free.');

console.log('Quote email template regression checks passed.');
