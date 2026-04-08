# StockHub

Painel para Adobe Premiere Pro que centraliza seus assets de stock (videos, imagens, audio e MOGRTs) em um unico lugar, com visualizacao em grid, categorias, busca e importacao direta para o projeto ou timeline.

---

## Funcionalidades

- **Biblioteca visual em grid** — miniaturas de video e imagem com preview visual ao passar o mouse; arquivos de audio tocam um preview sonoro com indicador animado
- **Categorias e subcategorias** — hierarquia de pastas na sidebar com suporte a subcategorias; crie, renomeie, recolore e exclua pelo menu de contexto
- **Favoritos** — marque assets como favoritos para acesso rapido em uma secao dedicada
- **Pasta de assets configuravel** — escolha qualquer pasta no seu sistema usando o explorador de arquivos nativo (Windows e macOS); a escolha persiste entre sessoes
- **Integracao com Google Drive Desktop** — use uma pasta sincronizada do Google Drive para compartilhar a biblioteca entre maquinas
- **Auto-categorias por subpastas** — ao importar uma nova pasta, subpastas (e suas subpastas) viram categorias e subcategorias automaticamente
- **Busca e filtros por formato** — filtre por Todos, Video, Audio, Imagem ou MOGRT
- **Sidebar redimensionavel** — ajuste a largura da barra lateral conforme sua preferencia
- **Importar para o projeto** — botao de importacao envia o arquivo ao bin `StockHub` no painel de projeto
- **Inserir na timeline** — duplo clique insere o clip na posicao do playhead, em uma faixa livre, sem sobrescrever clips existentes
- **Exportacao em CSV** — exporte a lista de assets com dialogo nativo de salvar arquivo
- **Tamanho de grid ajustavel** — slider para controlar o tamanho das miniaturas
- **Tema dark profundo** — paleta inspirada na interface do Premiere Pro
- **Estado persistente** — categorias, favoritos, pasta customizada e configuracoes sao salvas entre sessoes

---

## Requisitos

| Requisito | Versao |
|---|---|
| Adobe Premiere Pro | 22.0 ou superior (2022+) |
| Adobe CEP Runtime | 12.0 |
| Sistema operacional | Windows 10/11 ou macOS 10.15+ |

> O painel usa Node.js embutido no CEP para leitura de arquivos. Nao e necessario instalar Node.js separadamente.

---

## Instalacao

1. **Baixe ou clone** este repositorio
2. **Copie a pasta `StockHub`** para o diretorio de extensoes CEP:

   **Windows:**
   ```
   C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\StockHub
   ```

   **macOS:**
   ```
   /Library/Application Support/Adobe/CEP/extensions/StockHub
   ```

3. **Habilite extensoes nao assinadas** (apenas na primeira vez):

   **Windows:** Abra o Editor de Registro (`regedit`) e navegue ate:
   ```
   HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.12
   ```
   Crie ou edite o valor `PlayerDebugMode` como **String** com valor `1`.

   **macOS:** Execute no Terminal:
   ```
   defaults write com.adobe.CSXS.12 PlayerDebugMode 1
   ```

4. **Reinicie o Premiere Pro**

5. Acesse em **Janela > Extensoes > StockHub**

---

## Integracao com Google Drive Desktop (opcional)

Use o **Google Drive para Desktop** para sincronizar sua biblioteca de assets entre maquinas e colaboradores. Assim, qualquer asset adicionado a pasta sera refletido automaticamente no StockHub em todos os computadores conectados a mesma conta.

### 1. Instalar o Google Drive para Desktop

1. Baixe o instalador oficial em: <https://www.google.com/drive/download/>
2. Execute o instalador e faca login com sua conta Google
3. Conclua o assistente de configuracao

### 2. Configurar a pasta sincronizada

Na bandeja do sistema (Windows) ou barra de menu (macOS), clique no icone do Google Drive e abra **Preferencias**:

- **Opcao A — Stream files (recomendado):** os arquivos ficam na nuvem e sao baixados sob demanda. A unidade `Google Drive` aparecera como um drive virtual (ex.: `G:\Meu Drive` no Windows).
- **Opcao B — Mirror files:** mantem uma copia local completa da pasta. Use esta opcao se precisar de acesso offline garantido aos assets.

> Para bibliotecas grandes, prefira **Mirror files** para evitar latencia ao gerar miniaturas e previews.

### 3. Apontar o StockHub para a pasta do Drive

1. Crie (ou escolha) uma pasta dentro do seu Google Drive, por exemplo `Meu Drive\StockHub`
2. No painel StockHub, abra **Configuracoes** (engrenagem)
3. Em **Pasta de Assets**, clique em **Alterar pasta**
4. Navegue ate a pasta dentro do Google Drive e selecione-a
5. Marque **criar categorias automaticamente a partir das subpastas** se desejar
6. Clique em **Salvar e voltar**

### 4. Caminhos tipicos

**Windows:**
```
G:\Meu Drive\StockHub
C:\Users\<usuario>\Meu Drive\StockHub   (modo Mirror)
```

