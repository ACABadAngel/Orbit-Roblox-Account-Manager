; Older Orbit clients start updates with --updated, but without /S.
; Keep first-time setup interactive and make that upgrade path silent too.
!macro customInit
  ${if} ${isUpdated}
    SetSilent silent
  ${endif}
!macroend

; Launch the installed executable directly on an accepted update. A stale or
; removed Start-menu shortcut must not determine whether the app reopens.
; StdUtils preserves the desktop user's token after an elevated installation.
!macro customInstall
  ${if} ${isUpdated}
  ${andIf} ${isForceRun}
  ${andIf} ${Silent}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" "--updated"
    !insertmacro quitSuccess
  ${endif}
!macroend
