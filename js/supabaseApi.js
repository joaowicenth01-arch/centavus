/* ==========================================================================
   CENTAVUS — BACKEND SUPABASE (contas e dados na nuvem)
   ---------------------------------------------------------------------------
   Mesmo formato de respostas da API real, para o front não precisar mudar:

     GET    /api/health            → detecta o modo
     GET    /api/auth/me           → usuário da sessão (401 se não houver)
     POST   /api/auth/register     → cria conta na nuvem e abre sessão
     POST   /api/auth/login        → valida senha e abre sessão
     POST   /api/auth/logout       → fecha sessão
     POST   /api/auth/password     → troca a senha (pede a atual)
     POST   /api/auth/forgot       → envia link de redefinição por e-mail
     POST   /api/auth/reset        → grava a nova senha vinda do link
     GET    /api/me/state          → dados da conta
     PUT    /api/me/state          → grava dados da conta
     PUT    /api/me/profile        → foto e preferências

   Tudo passa pela REST API do Supabase com a chave `anon` (pública por
   definição). A segurança vem do Row Level Security: cada linha da tabela
   `centavus_state` só é legível/gravável pelo próprio dono (auth.uid()).
   ========================================================================== */
'use strict';

const CV_SB_SESSION_KEY = 'cv_sb_session';

/* ===================== CONFIGURAÇÃO ===================== */
function cvSupabaseConfigured() {
    const c = window.CV_SUPABASE;
    return !!(c && typeof c.url === 'string' && c.url.indexOf('https://') === 0 && c.anonKey);
}
/* aceita a URL crua, com ou sem o /rest/v1/ no final */
function sbBase() {
    return String(window.CV_SUPABASE.url)
        .replace(/\/+$/, '')
        .replace(/\/rest\/v\d+$/i, '');
}
function sbAnon() { return String(window.CV_SUPABASE.anonKey); }

/* ===================== SESSÃO NO APARELHO ===================== */
/* guardamos só os tokens; a conta em si mora no Supabase */
function sbGetSession() {
    try { return JSON.parse(localStorage.getItem(CV_SB_SESSION_KEY) || 'null'); } catch (e) { return null; }
}
function sbSetSession(s) {
    try {
        if (s) { s.savedAt = Date.now(); localStorage.setItem(CV_SB_SESSION_KEY, JSON.stringify(s)); }
        else localStorage.removeItem(CV_SB_SESSION_KEY);
    } catch (e) { }
}
function sbExpiresAt(s) {
    if (!s) return 0;
    if (s.expires_at) return Number(s.expires_at) * 1000;
    if (s.expires_in) return (s.savedAt || Date.now()) + Number(s.expires_in) * 1000;
    return 0;
}

/* ===================== ERROS EM PORTUGUÊS ===================== */
function sbTranslate(msg) {
    const m = String(msg || '');
    const tabela = [
        [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
        [/user not found/i, 'E-mail ou senha incorretos.'],
        [/already registered/i, 'Já existe uma conta com este e-mail.'],
        [/already been registered/i, 'Já existe uma conta com este e-mail.'],
        [/should be at least \d+ characters/i, 'A senha precisa ter pelo menos 8 caracteres.'],
        [/password is too short/i, 'A senha precisa ter pelo menos 8 caracteres.'],
        [/email not confirmed/i, 'Este e-mail ainda não foi confirmado. No Supabase: Authentication → Providers → Email → desligue "Confirm email".'],
        [/rate limit|too many request/i, 'Muitas tentativas em sequência. Aguarde um minuto e tente de novo.'],
        [/failed to fetch|networkerror/i, 'Sem conexão com a nuvem do Centavus. Verifique sua internet.'],
        [/row-level security/i, 'A tabela do Supabase ainda não foi criada. Rode o SQL no painel do projeto.'],
        [/relation .* does not exist/i, 'A tabela do Supabase ainda não foi criada. Rode o SQL no painel do projeto.']
    ];
    for (let i = 0; i < tabela.length; i++) if (tabela[i][0].test(m)) return tabela[i][1];
    return m || 'Não foi possível concluir a operação.';
}
function sbThrow(msg, status) {
    const e = new Error(sbTranslate(msg));
    e.status = status || 400;
    if (e.status === 401) { try { document.dispatchEvent(new CustomEvent('cv:unauthorized')); } catch (err) { } }
    return e;
}

/* ===================== REQUISIÇÕES ===================== */
async function sbRequest(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'apikey': sbAnon() }, opts.headers || {});
    if (!headers['Authorization']) headers['Authorization'] = 'Bearer ' + sbAnon();
    const init = { method: opts.method || 'GET', headers: headers, cache: 'no-store' };
    if (opts.body !== undefined && opts.body !== null && opts.body !== '') {
        headers['Content-Type'] = 'application/json';
        init.body = (typeof opts.body === 'string') ? opts.body : JSON.stringify(opts.body);
    }
    let res;
    try { res = await fetch(sbBase() + path, init); }
    catch (err) {
        const e = new Error('Sem conexão com a nuvem do Centavus. Verifique sua internet.');
        e.network = true;
        throw e;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
        const msg = (data && (data.msg || data.message || data.error_description || data.error_description)) || ('Erro ' + res.status);
        throw sbThrow(msg, res.status);
    }
    return data;
}

