# StockHub

Painel para Adobe Premiere Pro que centraliza seus assets de stock (videos, imagens, audio e MOGRTs) em um unico lugar, com preview em hover, categorias automaticas, busca, importacao direta e atualizacao integrada.

---

## Funcionalidades

### Biblioteca

- **Grid visual** — miniaturas de video e imagem com scrubbing por hover (avance/retroceda o video movendo o mouse); audio toca preview com indicador animado
- **Categorias e subcategorias** — hierarquia de pastas na sidebar; crie, renomeie, recolore e exclua pelo menu de contexto
- **Favoritos** — marque assets para acesso rapido
- **Busca e filtros** — filtre por Todos, Video, Audio, Imagem ou MOGRT
- **Sidebar redimensionavel** — ajuste a largura arrastando a borda

### Importacao

- **Botao de importacao** — envia o arquivo ao bin `StockHub` no painel de projeto
- **Duplo clique** — importa e insere na timeline na posicao do playhead, em uma faixa livre
- **Drag & drop** — arraste direto para a timeline; o arquivo e movido automaticamente para o bin `StockHub`

### Google Drive & Cloud

- **Pasta sincronizada via Drive** — aponte o StockHub para uma pasta do Google Drive Desktop para compartilhar a biblioteca entre maquinas
- **Deteccao de placeholders** — arquivos do Drive Stream exibem badge de nuvem
- **Staging local** — assets na nuvem sao copiados localmente antes de importar, evitando crash na exportacao
- **Cache portatil** — cache e categorias usam paths relativos, funcionando entre Windows e macOS

### Versionamento & Updates

- **Versao visivel** — `vX.X.X` no footer do painel; clique para ver detalhes
- **Boas-vindas** — modal de onboarding na primeira execucao (4 slides)
- **O que ha de novo** — apos cada atualizacao, modal com changelog das mudancas
- **Changelog** — historico completo acessivel nas configuracoes
- **Auto-update** — detecta nova versao na pasta do Drive e atualiza com 1 clique

---

## Requisitos

| Requisito | Versao |
|---|---|
| Adobe Premiere Pro | 22.0 ou superior (2022+) |
| Adobe CEP Runtime | 12.0 |
| Sistema operacional | Windows 10/11 ou macOS 10.15+ |

> O painel usa Node.js embutido no CEP. Nao e necessario instalar Node.js separadamente.

---

## Instalacao

### 1. Copiar a extensao

Copie a pasta `StockHub` para o diretorio de extensoes CEP:

**Windows (user-scope, recomendado):**
```
%APPDATA%\Adobe\CEP\extensions\StockHub
```

**Windows (system-scope):**
```
C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\StockHub
```

**macOS (user-scope, recomendado):**
```
~/Library/Application Support/Adobe/CEP/extensions/StockHub
```

**macOS (system-scope):**
```
/Library/Application Support/Adobe/CEP/extensions/StockHub
```

> **Importante:** Instale em user-scope para que o auto-update funcione sem precisar de permissoes de administrador.

### 2. Habilitar extensoes nao assinadas (apenas uma vez)

**Windows:** Abra o Editor de Registro (`regedit`) e navegue ate:
```
HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.12
```
Crie ou edite o valor `PlayerDebugMode` como **String** com valor `1`.

**macOS:** Execute no Terminal:
```
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

### 3. Reiniciar o Premiere Pro

Acesse em **Janela > Extensoes > StockHub**.

---

## Integracao com Google Drive Desktop

Use o Google Drive para Desktop para sincronizar a biblioteca de assets entre maquinas.

### Configuracao

1. Instale o [Google Drive para Desktop](https://www.google.com/drive/download/)
2. Escolha o modo de sincronizacao:
   - **Stream files (padrao):** arquivos ficam na nuvem e sao baixados sob demanda
   - **Mirror files:** mantem copia local completa (melhor para bibliotecas grandes)
3. Crie uma pasta no Drive, ex: `Meu Drive/StockHub`
4. No painel StockHub, abra **Configuracoes** > **Pasta de Assets** > **Alterar pasta**
5. Selecione a pasta do Drive

### Caminhos tipicos

| SO | Stream | Mirror |
|---|---|---|
| Windows | `G:\Meu Drive\StockHub` | `C:\Users\<usuario>\Meu Drive\StockHub` |
| macOS | `/Volumes/GoogleDrive/Meu Drive/StockHub` | `~/Google Drive/Meu Drive/StockHub` |

### Staging local

Quando um asset esta na nuvem (badge de nuvem no canto), o StockHub copia o arquivo para uma pasta local antes de importar no Premiere. Isso evita crash na exportacao caso o Drive Desktop evite o arquivo.

- A pasta padrao e `~/StockHub_staging`
- Altere a pasta em **Configuracoes** > **Staging Local**
- Use **Limpar staging** para liberar espaco

---

## Versionamento e Updates

O StockHub tem um sistema integrado de versionamento que facilita a distribuicao de atualizacoes para sua equipe.

### Como funciona

1. O desenvolvedor cria a pasta de updates dentro da pasta de assets compartilhada no Drive
2. Editores recebem os arquivos via sincronizacao do Drive
3. Ao abrir o Premiere, o StockHub detecta a nova versao e exibe um banner
4. Com 1 clique, o editor atualiza a extensao e o painel recarrega

### Passo a passo para o desenvolvedor

#### 1. Preparar a estrutura de updates

Dentro da pasta de assets compartilhada (ex: `G:\Meu Drive\StockHub`), crie:

```
StockHub/                       <- pasta de assets
├── Videos/
├── Imagens/
├── ...
└── stockhub-updates/           <- pasta de updates (criar esta)
    ├── version.json            <- metadados da versao
    └── latest/                 <- copia completa da extensao
        ├── CSXS/
        │   └── manifest.xml
        ├── client/
        │   ├── index.html
        │   ├── app.js
        │   └── styles.css
        ├── host/
        │   └── host.jsx
        ├── lib/
        │   └── CSInterface.js
        └── CHANGELOG.json
