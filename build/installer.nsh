; Older Orbit clients start updates with --updated, but without /S.
; Keep first-time setup interactive and make that upgrade path silent too.
!macro customInit
  ${if} ${isUpdated}
    SetSilent silent
  ${endif}
!macroend
