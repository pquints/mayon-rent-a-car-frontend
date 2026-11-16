const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendActivityEvent, getRecentActivity } = require('./activity-log');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mrac-activity-test-'));
const filePath = path.join(directory, 'activity.jsonl');

try {
    appendActivityEvent({ actor: 'Admin One', action: 'updated', entityType: 'booking', entityId: 'MRAC-1' }, filePath);
    appendActivityEvent({ actor: 'Admin Two', action: 'updated', entityType: 'user', entityId: 'USR-1' }, filePath);
    appendActivityEvent({ actor: 'Admin Three', action: 'status_changed', entityType: 'booking', entityId: 'MRAC-2' }, filePath);

    assert.deepStrictEqual(
        getRecentActivity({ limit: 2, entityType: 'booking', filePath }).map(event => event.entityId),
        ['MRAC-2', 'MRAC-1']
    );
    assert.deepStrictEqual(
        getRecentActivity({ limit: 10, entityType: 'booking', entityId: 'MRAC-1', filePath }).map(event => event.entityId),
        ['MRAC-1']
    );
    assert.strictEqual(getRecentActivity({ limit: 1, filePath })[0].actor, 'Admin Three');
    assert.throws(() => getRecentActivity({ limit: 501, filePath }), RangeError);
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}

console.log('activity log tests passed');