/* mesma coisa, mas já com o token de acesso deste aparelho */
function sbCall(path, opts) {
    opts = opts || {};
    const s = sbGetSession();
    opts.headers = Object.assign(
        { 'Authorization': 'Bearer ' + ((s && s.access_token) || sbAnon()) },
        opts.headers || {}
    );
    return sbRequest(path, opts);
}

/* garante token válido; renova com o refresh_token quando expirou */
async function sbEnsureSession() {
    const s = sbGetSession();
    if (!s || !s.refresh_token) throw sbThrow('Faça entrar para continuar.', 401);
    const exp = sbExpiresAt(s);
    if (!exp || Date.now() < exp - 60000) return s;
    try {
        const nova = await sbRequest('/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + sbAnon() },
            body: { refresh_token: s.refresh_token }
        });
        sbSetSession(nova);
        return nova;
    } catch (err) {
        sbSetSession(null);
        throw sbThrow('Sua sessão expirou. Entre novamente para continuar.', 401);
    }
}

/* ===================== LINHA DE DADOS DO USUÁRIO ===================== */
async function sbRow(session) {
    const uid = session.user && session.user.id;
    if (!uid) return null;
    const rows = await sbCall(
        '/rest/v1/centavus_state?user_id=eq.' + encodeURIComponent(uid) + '&select=*',
        { headers: { 'Authorization': 'Bearer ' + session.access_token } }
    );
    return (rows && rows[0]) || null;
}
async function sbUpsert(fields) {
    const s = await sbEnsureSession();
    const payload = Object.assign({ user_id: s.user.id, updated_at: new Date().toISOString() }, fields || {});
    await sbCall('/rest/v1/centavus_state', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + s.access_token, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: payload
    });
}
async function sbEnsureRow() {
    try { await sbUpsert({}); } catch (e) { /* tabela ausente: aviso aparece nos próximos passos */ }
}

/* ===================== USUÁRIO NO FORMATO DO FRONT ===================== */
function sbShapeUser(authUser, row) {
    if (!authUser) return null;
    return {
        id: authUser.id,
        name: (authUser.user_metadata && authUser.user_metadata.name) || String(authUser.email || '').split('@')[0] || 'Cliente',
        email: authUser.email,
        avatar: (row && row.avatar) || null,
        settings: (row && row.settings) || null
    };
}
async function sbMe() {
    const s = await sbEnsureSession();
    let u = s.user;
    if (!u) {
        u = await sbCall('/auth/v1/user', { headers: { 'Authorization': 'Bearer ' + s.access_token } });
        s.user = u;
        sbSetSession(s);
    }
    let row = null;
    try { row = await sbRow(s); } catch (e) { }
    return sbShapeUser(u, row);
}

