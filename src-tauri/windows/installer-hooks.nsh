; WP-Shell: register Vellum as an "Open with" handler for PDFs and images, per user, without
; taking over the default app. Tauri's own fileAssociations setting writes the extension's
; default value (which makes Vellum the default wherever the user hasn't chosen one), so it is
; not used; these hooks only add OpenWithProgids entries and an Applications key.
; https://learn.microsoft.com/windows/win32/shell/how-to-include-an-application-on-the-open-with-dialog-box
;
; Two file types: Vellum.PDF, with the document icon (document.ico, beside the exe), and
; Vellum.Image, with the app icon. Windows remembers a user's default by the type's name, so
; these names are for good (docs/document-icon-brief.md). They replace Vellum.Document, used
; up to 0.2.0-rc2, which the install removes so Open with doesn't list Vellum twice.

!define VELLUM_PDF "Vellum.PDF"
!define VELLUM_IMAGE "Vellum.Image"
!define VELLUM_OLD "Vellum.Document"
!define VELLUM_EXE "${MAINBINARYNAME}.exe"

!macro VellumAddExt PROGID EXT
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${VELLUM_EXE}\SupportedTypes" ".${EXT}" ""
!macroend

!macro VellumRemoveExt PROGID EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\OpenWithProgids"
!macroend

; MACRO is called as MACRO PROGID EXT for every type Vellum opens; PDF_ID and IMAGE_ID say
; which type each extension goes to (the same for both when removing the old one).
!macro VellumForEachExt MACRO PDF_ID IMAGE_ID
  !insertmacro ${MACRO} "${PDF_ID}" "pdf"
  !insertmacro ${MACRO} "${IMAGE_ID}" "jpg"
  !insertmacro ${MACRO} "${IMAGE_ID}" "jpeg"
  !insertmacro ${MACRO} "${IMAGE_ID}" "png"
  !insertmacro ${MACRO} "${IMAGE_ID}" "webp"
  !insertmacro ${MACRO} "${IMAGE_ID}" "tif"
  !insertmacro ${MACRO} "${IMAGE_ID}" "tiff"
  !insertmacro ${MACRO} "${IMAGE_ID}" "bmp"
  !insertmacro ${MACRO} "${IMAGE_ID}" "gif"
!macroend

!macro VellumWriteType PROGID NAME ICON
  WriteRegStr HKCU "Software\Classes\${PROGID}" "" "${NAME}"
  WriteRegStr HKCU "Software\Classes\${PROGID}\DefaultIcon" "" "${ICON}"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\${VELLUM_EXE}" "%1"'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The old single type, from 0.2.0-rc2 and before.
  !insertmacro VellumForEachExt VellumRemoveExt "${VELLUM_OLD}" "${VELLUM_OLD}"
  DeleteRegKey HKCU "Software\Classes\${VELLUM_OLD}"

  !insertmacro VellumWriteType "${VELLUM_PDF}" "Vellum PDF document" "$INSTDIR\document.ico"
  !insertmacro VellumWriteType "${VELLUM_IMAGE}" "Vellum image" "$INSTDIR\${VELLUM_EXE},0"
  WriteRegStr HKCU "Software\Classes\Applications\${VELLUM_EXE}" "FriendlyAppName" "Vellum"
  WriteRegStr HKCU "Software\Classes\Applications\${VELLUM_EXE}\DefaultIcon" "" "$INSTDIR\${VELLUM_EXE},0"
  WriteRegStr HKCU "Software\Classes\Applications\${VELLUM_EXE}\shell\open\command" "" '"$INSTDIR\${VELLUM_EXE}" "%1"'
  !insertmacro VellumForEachExt VellumAddExt "${VELLUM_PDF}" "${VELLUM_IMAGE}"
  ; SHCNE_ASSOCCHANGED, so Explorer's "Open with" list and icons pick the change up at once.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro VellumForEachExt VellumRemoveExt "${VELLUM_PDF}" "${VELLUM_IMAGE}"
  !insertmacro VellumForEachExt VellumRemoveExt "${VELLUM_OLD}" "${VELLUM_OLD}"
  DeleteRegKey HKCU "Software\Classes\${VELLUM_PDF}"
  DeleteRegKey HKCU "Software\Classes\${VELLUM_IMAGE}"
  DeleteRegKey HKCU "Software\Classes\${VELLUM_OLD}"
  DeleteRegKey HKCU "Software\Classes\Applications\${VELLUM_EXE}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
