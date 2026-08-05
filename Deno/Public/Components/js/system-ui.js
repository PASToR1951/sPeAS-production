(function () {
    'use strict';

    const FLOWBITE_VERSION = '4.0.2';
    const FLOWBITE_CSS_URL = `https://cdn.jsdelivr.net/npm/flowbite@${FLOWBITE_VERSION}/dist/flowbite.min.css`;
    const FLOWBITE_JS_URL = `https://cdn.jsdelivr.net/npm/flowbite@${FLOWBITE_VERSION}/dist/flowbite.min.js`;
    const FLOWBITE_CSS_ID = 'system-ui-flowbite-css';
    const FLOWBITE_JS_ID = 'system-ui-flowbite-js';
    let flowbiteLoadPromise = null;

    function hasTailwindRuntime() {
        return Boolean(
            window.tailwind ||
            document.querySelector('script[src*="cdn.tailwindcss.com"]') ||
            document.querySelector('link[href*="tailwind"]')
        );
    }

    function hasFlowbiteMarkup(root) {
        const scope = root && root.querySelector ? root : document;
        return Boolean(scope.querySelector([
            '[data-accordion]',
            '[data-collapse-toggle]',
            '[data-carousel]',
            '[data-date-rangepicker]',
            '[data-dismiss-target]',
            '[data-drawer-target]',
            '[data-dropdown-toggle]',
            '[data-modal-target]',
            '[data-popover-target]',
            '[data-tabs-toggle]',
            '[data-tooltip-target]'
        ].join(',')));
    }

    function pageOptedIn() {
        const value = (document.documentElement.dataset.systemUi || '').toLowerCase();
        return value === 'flowbite' || value === 'on' || value === 'true';
    }

    function shouldAutoLoad() {
        return pageOptedIn() || hasTailwindRuntime() || hasFlowbiteMarkup(document);
    }

    function ensureFlowbiteCss() {
        if (
            document.getElementById(FLOWBITE_CSS_ID) ||
            document.querySelector(`link[href="${FLOWBITE_CSS_URL}"]`) ||
            document.querySelector('link[href*="/flowbite@"][href*="/dist/flowbite.min.css"]')
        ) {
            return;
        }

        const link = document.createElement('link');
        link.id = FLOWBITE_CSS_ID;
        link.rel = 'stylesheet';
        link.href = FLOWBITE_CSS_URL;
        document.head.appendChild(link);
    }

    function ensureFlowbiteScript() {
        if (typeof window.initFlowbite === 'function') {
            return Promise.resolve();
        }

        const existingScript = document.getElementById(FLOWBITE_JS_ID) ||
            document.querySelector('script[src*="/flowbite@"][src*="/dist/flowbite.min.js"]');

        if (existingScript) {
            return new Promise((resolve, reject) => {
                existingScript.addEventListener('load', resolve, { once: true });
                existingScript.addEventListener('error', reject, { once: true });

                if (typeof window.initFlowbite === 'function') {
                    resolve();
                }
            });
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.id = FLOWBITE_JS_ID;
            script.src = FLOWBITE_JS_URL;
            script.defer = true;
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', reject, { once: true });
            document.head.appendChild(script);
        });
    }

    function loadFlowbite() {
        if (!flowbiteLoadPromise) {
            ensureFlowbiteCss();
            flowbiteLoadPromise = ensureFlowbiteScript();
        }

        return flowbiteLoadPromise;
    }

    function init(root) {
        return loadFlowbite()
            .then(() => {
                if (typeof window.initFlowbite === 'function') {
                    window.initFlowbite();
                }

                document.dispatchEvent(new CustomEvent('system-ui:ready', {
                    detail: {
                        library: 'flowbite',
                        version: FLOWBITE_VERSION,
                        root: root || document
                    }
                }));
            })
            .catch(() => {});
    }

    function boot() {
        if (shouldAutoLoad()) {
            init(document);
        }
    }

    window.SystemUI = Object.assign(window.SystemUI || {}, {
        library: 'flowbite',
        version: FLOWBITE_VERSION,
        loadFlowbite,
        initFlowbiteComponents: init,
        init
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
