; WP-Shell: register Vellum as an "Open with" handler for PDFs and images, per user, without
; taking over the default app. Tauri's own fileAssociations setting writes the extension's
; default value (which makes Vellum the default wherever the user hasn't chosen one), so it is
; not used; these hooks only add OpenWithProgids entries and an Applications key.
; https://learn.microsoft.com/windows/win32/shell/how-to-include-an-application-on-the-open-with-dialog-box

!define VELLUM_PROGID "Vellum.Document"
!define VELLUM_EXE "${MAINBINARYNAME}.exe"

!macro VellumAddExt EXT
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${VELLUM_PROGID}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${VELLUM_EXE}\SupportedTypes" ".${EXT}" ""
!macroend

!macro VellumRemoveExt EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${VELLUM_PROGID}"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\OpenWithProgids"
!macroend

!macro VellumForEachExt MACRO
  !insertmacro ${MACRO} "pdf"
  !insertmacro ${MACRO} "jpg"
  !insertmacro ${MACRO} "jpeg"
  !insertmacro ${MACRO} "png"
  !insertmacro ${MACRO} "webp"
  !insertmacro ${MACRO} "tif"
  !insertmacro ${MACRO} "tiff"
  !insertmacro ${MACRO} "bmp"
  !insertmacro ${MACRO} "gif"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\${VELLUM_PROGID}" "" "Vellum document"
  WriteRegStr HKCU "Software\Classes\${VELLUM_PROGID}\DefaultIcon" "" "$INSTDIR\${VELLUM_EXE},0"
  WriteRegStr HKCU "Software\Classes\${VELLUM_PROGID}\shell\open\command" "" '"$INSTDIR\${VELLUM_EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${VELLUM_EXE}" "FriendlyAppName" "Vellum"
  WriteRegStr HKCU "Software\Classes\Applications\${VELLUM_EXE}\DefaultIcon" "" "$INSTDIR\${VELLUM_EXE},0"
  WriteRegStr HKCU "Software\Classes\Applications\${VELLUM_EXE}\shell\open\command" "" '"$INSTDIR\${VELLUM_EXE}" "%1"'
  !insertmacro VellumForEachExt VellumAddExt
  ; SHCNE_ASSOCCHANGED, so Explorer's "Open with" list picks the change up at once.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro VellumForEachExt VellumRemoveExt
  DeleteRegKey HKCU "Software\Classes\${VELLUM_PROGID}"
  DeleteRegKey HKCU "Software\Classes\Applications\${VELLUM_EXE}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