/* ===================== ROTAS ===================== */
async function supabaseApi(path, options) {
    const opts = Object.assign({ method: 'GET', headers: {} }, options || {});
    const method = String(opts.method || 'GET').toUpperCase();
    let body = opts.body;
    if (body && typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    body = body || {};

    if (path === '/api/health') return { ok: true, cloud: true };

    /* ---- registrar ---- */
    if (path === '/api/auth/register' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || '').trim();
        const pass = String(body.password || '');
        const data = await sbRequest('/auth/v1/signup', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + sbAnon() },
            body: { email: email, password: pass, data: { name: name } }
        });
        if (data && data.access_token) {
            sbSetSession(data);
        } else {
            /* confirmação de e-mail ligada: tenta entrar direto na sequência */
            const login = await sbRequest('/auth/v1/token?grant_type=password', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + sbAnon() },
                body: { email: email, password: pass }
            });
            sbSetSession(login);
        }
        await sbEnsureRow();
        return { user: await sbMe() };
    }

    /* ---- entrar ---- */
    if (path === '/api/auth/login' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        const data = await sbRequest('/auth/v1/token?grant_type=password', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + sbAnon() },
            body: { email: email, password: String(body.password || '') }
        });
        sbSetSession(data);
        return { user: await sbMe() };
    }

    /* ---- sair ---- */
    if (path === '/api/auth/logout' && method === 'POST') {
        const s = sbGetSession();
        if (s && s.access_token) {
            try {
                await sbCall('/auth/v1/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + s.access_token } });
            } catch (e) { }
        }
        sbSetSession(null);
        return { ok: true };
    }

    /* ---- quem sou eu ---- */
    if (path === '/api/auth/me' && method === 'GET') return { user: await sbMe() };

    /* ---- esqueci a senha ---- */
    if (path === '/api/auth/forgot' && method === 'POST') {
        await sbRequest('/auth/v1/recover', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + sbAnon() },
            body: { email: String(body.email || '').trim().toLowerCase() }
        });
        return { message: 'Se existir uma conta com este e-mail, enviamos um link de redefinição. Confira a caixa de entrada e o spam.' };
    }

    /* ---- redefinir senha pelo link ---- */
    if (path === '/api/auth/reset' && method === 'POST') {
        const s = await sbEnsureSession();
        await sbCall('/auth/v1/user', {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + s.access_token },
            body: { password: String(body.password || '') }
        });
        sbSetSession(null);
        return { ok: true };
    }

    /* ---- trocar a senha (dentro do painel) ---- */
    if (path === '/api/auth/password' && method === 'POST') {
        const s = sbGetSession();
        if (!s || !s.user) throw sbThrow('Sua sessão expirou. Entre novamente.', 401);
        /* confere a senha atual antes de trocar */
        await sbRequest('/auth/v1/token?grant_type=password', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + sbAnon() },
            body: { email: s.user.email, password: String(body.current || '') }
        }).catch(err => { throw sbThrow('A senha atual está incorreta.', 400); });
        const sess = await sbEnsureSession();
        await sbCall('/auth/v1/user', {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + sess.access_token },
            body: { password: String(body.next || '') }
        });
        return { ok: true };
    }

    /* ---- dados financeiros ---- */
    if (path === '/api/me/state') {
        const s = await sbEnsureSession();
        let row = null;
        try { row = await sbRow(s); } catch (e) { throw e; }
        if (method === 'PUT') {
            await sbUpsert({ state: body.state || null });
            return { ok: true };
        }
        return { state: (row && row.state) || null };
    }

    if (path === '/api/me/profile' && method === 'PUT') {
        const campos = {};
        if (Object.prototype.hasOwnProperty.call(body, 'avatar')) campos.avatar = body.avatar || null;
        if (body.settings && typeof body.settings === 'object') campos.settings = body.settings;
        await sbUpsert(campos);
        return { ok: true, user: await sbMe() };
    }

    throw sbThrow('Requisição não reconhecida: ' + method + ' ' + path, 404);
}
