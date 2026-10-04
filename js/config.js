/* ==========================================================================
   CENTAVUS — CONFIGURAÇÃO DA NUVEM (Supabase)
   ---------------------------------------------------------------------------
   Preencha os dois campos abaixo com os dados do seu projeto:

     Supabase → Project Settings → API
       Project URL  →  https://xxxxxxxxxxxx.supabase.co
       anon public  →  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
                       (ou sb_publishable_... nas contas novas)

   Enquanto os dois campos estiverem VAZIOS o site continua funcionando
   como antes: conta guardada só neste aparelho (modo teste).

   Com as chaves preenchidas, a conta e os dados financeiros passam a ficar
   na nuvem — o mesmo e-mail e a senha valem no celular e no computador.

   Esta chave é PÚBLICA de propósito: ela vai dentro do site que todo mundo
   vê. O que protege seus dados é o Row Level Security da tabela.
   ========================================================================== */
window.CV_SUPABASE = {
    url: 'https://sgvotmzafqxqofhzmnay.supabase.co',
    anonKey: 'sb_publishable_sdQ5mcuDNBgE5c130wm0pw_1xaZE2Tt'
};
