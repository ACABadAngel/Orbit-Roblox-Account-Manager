using System;
using System.Runtime.InteropServices;
public static class OrbitAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevices {
    [PreserveSig] int EnumAudioEndpoints(int flow, uint state, out ICollection devices);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-C0A937E729B8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ICollection {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint i, out IDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice {
    [PreserveSig] int Activate(ref Guid id, uint context, IntPtr args, [MarshalAs(UnmanagedType.IUnknown)] out object value);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IManager {
    [PreserveSig] int GetAudioSessionControl(IntPtr guid, uint flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, uint flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out ISessions sessions);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ISessions {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IBaseControl control);
  }
  [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IBaseControl {}
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IControl {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    [PreserveSig] int GetGroupingParam(out Guid grouping);
    [PreserveSig] int SetGroupingParam(ref Guid grouping, ref Guid context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr notify);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notify);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IVolume {
    [PreserveSig] int SetMasterVolume(float volume, ref Guid context);
    [PreserveSig] int GetMasterVolume(out float volume);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  static void Check(int result) { Marshal.ThrowExceptionForHR(result); }
  static void Free(object o) { if (o != null && Marshal.IsComObject(o)) Marshal.ReleaseComObject(o); }
  public static int Set(uint pid, float volume, bool mute) {
    if (volume < 0 || volume > 1) throw new ArgumentOutOfRangeException("volume");
    object enumerator = new Enumerator(); ICollection devices = null; int changed = 0;
    try {
      Check(((IDevices)enumerator).EnumAudioEndpoints(0, 1, out devices)); uint count; Check(devices.GetCount(out count));
      for (uint i = 0; i < count; i++) {
        IDevice device = null; object manager = null; ISessions sessions = null;
        try {
          Check(devices.Item(i, out device)); Guid iid = typeof(IManager).GUID;
          Check(device.Activate(ref iid, 23, IntPtr.Zero, out manager)); Check(((IManager)manager).GetSessionEnumerator(out sessions));
          int n; Check(sessions.GetCount(out n));
          for (int j = 0; j < n; j++) {
            IBaseControl control = null;
            try {
              Check(sessions.GetSession(j, out control)); uint owner; Check(((IControl)control).GetProcessId(out owner)); if (owner != pid) continue;
              Guid context = Guid.Empty; IVolume audio = (IVolume)control;
              Check(audio.SetMasterVolume(volume, ref context)); Check(audio.SetMute(mute, ref context)); changed++;
            } finally { Free(control); }
          }
        } finally { Free(sessions); Free(manager); Free(device); }
      }
      return changed;
    } finally { Free(devices); Free(enumerator); }
  }
}
