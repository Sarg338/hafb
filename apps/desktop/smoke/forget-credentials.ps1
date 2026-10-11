# Deletes "Remember on this PC" credentials (S8.3b) whose target contains -Match, through the
# Credential Manager API. cmdkey can't: it rejects targets like "HAFB plan password: \\?\c:\…"
# while still exiting 0. Prints how many it deleted.
param([Parameter(Mandatory)] [string] $Match)
Add-Type -Namespace HafbSmoke -Name Cred -MemberDefinition @'
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredEnumerateW(string filter, int flags, out int count, out IntPtr credentials);
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredDeleteW(string target, int type, int flags);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr buffer);
'@
$count = 0
$list = [IntPtr]::Zero
$deleted = 0
if ([HafbSmoke.Cred]::CredEnumerateW('HAFB plan password: *', 0, [ref] $count, [ref] $list)) {
  $targets = for ($i = 0; $i -lt $count; $i++) {
    $cred = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($list, $i * [IntPtr]::Size)
    # CREDENTIALW: Flags (4), Type (4), then TargetName.
    [System.Runtime.InteropServices.Marshal]::PtrToStringUni([System.Runtime.InteropServices.Marshal]::ReadIntPtr($cred, 8))
  }
  [HafbSmoke.Cred]::CredFree($list)
  foreach ($t in $targets) {
    if ($t.ToLowerInvariant().Contains($Match.ToLowerInvariant()) -and [HafbSmoke.Cred]::CredDeleteW($t, 1, 0)) { $deleted++ }
  }
}
"deleted $deleted"
