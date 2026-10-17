!macro traceInstaller PHASE
  Push $R8
  FileOpen $R8 "$TEMP\pi-nsis-probe.txt" a
  FileWrite $R8 "${PHASE}: target=$INSTDIR; command=$CMDLINE$\r$\n"
  ${If} ${IsNativeARM64}
    FileWrite $R8 "native-arm64=true$\r$\n"
  ${Else}
    FileWrite $R8 "native-arm64=false$\r$\n"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\Pi-Harness.exe"
    FileWrite $R8 "executable-present=true$\r$\n"
  ${EndIf}
  FileClose $R8
  Pop $R8
!macroend
!macro preInit
  !insertmacro traceInstaller "preInit"
!macroend
!macro customInit
  !insertmacro traceInstaller "customInit"
!macroend
!macro customInstall
  !insertmacro traceInstaller "customInstall"
!macroend
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Function .onInstFailed
      !insertmacro traceInstaller "failed"
    FunctionEnd
    Function .onInstSuccess
      !insertmacro traceInstaller "success"
    FunctionEnd
  !endif
!macroend
