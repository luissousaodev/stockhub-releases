; StockHub Installer for Adobe Premiere Pro (NSIS)
; Instala em user-scope (sem admin) para permitir auto-update

!include "MUI2.nsh"

; --- Metadata ---
!define PRODUCT_NAME "StockHub"
!define PRODUCT_VERSION "1.1.0"
!define PRODUCT_PUBLISHER "Luis Sousa"
!define EXTENSION_ID "com.stockhub.panel"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "StockHub-${PRODUCT_VERSION}-Setup.exe"
RequestExecutionLevel user
InstallDir "$APPDATA\Adobe\CEP\extensions\${EXTENSION_ID}"

; --- UI ---
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao ${PRODUCT_NAME}"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instalara o ${PRODUCT_NAME} ${PRODUCT_VERSION} no seu computador.$\r$\n$\r$\nO ${PRODUCT_NAME} e um painel de assets para Adobe Premiere Pro.$\r$\n$\r$\nClique em Proximo para continuar."
!define MUI_FINISHPAGE_TITLE "Instalacao concluida"
!define MUI_FINISHPAGE_TEXT "${PRODUCT_NAME} foi instalado com sucesso.$\r$\n$\r$\nAbra o Adobe Premiere Pro e acesse:$\r$\nJanela > Extensoes > StockHub$\r$\n$\r$\nClique em Concluir para fechar."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "PortugueseBR"

; --- Install ---
Section "Install"
  SetOutPath "$INSTDIR"

  ; Copiar arquivos da extensao
  File /r "..\CSXS\*.*"
  SetOutPath "$INSTDIR\CSXS"
  File /r "..\CSXS\*.*"

  SetOutPath "$INSTDIR\client"
  File /r "..\client\*.*"

  SetOutPath "$INSTDIR\host"
  File /r "..\host\*.*"

  SetOutPath "$INSTDIR\lib"
  File /r "..\lib\*.*"

  SetOutPath "$INSTDIR"
  File "..\CHANGELOG.json"

  ; Habilitar extensoes nao assinadas (CEP debug mode)
  WriteRegStr HKCU "SOFTWARE\Adobe\CSXS.12" "PlayerDebugMode" "1"

  ; Registrar desinstalador
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegDWORD HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "NoModify" 1
  WriteRegDWORD HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "NoRepair" 1
SectionEnd

; --- Uninstall ---
Section "Uninstall"
  ; Remover arquivos da extensao
  RMDir /r "$INSTDIR\CSXS"
  RMDir /r "$INSTDIR\client"
  RMDir /r "$INSTDIR\host"
  RMDir /r "$INSTDIR\lib"
  Delete "$INSTDIR\CHANGELOG.json"
  Delete "$INSTDIR\uninstall.exe"

  ; Nao remover stockhub-data.json (dados do usuario)

  RMDir "$INSTDIR"

  ; Remover registro
  DeleteRegKey HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
SectionEnd
