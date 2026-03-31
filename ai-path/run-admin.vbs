' run-admin.vbs
' Launches a Node.js script as Administrator.
' UAC prompt appears ONCE. Required for WireGuard tunnel operations.
'
' Usage: Double-click this file, OR:
'   cscript run-admin.vbs                     (runs setup.js)
'   cscript run-admin.vbs test-wireguard.mjs  (runs specific script)

Dim oShell, oFSO, sDir, sScript, sCmd
Set oShell = CreateObject("Shell.Application")
Set oFSO   = CreateObject("Scripting.FileSystemObject")

sDir = oFSO.GetParentFolderName(WScript.ScriptFullName)

' Get script argument or default to setup.js
If WScript.Arguments.Count > 0 Then
    sScript = WScript.Arguments(0)
Else
    sScript = "setup.js"
End If

sCmd = "/k title Sentinel AI Path (Admin) && cd /d """ & sDir & """ && echo. && echo  Sentinel AI Path - Running as Administrator && echo  Script: " & sScript & " && echo. && node " & sScript

' Launch elevated cmd.exe (triggers UAC once)
oShell.ShellExecute "cmd.exe", sCmd, sDir, "runas", 1
