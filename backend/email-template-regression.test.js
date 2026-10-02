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
assert.ok(source.includes('qd.pickupLocationAddress'), 'Email quotation should use the exact pickup address.');
assert.ok(source.includes('qd.pickupFlightNumber'), 'Email quotation should use the pickup flight number.');
assert.ok(source.includes('qd.returnLocationAddress'), 'Email quotation should use the exact return address.');
assert.ok(source.includes('qd.returnFlightNumber'), 'Email quotation should use the return flight number.');
assert.ok(source.includes('Flight No.'), 'Airport locations should include flight details.');
assert.ok(source.includes('${pickupDisplay}'), 'Email quotation should render formatted pickup details.');
assert.ok(source.includes('${returnDisplay}'), 'Email quotation should render formatted return details.');

console.log('Quote email template regression checks passed.');
