using System.Windows;
using System.Windows.Controls;
namespace Orbit.Desktop;
public sealed class FormDialog : Window
{
    private readonly StackPanel fields = new();
    public FormDialog(Window owner, string title, string description = "")
    {
        Owner = owner; Title = title; Width = 540; SizeToContent = SizeToContent.Height; MaxHeight = 760; WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var panel = new StackPanel { Margin = new Thickness(26) };
        panel.Children.Add(new TextBlock { Text = title, FontSize = 25, FontWeight = FontWeights.SemiBold, Margin = new(0,0,0,14) });
        if (description.Length > 0) panel.Children.Add(new TextBlock { Text = description, TextWrapping = TextWrapping.Wrap, Foreground = System.Windows.Media.Brushes.DarkGray, Margin = new(0,0,0,18) });
        panel.Children.Add(fields); var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(0,12,0,0) };
        var ok = new Button { Content = "Save", IsDefault = true }; ok.Click += (_, _) => { DialogResult = true; };
        actions.Children.Add(ok); actions.Children.Add(new Button { Content = "Cancel", IsCancel = true }); panel.Children.Add(actions);
        Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }
    public TextBox Text(string label, string value, bool multiline = false)
    { fields.Children.Add(new TextBlock { Text = label }); var box = new TextBox { Text = value, AcceptsReturn = multiline, TextWrapping = multiline ? TextWrapping.Wrap : TextWrapping.NoWrap, MinHeight = multiline ? 100 : 0, MaxHeight = multiline ? 240 : 50 }; fields.Children.Add(box); return box; }
    public PasswordBox Password(string label)
    { fields.Children.Add(new TextBlock { Text = label }); var box = new PasswordBox(); fields.Children.Add(box); return box; }
    public ComboBox Choose<T>(string label, IEnumerable<T> items, T selected)
    { fields.Children.Add(new TextBlock { Text = label }); var combo = new ComboBox { ItemsSource = items, SelectedItem = selected }; fields.Children.Add(combo); return combo; }
    public void ClearSecrets() { foreach (var child in fields.Children) if (child is PasswordBox p) p.Clear(); }
}
