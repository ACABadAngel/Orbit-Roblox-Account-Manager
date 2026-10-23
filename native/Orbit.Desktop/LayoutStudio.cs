using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using Orbit.Core;
using Screen=System.Windows.Forms.Screen;
namespace Orbit.Desktop;
public sealed class LayoutEditor : Window
{
    private readonly Canvas canvas=new(){Width=720,Height=400,Background=new SolidColorBrush(Color.FromRgb(7,11,12)),ClipToBounds=true};
    private readonly TextBox name=new();private readonly CheckBox auto=new(){Content="Apply after launch"};private readonly ComboBox monitor=new();private readonly List<WindowSlot> slots=[];private readonly IReadOnlyList<Account> accounts;
    public SavedLayout? Result{get;private set;}
    public LayoutEditor(Window owner,IReadOnlyList<Account> accounts,SavedLayout? existing)
    {
        this.accounts=accounts;Owner=owner;Title="Window layout editor";Width=800;Height=720;WindowStartupLocation=WindowStartupLocation.CenterOwner;ResizeMode=ResizeMode.NoResize;
        name.Text=existing?.Name??"My layout";auto.IsChecked=existing?.AutoApply==true;monitor.ItemsSource=Screen.AllScreens.Select(s=>s.DeviceName+" · "+s.Bounds.Width+" × "+s.Bounds.Height).ToArray();monitor.SelectedIndex=Math.Max(0,Array.FindIndex(Screen.AllScreens,s=>s.DeviceName==existing?.Monitor));
        if(existing is not null)slots.AddRange(existing.Slots.Select(s=>new WindowSlot{AccountId=s.AccountId,X=s.X,Y=s.Y,Width=s.Width,Height=s.Height}));
        var panel=new StackPanel{Margin=new(24)};panel.Children.Add(name);panel.Children.Add(monitor);panel.Children.Add(auto);panel.Children.Add(new TextBlock{Text="Drag tiles to move. Drag the mint corner to resize. Double-click a tile to remove it.",Margin=new(0,0,0,12)});panel.Children.Add(canvas);
        var controls=new WrapPanel{Margin=new(0,18,0,0)};var account=new ComboBox{ItemsSource=accounts,DisplayMemberPath="Label",Width=300};account.SelectedIndex=0;controls.Children.Add(account);
        var add=new Button{Content="Add window"};add.Click+=(_,_)=>{if(account.SelectedItem is Account a&&!slots.Any(s=>s.AccountId==a.Id)){slots.Add(new(){AccountId=a.Id,X=0,Y=0,Width=.5,Height=.5});Render();}};controls.Children.Add(add);
        var save=new Button{Content="Save layout"};save.Click+=(_,_)=>{try{var selected=Screen.AllScreens[monitor.SelectedIndex];var value=new SavedLayout{Id=existing?.Id??Guid.NewGuid().ToString(),Name=name.Text.Trim(),Monitor=selected.DeviceName,AutoApply=auto.IsChecked==true,Slots=slots};value.Validate();Result=value;DialogResult=true;}catch(Exception e){MessageBox.Show(this,e.Message,"Orbit");}};controls.Children.Add(save);controls.Children.Add(new Button{Content="Cancel",IsCancel=true});panel.Children.Add(controls);Content=panel;Render();
    }
    private void Render()
    {
        canvas.Children.Clear();foreach(var slot in slots.ToArray())
        {
            var tile=new Grid{Width=slot.Width*720,Height=slot.Height*400};Canvas.SetLeft(tile,slot.X*720);Canvas.SetTop(tile,slot.Y*400);
            var move=new Thumb{Background=new SolidColorBrush(Color.FromRgb(27,57,46)),BorderBrush=new SolidColorBrush(Color.FromRgb(105,242,188)),BorderThickness=new(1)};tile.Children.Add(move);
            var label=new TextBlock{Text=accounts.FirstOrDefault(a=>a.Id==slot.AccountId)?.Label??"Removed account",Margin=new(12),IsHitTestVisible=false};tile.Children.Add(label);
            move.DragDelta+=(_,e)=>{slot.X=Math.Clamp(slot.X+e.HorizontalChange/720,0,1-slot.Width);slot.Y=Math.Clamp(slot.Y+e.VerticalChange/400,0,1-slot.Height);Canvas.SetLeft(tile,slot.X*720);Canvas.SetTop(tile,slot.Y*400);};move.MouseDoubleClick+=(_,_)=>{slots.Remove(slot);Render();};
            var resize=new Thumb{Width=16,Height=16,HorizontalAlignment=HorizontalAlignment.Right,VerticalAlignment=VerticalAlignment.Bottom,Background=new SolidColorBrush(Color.FromRgb(105,242,188)),Cursor=System.Windows.Input.Cursors.SizeNWSE};tile.Children.Add(resize);
            resize.DragDelta+=(_,e)=>{slot.Width=Math.Clamp(slot.Width+e.HorizontalChange/720,.05,1-slot.X);slot.Height=Math.Clamp(slot.Height+e.VerticalChange/400,.05,1-slot.Y);tile.Width=slot.Width*720;tile.Height=slot.Height*400;};canvas.Children.Add(tile);
        }
    }
}
public partial class MainWindow
{
    private void LayoutsClick(object sender,RoutedEventArgs e)
    {
        var panel=new StackPanel();panel.Children.Add(Actions(Button("New layout",()=>EditLayout(null)),Button("Quick grid",()=>SimpleLayoutsClick(this,new())),Button("Restore original positions",()=>{layouts.Restore(accounts);Notify("Original placements restored.");})));
        foreach(var item in store.State.Layouts)
        {var saved=item;panel.Children.Add(Text(saved.Name+(saved.AutoApply?" · After launch":""),20));panel.Children.Add(Actions(Button("Apply",()=>_=Run(_=>{ApplyLayout(saved);return Task.CompletedTask;})),Button("Edit",()=>EditLayout(saved)),Button("Delete",()=>_=Run(async _=>{store.State.Layouts.Remove(saved);await SaveAsync("Layout removed.");LayoutsClick(this,new());}))));}
        panel.Children.Add(Text("Live windows",22));var tiles=new WrapPanel();foreach(var item in accounts.Where(GameWindows.Owned)){var a=item;var b=Button(a.Label,()=>_=Run(_=>{layouts.Toggle(a,System.Windows.Forms.Screen.FromHandle(a.Window).WorkingArea);return Task.CompletedTask;}));b.Width=200;b.Height=110;tiles.Children.Add(b);}panel.Children.Add(tiles);
        Navigate("Layouts","Arrange windows across detected monitors. Click a live tile to expand or restore.",new ScrollViewer{Content=panel,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});
    }
    private void EditLayout(SavedLayout? saved)
    {var form=new LayoutEditor(this,accounts,saved);if(form.ShowDialog()==true&&form.Result is{} result)_=Run(async _=>{if(saved is null)store.State.Layouts.Add(result);else store.State.Layouts[store.State.Layouts.IndexOf(saved)]=result;await SaveAsync("Window layout saved.");LayoutsClick(this,new());});}
    private void ApplyLayout(SavedLayout saved)
    {saved.Validate();var screen=Screen.AllScreens.FirstOrDefault(s=>s.DeviceName==saved.Monitor)??throw new InvalidOperationException("The layout’s monitor is disconnected.");foreach(var slot in saved.Slots){var a=accounts.FirstOrDefault(a=>a.Id==slot.AccountId);if(a is not null&&GameWindows.Owned(a))layouts.Place(a,screen.WorkingArea,slot);}}
    private void ApplyAutomaticLayout(Account a)
    {foreach(var saved in store.State.Layouts.Where(l=>l.AutoApply&&l.Slots.Any(s=>s.AccountId==a.Id)))try{ApplyLayout(saved);}catch(InvalidOperationException e){Notify(e.Message);}}
}