**macOS:**
```
/Volumes/GoogleDrive/Meu Drive/StockHub
~/Google Drive/Meu Drive/StockHub       (modo Mirror)
```

### Dicas

- Aguarde a sincronizacao terminar antes de importar arquivos para o Premiere Pro — arquivos ainda em download podem falhar a importacao
- No modo Stream, clique com o botao direito em pastas/arquivos no Explorer e selecione **Disponivel offline** para garantir cache local
- Mantenha a estrutura de subpastas consistente entre maquinas — o StockHub recriara as categorias automaticamente em cada uma

---

## Estrutura do projeto

```
StockHub/
├── CSXS/
│   └── manifest.xml        # Manifesto CEP (ID, versao, hosts suportados)
├── client/
│   ├── index.html          # Estrutura do painel
│   ├── app.js              # Logica principal da UI (scan, categorias, grid, estado)
│   └── styles.css          # Estilos visuais
├── host/
│   └── host.jsx            # ExtendScript: importacao no projeto e timeline
├── lib/
│   └── CSInterface.js      # Biblioteca CEP oficial da Adobe
└── README.md
```

### Responsabilidade de cada arquivo

**`CSXS/manifest.xml`**
Declara o painel para o Premiere Pro: ID do bundle (`com.stockhub.panel`), versao, host suportado (PPRO >= 22.0) e flags do CEF necessarios para Node.js e acesso a arquivos locais.

**`host/host.jsx`** (ExtendScript)
Roda no contexto do Premiere Pro. Expoe tres funcoes chamadas via `cs.evalScript`:
- `importFileToProject(filePath)` — importa o arquivo para o bin `StockHub` no painel de projeto
- `importFileToTimeline(filePath)` — importa e insere na posicao do playhead em uma faixa de video livre
- `getProjectPath()` — retorna o diretorio do projeto atual

**`client/app.js`**
Toda a logica do painel: varredura de pasta, renderizacao do grid, gerenciamento de categorias, persistencia de estado em JSON, geracao de miniaturas e comunicacao com `host.jsx`.

**`client/styles.css`**
Tema escuro inspirado na interface do Premiere Pro, usando variaveis CSS para cores e espacamentos.

**`lib/CSInterface.js`**
Biblioteca oficial da Adobe para comunicacao entre o painel CEP e o host (Premiere Pro).

---

## Uso

### Pasta de assets

Por padrao, o StockHub usa `~/StockHub` (`%USERPROFILE%\StockHub` no Windows, `~/StockHub` no macOS). Para usar outra pasta:

1. Clique no icone de configuracoes (engrenagem) no canto superior direito
2. Na secao **Pasta de Assets**, clique em **Alterar pasta**
3. Selecione a pasta desejada no explorador de arquivos (abre sobre todas as janelas)
4. Escolha se deseja criar categorias automaticamente a partir das subpastas
5. Clique em **Salvar e voltar**

Para voltar a pasta padrao, clique em **Restaurar pasta padrao**.

### Categorias

- **Criar**: clique no `+` na barra lateral ou em **Adicionar categoria** nas configuracoes
- **Renomear**: nas configuracoes, clique no nome da categoria e edite
- **Recolorir**: nas configuracoes, clique no indicador de cor para ciclar entre as cores
- **Excluir**: nas configuracoes, marque as categorias e clique em **Excluir selecionadas**
- **Mover arquivo**: clique com o botao direito no arquivo e selecione a categoria de destino

### Importacao

| Acao | Resultado |
|---|---|
| Botao `v` no card do arquivo | Importa para o bin `StockHub` no projeto |
| Duplo clique no arquivo | Importa e insere na timeline na posicao do playhead |

---

## Persistencia de estado

As configuracoes sao salvas em:

**Windows:**
```
%APPDATA%\Adobe\CEP\extensions\StockHub\stockhub-data.json
```

**macOS:**
```
~/Library/Application Support/Adobe/CEP/extensions/StockHub/stockhub-data.json
```

O arquivo armazena categorias, pasta customizada, categoria de cada arquivo, tamanho do grid e IDs de categorias deletadas (para evitar que subpastas as recriem automaticamente).

---

## Desenvolvimento

Nao ha bundler ou processo de build — edite os arquivos diretamente e recarregue o painel.

### Recarregar sem reiniciar o Premiere Pro

Com `PlayerDebugMode = 1` ativo, clique com o botao direito no painel e selecione **Reload Extension**.

### Adicionar suporte a novos formatos

Em `client/app.js`, adicione a extensao ao grupo correspondente em `FORMAT_GROUPS`:

```js
var FORMAT_GROUPS = {
  video: [".mp4", ".mov", /* adicione aqui */],
  audio: [".mp3", ".wav", /* adicione aqui */],
  image: [".jpg", ".png", /* adicione aqui */],
  mogrt: [".mogrt"]
};
```

---

## Licenca

Uso privado. Todos os direitos reservados.
