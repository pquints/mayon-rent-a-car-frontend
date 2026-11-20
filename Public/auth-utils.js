(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.decodeJwtPayload = api.decodeJwtPayload;
    root.getDashboardPath = api.getDashboardPath;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DASHBOARD_PATHS = Object.freeze({
        admin: '/admin',
        affiliate: '/affiliate/dashboard',
        customer: '/customer/dashboard'
    });
    const LOCAL_DASHBOARD_FILES = Object.freeze({
        admin: 'dashboard.html',
        affiliate: 'affiliate-dashboard.html',
        customer: 'customer-dashboard.html'
    });

    function getDashboardPath(role) {
        const path = Object.prototype.hasOwnProperty.call(DASHBOARD_PATHS, role)
            ? DASHBOARD_PATHS[role]
            : null;
        if (!path) return null;

        if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
            const filename = LOCAL_DASHBOARD_FILES[role];
            return filename ? `/Public/${filename}` : null;
        }

        return path;
    }

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

    return { decodeJwtPayload, getDashboardPath };
}));
