# Mare Fishing

Jogo de pesca online em HTML/CSS/JavaScript inspirado no gênero de aventura de pesca e exploração. O projeto usa **Supabase** para autenticação, banco, Realtime e lógica autoritativa de captura, e **Vercel** para hospedagem do frontend.

## Recursos

- PC e mobile, incluindo joystick touch e controles de teclado
- Fluxo de pesca: lançamento, shakes, mordida e reel
- 30 peixes, 15 varas, 9 iscas, 6 barcos e 7 regiões iniciais
- Peso, raridade, mutações, atributos, valor e XP calculados pelo servidor
- Inventário, favoritos, Sell All, bestiário, loja, equipamentos e quests
- Ciclo de clima, estação, dia/noite e eventos globais
- Multiplayer por presença Realtime e anúncios de capturas raras
- Supabase Auth + RLS; nenhuma service-role key é enviada ao navegador

## Estrutura

- `index.html` — interface principal
- `styles.css` — visual responsivo
- `app.js` — cliente, canvas, controles e Realtime
- `supabase/schema.sql` — schema base
- `supabase/functions/mare-game/index.ts` — lógica autoritativa do servidor
- `vercel.json` — configuração do deploy estático

## Segurança

O cliente usa apenas a **publishable key** do Supabase. A `service_role` fica disponível somente no ambiente da Edge Function. Todas as tabelas públicas usam Row Level Security.
