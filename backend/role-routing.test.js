const assert = require('node:assert/strict');
const { getDashboardPath } = require('../Public/auth-utils');

assert.equal(getDashboardPath('admin'), '/admin');
assert.equal(getDashboardPath('affiliate'), '/affiliate/dashboard');
assert.equal(getDashboardPath('customer'), '/customer/dashboard');
assert.equal(getDashboardPath('driver'), null);
assert.equal(getDashboardPath('__proto__'), null);
assert.equal(getDashboardPath(null), null);

global.window = {
    location: {
        hostname: '127.0.0.1',
        pathname: '/Public/dashboard.html'
    }
};
assert.equal(getDashboardPath('admin'), '/Public/dashboard.html');
assert.equal(getDashboardPath('affiliate'), '/Public/affiliate-dashboard.html');
assert.equal(getDashboardPath('customer'), '/Public/customer-dashboard.html');
global.window.location.pathname = '/customer/bookings/MRAC-123';
assert.equal(getDashboardPath('admin'), '/Public/dashboard.html');
assert.equal(getDashboardPath('affiliate'), '/Public/affiliate-dashboard.html');
delete global.window;

console.log('Role dashboard routing tests passed.');