```

#### 2. Criar o `version.json`

```json
{
  "version": "1.2.0",
  "date": "2026-04-15",
  "notes": "Novo sistema de favoritos e correcoes de bugs"
}
```

- `version`: deve ser maior que a versao atual (`APP_VERSION` em `client/app.js`)
- `date`: data de lancamento
- `notes`: resumo curto exibido no banner de update

#### 3. Copiar os arquivos da extensao para `latest/`

Copie todos os arquivos da extensao (exceto `.cache`, `stockhub-data.json` e a propria pasta `stockhub-updates`) para `stockhub-updates/latest/`.

**Windows (PowerShell):**
```powershell
$src = "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\StockHub"
$dst = "G:\Meu Drive\StockHub\stockhub-updates\latest"

# Limpar destino
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst -Force

# Copiar excluindo cache e dados locais
robocopy $src $dst /MIR /XD ".cache" "stockhub-updates" /XF "stockhub-data.json"
```

**macOS (Terminal):**
```bash
SRC=~/Library/Application\ Support/Adobe/CEP/extensions/StockHub
DST=~/Google\ Drive/Meu\ Drive/StockHub/stockhub-updates/latest

rm -rf "$DST"
mkdir -p "$DST"

rsync -av --exclude='.cache' --exclude='stockhub-updates' \
  --exclude='stockhub-data.json' "$SRC/" "$DST/"
```

#### 4. Atualizar o `CHANGELOG.json`

Adicione a nova versao no inicio do array `versions`:

```json
{
  "versions": [
    {
      "version": "1.2.0",
      "date": "2026-04-15",
      "changes": {
        "added": ["Descricao do que foi adicionado"],
        "fixed": ["Descricao do que foi corrigido"],
        "changed": ["Descricao do que foi alterado"]
      }
    }
  ]
}
```

#### 5. Incrementar a versao

Atualize `APP_VERSION` em `client/app.js` e as versoes em `CSXS/manifest.xml`.

#### 6. Aguardar a sincronizacao

O Drive Desktop sincroniza automaticamente. Quando os editores abrirem o Premiere, verao o banner de atualizacao.

### O que o editor ve

1. **Banner azul no topo do painel:** "StockHub v1.2.0 disponivel — [nota]"
2. **Clique em "Atualizar agora":** os arquivos sao copiados e o painel recarrega
3. **Modal "O que ha de novo":** exibe automaticamente o changelog das mudancas

> Se a extensao esta instalada em system-scope (ex: `C:\Program Files (x86)\...`), o auto-update nao tera permissao de escrita. O editor vera um modal com instrucoes para copiar manualmente.

### Checklist de update

- [ ] Incrementar `APP_VERSION` em `client/app.js`
- [ ] Incrementar versoes em `CSXS/manifest.xml`
- [ ] Adicionar entrada no `CHANGELOG.json`
- [ ] Copiar extensao para `stockhub-updates/latest/`
- [ ] Atualizar `stockhub-updates/version.json`
- [ ] Verificar que o Drive sincronizou

---

## Estrutura do projeto

```
StockHub/
├── CSXS/
│   └── manifest.xml        # Manifesto CEP (ID, versao, hosts)
├── client/
│   ├── index.html          # Estrutura do painel
│   ├── app.js              # Logica principal (scan, grid, staging, updates)
│   └── styles.css          # Estilos visuais (tema dark)
├── host/
│   └── host.jsx            # ExtendScript: importacao no projeto e timeline
├── lib/
│   └── CSInterface.js      # Biblioteca CEP oficial da Adobe
├── CHANGELOG.json          # Historico de versoes
└── README.md
```

---

## Uso

### Pasta de assets

Por padrao, usa `~/StockHub`. Para alterar:

1. **Configuracoes** (engrenagem) > **Pasta de Assets** > **Alterar pasta**
2. Selecione a pasta desejada
3. Escolha se deseja criar categorias a partir das subpastas
4. **Salvar e voltar**

### Importacao

| Acao | Resultado |
|---|---|
| Botao `v` no card | Importa para o bin `StockHub` no projeto |
| Duplo clique | Importa e insere na timeline (playhead) |
| Drag & drop | Arrasta para a timeline e organiza no bin `StockHub` |

### Categorias

- **Criar:** `+` na sidebar ou **Adicionar categoria** nas configuracoes
- **Renomear:** clique no nome nas configuracoes
- **Recolorir:** clique no indicador de cor
- **Excluir:** marque e clique em **Excluir selecionadas**
- **Mover arquivo:** botao direito > selecione a categoria

---

## Persistencia de estado

As configuracoes sao salvas em:

```
# Windows
%APPDATA%\Adobe\CEP\extensions\StockHub\stockhub-data.json

# macOS
~/Library/Application Support/Adobe/CEP/extensions/StockHub/stockhub-data.json
```

---

## Desenvolvimento

Sem bundler ou build — edite os arquivos e recarregue o painel.

### Recarregar sem reiniciar o Premiere

Com `PlayerDebugMode = 1`, clique direito no painel > **Reload Extension**.

### Adicionar formatos

Em `client/app.js`, adicione a extensao em `FORMAT_GROUPS`:

```js
var FORMAT_GROUPS = {
  video: [".mp4", ".mov", /* ... */],
  audio: [".mp3", ".wav", /* ... */],
  image: [".jpg", ".png", /* ... */],
  mogrt: [".mogrt"]
};
```

---

## Licenca

Uso privado. Todos os direitos reservados.
