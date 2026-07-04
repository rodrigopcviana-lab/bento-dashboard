# Portal do Bar | Bento

Site estático (GitHub Pages) do Bento (Anápolis) — independente do Grupo IZ:
https://rodrigopcviana-lab.github.io/bento-dashboard/

## Estrutura

- `index.html`, `cocktails.html`, `regras.html` — portal público, gerado por
  `bento/portal_gen.py` (no projeto `~/Desktop/Code 1`). **Não editar à mão.**
- `ranking.html` — ranking de produtos (posições da Curva ABC, sem valores),
  **criptografado com senha** (staticrypt, AES-256).
- `vendas/index.html` (painel geral) e `vendas/completo.html` (produto a
  produto) — dashboards de vendas **criptografados com senha**. O conteúdo só
  é legível com a senha; o repo pode ser público sem expor os dados.
- `.staticrypt.json` — salt da criptografia (não é segredo; manter para que o
  "lembrar neste aparelho" continue válido entre republicações).

## Como republicar

```bash
cd ~/Desktop/"Code 1"

# 1. Regenerar dashboards e portal
.venv/bin/python dashboard_gen.py bento       # completo (bento_dashboard.html)
.venv/bin/python dashboard_grupo.py bento     # painel (bento_painel.html)
.venv/bin/python bento/portal_gen.py

# 2. Copiar portal público
cp dashboards/portal_bento/*.html ~/Desktop/bento-dashboard-site/

# 3. Criptografar ranking + vendas (staging com nomes finais; senha via env)
STAGE=$(mktemp -d); cd "$STAGE"
cp ~/Desktop/"Code 1"/dashboards/bento_painel.html                       index.html
cp ~/Desktop/"Code 1"/dashboards/bento_dashboard.html                    completo.html
cp ~/Desktop/"Code 1"/dashboards/portal_bento/_restrito/ranking.html     ranking.html
cp ~/Desktop/bento-dashboard-site/.staticrypt.json .    # reusa o salt
export STATICRYPT_PASSWORD='<senha atual>'
npx --yes staticrypt *.html -d encrypted --short --remember 90 \
  --template-title "Vendas | Bento" \
  --template-instructions "Área restrita da coordenação. Digite a senha para ver o conteúdo." \
  --template-button "Entrar" --template-placeholder "Senha" \
  --template-error "Senha incorreta — tente de novo" \
  --template-remember "Lembrar neste aparelho" \
  --template-color-primary "#d5a05c" --template-color-secondary "#2b2620"
cp encrypted/ranking.html  ~/Desktop/bento-dashboard-site/ranking.html
cp encrypted/index.html    ~/Desktop/bento-dashboard-site/vendas/index.html
cp encrypted/completo.html ~/Desktop/bento-dashboard-site/vendas/completo.html

# 4. Publicar
cd ~/Desktop/bento-dashboard-site
git add -A && git commit -m "Atualiza portal e vendas" && git push
```

Para **trocar a senha**: rodar o passo 3 com outro `STATICRYPT_PASSWORD` e
fazer push. Sessões "lembradas" com a senha antiga deixam de funcionar.

O Grupo IZ tem site separado (grupo-iz-dashboard) — não entra aqui.
