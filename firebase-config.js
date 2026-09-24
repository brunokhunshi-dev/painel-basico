export const firebaseConfig = {
    apiKey: "AIzaSyAMDeRB1ZOOP919gcbcOoFGAsy6dNy7zS8",
    authDomain: "banco-de-dados-monitor.firebaseapp.com",
    projectId: "banco-de-dados-monitor",
    storageBucket: "banco-de-dados-monitor.firebasestorage.app",
    messagingSenderId: "248039911306",
    appId: "1:248039911306:web:188ffff179b3ffb3ace273"
};

// Configuração PWA: o manifest e o service worker devem ser registrados
// antes de o navegador avaliar a possibilidade de instalação.
if (typeof document !== 'undefined') {
    if (!document.querySelector('link[rel="manifest"]')) {
        const manifest = document.createElement('link');
        manifest.rel = 'manifest';
        manifest.href = './manifest.webmanifest';
        document.head.appendChild(manifest);
    }

    const metas = [
        ['theme-color', '#040438'],
        ['mobile-web-app-capable', 'yes'],
        ['apple-mobile-web-app-capable', 'yes'],
        ['apple-mobile-web-app-status-bar-style', 'black-translucent']
    ];
    metas.forEach(([name, content]) => {
        if (!document.querySelector(`meta[name="${name}"]`)) {
            const meta = document.createElement('meta');
            meta.name = name;
            meta.content = content;
            document.head.appendChild(meta);
        }
    });

    // Exibe um botão real de instalação quando o navegador liberar o prompt.
    let deferredInstallPrompt = null;
    const criarBotaoInstalar = () => {
        if (document.getElementById('btn-instalar-app')) return;
        const button = document.createElement('button');
        button.id = 'btn-instalar-app';
        button.type = 'button';
        button.textContent = 'Instalar aplicativo';
        Object.assign(button.style, {
            position: 'fixed', right: '16px', bottom: '16px', zIndex: '9999',
            padding: '13px 18px', border: '0', borderRadius: '999px',
            background: '#F51E30', color: '#fff', fontWeight: '700',
            boxShadow: '0 6px 18px rgba(0,0,0,.25)', cursor: 'pointer'
        });
        button.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            const result = await deferredInstallPrompt.userChoice;
            if (result.outcome === 'accepted') button.remove();
            deferredInstallPrompt = null;
        });
        document.body.appendChild(button);
    };

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        criarBotaoInstalar();
    });
    window.addEventListener('appinstalled', () => {
        document.getElementById('btn-instalar-app')?.remove();
        deferredInstallPrompt = null;
    });

    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        // Já está instalado; não mostrar o botão.
    }
}

if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
            .then(registration => registration.update())
            .catch(error => console.error('Falha ao registrar o PWA:', error));
    });
}
