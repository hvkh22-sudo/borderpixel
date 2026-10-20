/**
 * Writes a scripts backup to the exports cache directory and opens the system
 * share sheet (Files, Drive, AirDrop, email…). The file is a disposable copy;
 * `cleanExports` may remove it later.
 */
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { exportsDir } from './files';

export type ShareBackupResult = 'shared' | 'unavailable';

export async function shareScriptsBackup(json: string, fileName: string, dialogTitle: string): Promise<ShareBackupResult> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const file = new File(exportsDir(), fileName);
  if (file.exists) file.delete();
  await file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle });
  return 'shared';
}
