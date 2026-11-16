const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ACTIVITY_LOG_PATH = path.join(__dirname, 'activity-log.jsonl');

function appendActivityEvent(event, filePath = ACTIVITY_LOG_PATH) {
    const record = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...event
    };

    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
}

function getRecentActivity({ limit = 100, entityType, entityId, filePath = ACTIVITY_LOG_PATH } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new RangeError('Activity limit must be an integer between 1 and 500.');
    }
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf8');
    const events = content.split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
        .filter(event => (!entityType || event.entityType === entityType)
            && (!entityId || event.entityId === entityId));

    return events.slice(-limit).reverse();
}

module.exports = { appendActivityEvent, getRecentActivity };
