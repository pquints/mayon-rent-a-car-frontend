(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.decodeJwtPayload = api.decodeJwtPayload;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function decodeJwtPayload(token) {
        if (typeof token !== 'string') return null;

        const parts = token.split('.');
        if (parts.length < 2) return null;

        const payload = parts[1]
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);

        try {
            const normalized = typeof atob === 'function'
                ? atob(padded)
                : Buffer.from(padded, 'base64').toString('binary');

            const binary = normalized.split('').map((char) => {
                return char.charCodeAt(0);
            });

            const decoded = Buffer.from(binary).toString('utf8');
            return JSON.parse(decoded);
        } catch (error) {
            return null;
        }
    }

    return { decodeJwtPayload };
}));
