param([string]$Output)
$ErrorActionPreference = 'Stop'
# A normal test application, not the Roblox client. Its executable name exercises
# production process/handle validation without accounts or game credentials.
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $Output -OutputType WindowsApplication -TypeDefinition @'
using System;
using System.Windows.Forms;
using System.Drawing;
public class WindowFixture : Form {
  public WindowFixture() {
    Text = "Orbit native window fixture"; Size = new Size(800, 500);
    BackColor = Color.DarkSlateBlue; KeyPreview = true;
    var label = new Label { Text = "Orbit native play test window", ForeColor = Color.White, Dock = DockStyle.Fill };
    label.MouseDown += (s, e) => { Text = "Click " + e.X + "," + e.Y; };
    Controls.Add(label);
    KeyDown += (s, e) => { Text = "Key " + e.KeyCode; };
  }
  [STAThread] public static void Main() { Application.EnableVisualStyles(); Application.Run(new WindowFixture()); }
}
'@
