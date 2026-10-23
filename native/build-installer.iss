#define AppVersion "0.6.2"
[Setup]
AppId={{3172801E-51D2-44A0-90D1-FA42169D1270}
AppName=Orbit
AppVersion={#AppVersion}
AppPublisher=Paul Schenkenfelder
DefaultDirName={localappdata}\Programs\Orbit Native
DefaultGroupName=Orbit
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=artifacts
OutputBaseFilename=Orbit-Native-Setup
Compression=lzma2
SolidCompression=yes
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\Orbit.Native.exe
SetupIconFile=..\build\icon.ico
[Files]
Source: "artifacts\portable\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Orbit"; Filename: "{app}\Orbit.Native.exe"
Name: "{autodesktop}\Orbit"; Filename: "{app}\Orbit.Native.exe"; Tasks: desktopicon
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
[Run]
Filename: "{app}\Orbit.Native.exe"; Description: "Open Orbit"; Flags: nowait postinstall skipifsilent
; Roblox URL registration stays an explicit, reversible action inside Orbit.
; Data is under LocalAppData\Orbit\NativePreview and is retained on uninstall.

[UninstallRun]
Filename: "{app}\Orbit.Native.exe"; Parameters: "--restore-handler"; Flags: runhidden waituntilterminated
